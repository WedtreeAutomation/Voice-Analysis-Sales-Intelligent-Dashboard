import streamlit as st
import firebase_admin
from firebase_admin import credentials, firestore, storage
import os
from datetime import datetime, timedelta, timezone
import logging
from typing import Dict, List, Set
import re
from urllib.parse import unquote
from concurrent.futures import ThreadPoolExecutor, as_completed
from google.cloud.firestore import FieldFilter
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration
CUTOFF_DATE = datetime(2026, 1, 24)
MAX_WORKERS = 10

# Initialize Firebase
def init_firebase():
    """Initialize Firebase Admin SDK"""
    try:
        firebase_admin.get_app()
    except ValueError:
        firebase_cred_dict = {
            "type": os.environ.get("GOOGLE_SERVICE_ACCOUNT_TYPE"),
            "project_id": os.environ.get("GOOGLE_PROJECT_ID"),
            "private_key_id": os.environ.get("GOOGLE_PRIVATE_KEY_ID"),
            "private_key": os.environ.get("GOOGLE_PRIVATE_KEY", "").replace('\\n', '\n'),
            "client_email": os.environ.get("GOOGLE_CLIENT_EMAIL"),
            "client_id": os.environ.get("GOOGLE_CLIENT_ID"),
            "auth_uri": os.environ.get("GOOGLE_AUTH_URI"),
            "token_uri": os.environ.get("GOOGLE_TOKEN_URI"),
            "auth_provider_x509_cert_url": os.environ.get("GOOGLE_AUTH_PROVIDER_CERT_URL"),
            "client_x509_cert_url": os.environ.get("GOOGLE_CLIENT_CERT_URL")
        }
        
        cred = credentials.Certificate(firebase_cred_dict)
        firebase_admin.initialize_app(cred, {
            'storageBucket': os.environ.get("FIREBASE_STORAGE_BUCKET")
        })
    
    db = firestore.client()
    bucket = storage.bucket()
    return db, bucket

