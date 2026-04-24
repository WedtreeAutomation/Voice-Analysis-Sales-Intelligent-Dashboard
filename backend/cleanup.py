#!/usr/bin/env python3
"""
Firebase Storage Cleanup Script
Deletes audio files created on or before 2026-01-24 from all subdirectories
Uses environment variables for authentication
"""

import os
import sys
from datetime import datetime, timezone, timedelta
from google.cloud import storage
from google.oauth2 import service_account
import logging
import json
from typing import List, Tuple
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configuration
CUTOFF_DATE = datetime(2026, 1, 24).date()
BUCKET_NAME = os.environ.get("FIREBASE_STORAGE_BUCKET", "prashanti-customer-support.firebasestorage.app")
STORAGE_PREFIX = "audio_recordings/"  # Will recursively delete all files under this path

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class FirebaseStorageCleaner:
    def __init__(self):
        """Initialize Firebase Storage client from environment variables"""
        try:
            # Create service account info dict from environment variables
            service_account_info = {
                "type": os.environ.get("GOOGLE_SERVICE_ACCOUNT_TYPE", "service_account"),
                "project_id": os.environ.get("GOOGLE_PROJECT_ID"),
                "private_key_id": os.environ.get("GOOGLE_PRIVATE_KEY_ID"),
                "private_key": os.environ.get("GOOGLE_PRIVATE_KEY", "").replace('\\n', '\n'),
                "client_email": os.environ.get("GOOGLE_CLIENT_EMAIL"),
                "client_id": os.environ.get("GOOGLE_CLIENT_ID"),
                "auth_uri": os.environ.get("GOOGLE_AUTH_URI", "https://accounts.google.com/o/oauth2/auth"),
                "token_uri": os.environ.get("GOOGLE_TOKEN_URI", "https://oauth2.googleapis.com/token"),
                "auth_provider_x509_cert_url": os.environ.get("GOOGLE_AUTH_PROVIDER_CERT_URL", "https://www.googleapis.com/oauth2/v1/certs"),
                "client_x509_cert_url": os.environ.get("GOOGLE_CLIENT_CERT_URL")
            }
            
            # Remove None values
            service_account_info = {k: v for k, v in service_account_info.items() if v is not None}
            
            # Create credentials
            credentials = service_account.Credentials.from_service_account_info(
                service_account_info,
                scopes=['https://www.googleapis.com/auth/cloud-platform']
            )
            
            # Create storage client
            self.client = storage.Client(credentials=credentials, project=service_account_info['project_id'])
            self.bucket = self.client.bucket(BUCKET_NAME)
            
            logger.info(f"✅ Connected to bucket: {BUCKET_NAME}")
            logger.info(f"✅ Authenticated as: {service_account_info['client_email']}")
            
        except Exception as e:
            logger.error(f"❌ Failed to initialize Firebase Storage: {e}")
            logger.error("Make sure all required environment variables are set in .env file")
            sys.exit(1)
    
    def list_all_audio_files(self) -> List[storage.Blob]:
        """List all audio files recursively in storage"""
        try:
            # List all blobs with the prefix - this automatically includes all subdirectories
            logger.info(f"📁 Listing all files under {STORAGE_PREFIX}...")
            blobs = list(self.bucket.list_blobs(prefix=STORAGE_PREFIX))
            
            # Filter to only audio files
            audio_extensions = ('.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac', '.mp4', '.webm')
            audio_blobs = [b for b in blobs if b.name.lower().endswith(audio_extensions)]
            
            logger.info(f"📊 Found {len(blobs)} total files under {STORAGE_PREFIX}")
            logger.info(f"🎵 Found {len(audio_blobs)} audio files")
            
            # Show directory structure sample
            if audio_blobs:
                unique_dirs = set()
                for blob in audio_blobs[:50]:
                    parts = blob.name.split('/')
                    if len(parts) > 2:
                        dir_path = '/'.join(parts[:-1])
                        unique_dirs.add(dir_path)
                
                if unique_dirs:
                    logger.info(f"\n📂 Directories with audio files:")
                    for dir_path in sorted(list(unique_dirs))[:10]:
                        file_count = len([b for b in audio_blobs if b.name.startswith(dir_path + '/')])
                        logger.info(f"   📁 {dir_path}/ ({file_count} files)")
                    if len(unique_dirs) > 10:
                        logger.info(f"   ... and {len(unique_dirs) - 10} more directories")
            
            return audio_blobs
            
        except Exception as e:
            logger.error(f"❌ Error listing files: {e}")
            return []
    
    def get_old_files(self, blobs: List[storage.Blob]) -> List[Tuple[storage.Blob, datetime]]:
        """Filter files created on or before cutoff date"""
        old_files = []
        
        for blob in blobs:
            created_date = blob.time_created.date()
            
            if created_date <= CUTOFF_DATE:
                old_files.append((blob, created_date))
        
        return old_files
    
    def delete_files(self, files: List[Tuple[storage.Blob, datetime]], dry_run: bool = True) -> dict:
        """Delete files with progress tracking"""
        stats = {
            'total': len(files),
            'deleted': 0,
            'failed': 0,
            'failed_files': []
        }
        
        if not files:
            logger.info("No old files to delete")
            return stats
        
        logger.info(f"\n{'='*70}")
        logger.info(f"{'🔍 DRY RUN MODE' if dry_run else '🗑️  ACTUAL DELETE MODE'}")
        logger.info(f"{'='*70}")
        logger.info(f"📅 Cutoff Date: {CUTOFF_DATE.strftime('%d-%m-%Y')}")
        logger.info(f"📁 Total files to delete: {stats['total']:,}")
        logger.info(f"{'='*70}\n")
        
        # Show files grouped by directory
        files_by_dir = {}
        for blob, date in files:
            dir_path = '/'.join(blob.name.split('/')[:-1]) if '/' in blob.name else 'root'
            if dir_path not in files_by_dir:
                files_by_dir[dir_path] = []
            files_by_dir[dir_path].append((blob.name.split('/')[-1], date))
        
        logger.info("📋 FILES TO DELETE BY DIRECTORY:")
        for dir_path, file_list in sorted(files_by_dir.items()):
            logger.info(f"\n📁 {dir_path}/")
            # Show first 5 files in each directory
            for filename, date in file_list[:5]:
                logger.info(f"   🎵 {filename} (Created: {date})")
            if len(file_list) > 5:
                logger.info(f"   ... and {len(file_list) - 5} more files")
        
        # Calculate total size
        total_size_bytes = sum(blob.size for blob, _ in files)
        total_size_mb = total_size_bytes / (1024 * 1024)
        logger.info(f"\n💾 Total size to delete: {total_size_mb:.2f} MB")
        
        # Confirm deletion
        if not dry_run:
            print("\n" + "="*70)
            confirm = input(f"⚠️  WARNING: This will permanently delete {stats['total']:,} files ({total_size_mb:.2f} MB).\nType 'DELETE' to confirm: ")
            if confirm != 'DELETE':
                logger.info("❌ Deletion cancelled by user")
                return stats
            print()
        
        # Perform deletion
        logger.info(f"{'Starting deletion...' if not dry_run else 'Would delete files:'}")
        
        for i, (blob, date) in enumerate(files, 1):
            try:
                if not dry_run:
                    blob.delete()
                    stats['deleted'] += 1
                    
                    # Show progress every 100 files
                    if i % 100 == 0:
                        logger.info(f"   Progress: {i:,}/{stats['total']:,} files deleted ({i/stats['total']*100:.1f}%)")
                else:
                    stats['deleted'] += 1
                    
                    # Show progress in dry run
                    if i % 500 == 0:
                        logger.info(f"   Progress: {i:,}/{stats['total']:,} files processed")
                    
            except Exception as e:
                stats['failed'] += 1
                stats['failed_files'].append(blob.name)
                logger.error(f"   ❌ Failed to delete {blob.name}: {e}")
        
        return stats
    
    def show_summary(self, stats: dict, dry_run: bool):
        """Show deletion summary"""
        logger.info(f"\n{'='*70}")
        logger.info("📊 DELETION SUMMARY")
        logger.info(f"{'='*70}")
        logger.info(f"Total files found: {stats['total']:,}")
        logger.info(f"Successfully {'would be deleted' if dry_run else 'deleted'}: {stats['deleted']:,}")
        
        if stats['failed'] > 0:
            logger.info(f"Failed to delete: {stats['failed']:,}")
            
            if stats['failed_files']:
                logger.info(f"\n❌ Failed files (first 10):")
                for file in stats['failed_files'][:10]:
                    logger.info(f"   - {file}")
        
        if stats['deleted'] > 0 and not dry_run:
            logger.info(f"\n✅ Successfully deleted {stats['deleted']:,} files")
        elif stats['total'] > 0 and dry_run:
            logger.info(f"\n🔍 Dry run completed. No files were actually deleted.")
            logger.info(f"💡 To delete, run again and select 'yes' when prompted.")
    
    def cleanup(self, dry_run: bool = True) -> dict:
        """Main cleanup function"""
        logger.info(f"\n{'='*70}")
        logger.info(f"🚀 STARTING FIREBASE STORAGE CLEANUP")
        logger.info(f"{'='*70}")
        logger.info(f"📦 Bucket: {BUCKET_NAME}")
        logger.info(f"📁 Target path: {STORAGE_PREFIX} (recursive)")
        logger.info(f"📅 Cutoff date: {CUTOFF_DATE.strftime('%d-%m-%Y')}")
        logger.info(f"🔧 Mode: {'DRY RUN (Preview)' if dry_run else 'ACTUAL DELETE'}")
        logger.info(f"{'='*70}\n")
        
        # List all files
        all_files = self.list_all_audio_files()
        if not all_files:
            logger.info("No files found in storage")
            return {'total': 0, 'deleted': 0, 'failed': 0, 'failed_files': []}
        
        # Filter old files
        old_files = self.get_old_files(all_files)
        
        if not old_files:
            logger.info(f"✅ No files older than {CUTOFF_DATE.strftime('%d-%m-%Y')} found")
            return {'total': 0, 'deleted': 0, 'failed': 0, 'failed_files': []}
        
        # Show age distribution
        age_distribution = {}
        for _, date in old_files:
            age_distribution[date] = age_distribution.get(date, 0) + 1
        
        logger.info("\n📅 AGE DISTRIBUTION OF FILES TO DELETE:")
        for date, count in sorted(age_distribution.items())[:15]:
            logger.info(f"   {date}: {count:,} files")
        if len(age_distribution) > 15:
            logger.info(f"   ... and {len(age_distribution) - 15} more dates")
        
        # Delete files
        stats = self.delete_files(old_files, dry_run)
        
        # Show summary
        self.show_summary(stats, dry_run)
        
        return stats