class FirebaseCleaner:
    def __init__(self, db, bucket):
        self.db = db
        self.bucket = bucket
        self.total_deleted = 0
        self.total_audio_deleted = 0
        self.error_count = 0
        self.errors = []
        self.progress_bar = None
        self.status_text = None
        
    def is_old_document(self, doc_data: Dict, doc_id: str = None) -> bool:
        """Check if document is older than cutoff date"""
        timestamp_fields = ['timestamp', 'createdAt', 'created_at', 'date', 'lastUpdated', 
                           'last_updated', 'processedAt', 'processed_at', 'time', 'created']
        
        for field in timestamp_fields:
            timestamp = doc_data.get(field)
            if timestamp:
                if isinstance(timestamp, datetime):
                    if timestamp.tzinfo is None:
                        timestamp = timestamp.replace(tzinfo=timezone(timedelta(hours=5, minutes=30)))
                    return timestamp.date() <= CUTOFF_DATE.date()
                elif isinstance(timestamp, str):
                    try:
                        # Try different formats
                        for fmt in ['%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d']:
                            try:
                                dt = datetime.strptime(timestamp, fmt)
                                if dt.tzinfo is None:
                                    dt = dt.replace(tzinfo=timezone(timedelta(hours=5, minutes=30)))
                                return dt.date() <= CUTOFF_DATE.date()
                            except:
                                continue
                    except:
                        continue
        
        # Check document ID for date patterns
        if doc_id:
            patterns = [
                (r'(\d{2})-(\d{2})-(\d{4})', '%d-%m-%Y'),
                (r'(\d{4})-(\d{2})-(\d{2})', '%Y-%m-%d'),
                (r'(\d{4})(\d{2})(\d{2})', '%Y%m%d')
            ]
            for pattern, date_format in patterns:
                match = re.match(pattern, doc_id)
                if match:
                    try:
                        doc_date = datetime.strptime(doc_id, date_format).date()
                        return doc_date <= CUTOFF_DATE.date()
                    except:
                        continue
        
        return False
    
    def extract_audio_path(self, recording_url: str) -> str:
        """Extract storage path from recording URL - FIXED VERSION"""
        if not recording_url:
            return None
        
        # Log for debugging
        logger.debug(f"Processing URL: {recording_url}")
        
        # Handle different URL formats
        if recording_url.startswith('gs://'):
            # Format: gs://bucket-name/audio_recordings/filename.wav
            parts = recording_url.split('/', 3)
            if len(parts) >= 4:
                path = parts[3]
                logger.debug(f"Extracted GS path: {path}")
                return path
                
        elif 'storage.googleapis.com' in recording_url:
            # Format: https://storage.googleapis.com/bucket-name/audio_recordings/filename.wav
            url_without_params = recording_url.split('?')[0]
            parts = url_without_params.split('/')
            # Find 'audio_recordings' in the path
            for i, part in enumerate(parts):
                if part == 'audio_recordings':
                    path = '/'.join(parts[i:])
                    logger.debug(f"Extracted storage URL path: {path}")
                    return path
                    
        elif 'firebasestorage.googleapis.com' in recording_url:
            # Format: https://firebasestorage.googleapis.com/v0/b/bucket/o/audio_recordings%2Ffilename.wav?alt=media
            if '/o/' in recording_url:
                path_part = recording_url.split('/o/')[1].split('?')[0]
                path = unquote(path_part)
                logger.debug(f"Extracted Firebase storage path: {path}")
                return path
        
        # If none of the above, try to extract from any URL containing audio_recordings
        if 'audio_recordings' in recording_url:
            match = re.search(r'audio_recordings/[^?]+', recording_url)
            if match:
                path = match.group(0)
                logger.debug(f"Extracted regex path: {path}")
                return path
        
        logger.warning(f"Could not extract path from: {recording_url}")
        return None
    
    def delete_document_with_subcollections(self, doc_ref, doc_path: str = None):
        """Delete document and ALL its subcollections recursively"""
        try:
            # Get all subcollections of this document
            subcollections = list(doc_ref.collections())
            
            # Recursively delete all documents in each subcollection
            for subcollection in subcollections:
                sub_docs = list(subcollection.stream())
                for sub_doc in sub_docs:
                    # Recursively delete nested subcollections
                    self.delete_document_with_subcollections(sub_doc.reference)
                    # Delete the sub-document
                    sub_doc.reference.delete()
                    self.total_deleted += 1
                    
                    # Update progress
                    if self.progress_bar and self.status_text:
                        self.status_text.text(f"Deleting: {sub_doc.reference.path}")
            
            # Delete the document itself
            doc_ref.delete()
            self.total_deleted += 1
            
            if doc_path:
                logger.info(f"Deleted: {doc_path}")
            
        except Exception as e:
            error_msg = f"Failed to delete {doc_ref.path}: {str(e)}"
            self.errors.append(error_msg)
            self.error_count += 1
            logger.error(error_msg)
    
    def delete_audio_files(self, audio_paths: Set[str]) -> Dict:
        """Delete audio files in parallel with proper path handling"""
        if not audio_paths:
            return {'deleted': 0, 'failed': 0, 'paths': []}
        
        deleted = 0
        failed = 0
        failed_paths = []
        
        def delete_single_file(path):
            try:
                # Ensure path starts with audio_recordings if not already
                if not path.startswith('audio_recordings/'):
                    path = f"audio_recordings/{path}"
                
                blob = self.bucket.blob(path)
                if blob.exists():
                    blob.delete()
                    logger.info(f"Deleted audio: {path}")
                    return True
                else:
                    logger.warning(f"Audio file not found: {path}")
                    return False
            except Exception as e:
                logger.error(f"Error deleting {path}: {e}")
                return False
        
        # Convert set to list for iteration
        audio_list = list(audio_paths)
        total = len(audio_list)
        
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            futures = {executor.submit(delete_single_file, path): path for path in audio_list}
            
            for i, future in enumerate(as_completed(futures)):
                path = futures[future]
                if future.result():
                    deleted += 1
                else:
                    failed += 1
                    failed_paths.append(path)
                
                # Update progress
                if self.progress_bar and self.status_text:
                    progress = (i + 1) / total
                    self.progress_bar.progress(progress, text=f"Deleting audio files: {i+1}/{total}")
                    self.status_text.text(f"Deleting audio: {os.path.basename(path)}")
        
        self.total_audio_deleted += deleted
        return {'deleted': deleted, 'failed': failed, 'failed_paths': failed_paths}
    
    def process_call_analysis(self) -> Dict:
        """Process call_analysis collection - collect audio paths and delete documents"""
        result = {
            'processed': 0,
            'deleted': 0,
            'audio_paths': set(),
            'errors': 0
        }
        
        try:
            st.write("📞 Scanning call_analysis...")
            collection_ref = self.db.collection('call_analysis')
            docs = list(collection_ref.stream())
            total = len(docs)
            
            for idx, doc in enumerate(docs):
                doc_data = doc.to_dict()
                result['processed'] += 1
                
                # Update progress
                if self.progress_bar and self.status_text:
                    progress = (idx + 1) / total
                    self.progress_bar.progress(progress, text=f"Processing call_analysis: {idx+1}/{total}")
                    self.status_text.text(f"Checking: {doc.id}")
                
                if self.is_old_document(doc_data, doc.id):
                    # Extract audio path
                    recording_url = doc_data.get('recordingUrl')
                    if recording_url:
                        audio_path = self.extract_audio_path(recording_url)
                        if audio_path:
                            result['audio_paths'].add(audio_path)
                            logger.info(f"Found audio to delete: {audio_path}")
                    
                    # Delete document and all subcollections
                    self.delete_document_with_subcollections(doc.reference)
                    result['deleted'] += 1
            
            st.write(f"   ✅ Found {result['deleted']} old documents in call_analysis")
            st.write(f"   📁 Collected {len(result['audio_paths'])} audio file references")
            
        except Exception as e:
            error_msg = f"Error processing call_analysis: {str(e)}"
            self.errors.append(error_msg)
            result['errors'] += 1
            logger.error(error_msg)
        
        return result
    
    def process_agent_stats(self) -> Dict:
        """Process agent_stats collection with all nested subcollections"""
        result = {
            'processed': 0,
            'deleted': 0,
            'subcollections_processed': 0,
            'errors': 0
        }
        
        try:
            st.write("👤 Processing agent_stats...")
            agents_ref = self.db.collection('agent_stats')
            agents = list(agents_ref.stream())
            total = len(agents)
            
            for idx, agent_doc in enumerate(agents):
                agent_data = agent_doc.to_dict()
                result['processed'] += 1
                
                # Update progress
                if self.progress_bar and self.status_text:
                    progress = (idx + 1) / total
                    self.progress_bar.progress(progress, text=f"Processing agents: {idx+1}/{total}")
                    self.status_text.text(f"Checking agent: {agent_doc.id}")
                
                # Check if agent document is old
                is_old_agent = self.is_old_document(agent_data, agent_doc.id)
                
                # Process all subcollections regardless of agent age
                subcollections = ['daily_stats', 'weekly_stats', 'monthly_stats', 'call_history', 
                                 'performance_metrics', 'call_logs', 'transcripts']
                
                for subcol_name in subcollections:
                    try:
                        subcol_ref = self.db.collection(f'agent_stats/{agent_doc.id}/{subcol_name}')
                        sub_docs = list(subcol_ref.stream())
                        
                        for sub_doc in sub_docs:
                            sub_data = sub_doc.to_dict()
                            
                            # Check if sub-document is old
                            if self.is_old_document(sub_data, sub_doc.id):
                                # Check for nested subcollections
                                nested_subcols = list(sub_doc.reference.collections())
                                for nested in nested_subcols:
                                    nested_docs = list(nested.stream())
                                    for nested_doc in nested_docs:
                                        nested_doc.reference.delete()
                                        result['deleted'] += 1
                                        self.total_deleted += 1
                                
                                # Delete the sub-document
                                sub_doc.reference.delete()
                                result['deleted'] += 1
                                self.total_deleted += 1
                                result['subcollections_processed'] += 1
                                
                    except Exception as e:
                        logger.error(f"Error processing {subcol_name} for {agent_doc.id}: {e}")
                
                # Delete the agent document if it's old
                if is_old_agent:
                    agent_doc.reference.delete()
                    result['deleted'] += 1
                    self.total_deleted += 1
            
            st.write(f"   ✅ Deleted {result['deleted']} documents from agent_stats")
            
        except Exception as e:
            error_msg = f"Error processing agent_stats: {str(e)}"
            self.errors.append(error_msg)
            result['errors'] += 1
            logger.error(error_msg)
        
        return result
    
    def process_collection(self, collection_name: str, recursive: bool = True) -> Dict:
        """Generic collection processor"""
        result = {'processed': 0, 'deleted': 0, 'errors': 0}
        
        try:
            st.write(f"📁 Processing {collection_name}...")
            collection_ref = self.db.collection(collection_name)
            docs = list(collection_ref.stream())
            total = len(docs)
            
            for idx, doc in enumerate(docs):
                doc_data = doc.to_dict()
                result['processed'] += 1
                
                # Update progress
                if self.progress_bar and self.status_text:
                    progress = (idx + 1) / total
                    self.progress_bar.progress(progress, text=f"Processing {collection_name}: {idx+1}/{total}")
                    self.status_text.text(f"Checking: {doc.id}")
                
                if self.is_old_document(doc_data, doc.id):
                    if recursive:
                        self.delete_document_with_subcollections(doc.reference)
                    else:
                        doc.reference.delete()
                        self.total_deleted += 1
                    result['deleted'] += 1
            
            st.write(f"   ✅ Deleted {result['deleted']} documents from {collection_name}")
            
        except Exception as e:
            error_msg = f"Error processing {collection_name}: {str(e)}"
            self.errors.append(error_msg)
            result['errors'] += 1
            logger.error(error_msg)
        
        return result
    
    def cleanup_all(self):
        """Execute complete cleanup with progress tracking"""
        # Create progress indicators
        self.progress_bar = st.progress(0, text="Starting cleanup...")
        self.status_text = st.empty()
        
        st.info(f"🗓️ Deleting data created on or before: {CUTOFF_DATE.strftime('%d-%m-%Y')}")
        st.markdown("---")
        
        # Step 1: Process call_analysis and collect audio paths
        call_result = self.process_call_analysis()
        
        # Step 2: Delete audio files
        if call_result['audio_paths']:
            st.markdown("---")
            audio_result = self.delete_audio_files(call_result['audio_paths'])
            st.write(f"🎵 Audio files deleted: {audio_result['deleted']}/{len(call_result['audio_paths'])}")
            if audio_result['failed'] > 0:
                st.warning(f"⚠️ Failed to delete {audio_result['failed']} audio files")
        
        # Step 3: Process agent_stats
        st.markdown("---")
        agent_result = self.process_agent_stats()
        
        # Step 4: Process other collections
        st.markdown("---")
        other_collections = ['missed_calls', 'call_volume_stats', 'c2c_stats', 'scoring_audits']
        
        other_results = {}
        for collection in other_collections:
            try:
                other_results[collection] = self.process_collection(collection, recursive=True)
            except Exception as e:
                st.error(f"Error processing {collection}: {str(e)}")
        
        # Clear progress indicators
        self.progress_bar.empty()
        self.status_text.empty()
        
        return {
            'call_analysis': call_result,
            'agent_stats': agent_result,
            'other_collections': other_results,
            'audio_deleted': self.total_audio_deleted,
            'total_documents_deleted': self.total_deleted,
            'errors': self.errors,
            'error_count': self.error_count
        }

def main():
    st.set_page_config(
        page_title="Firebase Cleanup Tool",
        page_icon="🧹",
        layout="wide"
    )
    
    st.title("🧹 Firebase Data Cleanup Tool")
    st.markdown(f"### Deleting data created on or before **{CUTOFF_DATE.strftime('%d-%m-%Y')}**")
    
    # Warning
    st.error("""
    ⚠️ **CRITICAL WARNING - THIS ACTION IS IRREVERSIBLE!**
    
    This tool will permanently delete:
    - All call_analysis documents and their subcollections
    - All related audio files from storage
    - All agent_stats documents with all nested subcollections
    - All missed_calls, call_volume_stats, c2c_stats, scoring_audits
    
    **Make sure you have backups before proceeding!**
    """)
    
    try:
        # Initialize Firebase
        with st.spinner("Connecting to Firebase..."):
            db, bucket = init_firebase()
            cleaner = FirebaseCleaner(db, bucket)
        
        st.success("✅ Connected to Firebase")
        
        # Simple confirmation
        confirm1 = st.checkbox("✅ I understand this will permanently delete all old data")
        confirm2 = st.checkbox("✅ I have verified the data and have backups")
        
        if confirm1 and confirm2:
            if st.button("🗑️ DELETE ALL OLD DATA", type="primary", use_container_width=True):
                # Execute cleanup
                result = cleaner.cleanup_all()
                
                # Display results
                st.markdown("---")
                st.markdown("### ✅ Cleanup Completed")
                
                # Metrics
                col1, col2, col3 = st.columns(3)
                with col1:
                    st.metric("Documents Deleted", f"{result['total_documents_deleted']:,}")
                with col2:
                    st.metric("Audio Files Deleted", f"{result['audio_deleted']:,}")
                with col3:
                    st.metric("Errors", f"{result['error_count']}")
                
                # Detailed results
                with st.expander("📊 Detailed Results"):
                    st.write("**Call Analysis:**")
                    st.write(f"- Documents deleted: {result['call_analysis']['deleted']}")
                    st.write(f"- Audio references found: {len(result['call_analysis']['audio_paths'])}")
                    
                    st.write("\n**Agent Stats:**")
                    st.write(f"- Total deleted: {result['agent_stats']['deleted']}")
                    
                    st.write("\n**Other Collections:**")
                    for col_name, col_result in result['other_collections'].items():
                        st.write(f"- {col_name}: {col_result['deleted']} documents deleted")
                
                # Show errors if any
                if result['errors']:
                    st.error(f"⚠️ {len(result['errors'])} Errors encountered:")
                    for error in result['errors'][:10]:
                        st.code(error, language="text")
                
                # Success message
                st.success("🎉 Cleanup completed successfully!")
                st.info("""
                **To verify deletion:**
                1. Check Firebase Console → Firestore → collections
                2. Check Firebase Console → Storage → audio_recordings folder
                3. Run this tool again to confirm no old data remains
                """)
        else:
            st.warning("⚠️ Please confirm both checkboxes to enable deletion")
            
    except Exception as e:
        st.error(f"❌ Error: {str(e)}")
        logger.error(f"Error in main: {e}", exc_info=True)

if __name__ == "__main__":
    main()