def main():
    """Main function"""
    print("\n" + "="*70)
    print("🔥 FIREBASE STORAGE CLEANUP TOOL")
    print("="*70)
    print(f"📅 Deleting audio files created on or before: {CUTOFF_DATE.strftime('%d-%m-%Y')}")
    print(f"📦 Bucket: {BUCKET_NAME}")
    print(f"📁 Path: {STORAGE_PREFIX} (including all subdirectories)")
    print("="*70)
    
    # Check if .env file exists
    if not os.path.exists('.env'):
        logger.error("❌ .env file not found!")
        logger.info("Please create a .env file with your Firebase credentials")
        sys.exit(1)
    
    try:
        # Initialize cleaner (will use .env automatically)
        cleaner = FirebaseStorageCleaner()
        
        # First, do a dry run to see what will be deleted
        dry_run_stats = cleaner.cleanup(dry_run=True)
        
        if dry_run_stats['total'] == 0:
            logger.info("\n✅ No files to delete. Exiting.")
            return
        
        # Ask if user wants to proceed
        print("\n" + "="*70)
        response = input(f"\n❓ Proceed with actual deletion of {dry_run_stats['total']:,} files? (yes/no): ")
        
        if response.lower() in ['yes', 'y']:
            # Perform actual deletion
            actual_stats = cleaner.cleanup(dry_run=False)
            
            print("\n" + "="*70)
            logger.info(f"🎉 CLEANUP COMPLETED!")
            logger.info(f"✅ Total files deleted: {actual_stats['deleted']:,}")
            if actual_stats['failed'] > 0:
                logger.warning(f"⚠️  Failed to delete {actual_stats['failed']:,} files")
                logger.warning("Check logs above for details")
            print("="*70)
        else:
            logger.info("❌ Deletion cancelled by user")
            
    except KeyboardInterrupt:
        logger.info("\n\n⚠️  Process interrupted by user")
    except Exception as e:
        logger.error(f"❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()