import os
import json
import requests
import logging
import tempfile
import time
import socket
import subprocess
from datetime import datetime, timedelta, timezone
from urllib.parse import unquote, urlparse, parse_qs
from flask import Flask, request, jsonify
from groq import Groq
import firebase_admin
from firebase_admin import credentials, firestore, storage
import uuid
from dotenv import load_dotenv
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
import re
import hashlib
from collections import OrderedDict, defaultdict
from google.cloud.firestore import FieldFilter
import statistics
from openai import AzureOpenAI
import subprocess
import zoneinfo
import numpy as np
import soundfile as sf
import sys
from collections import Counter



# --- Timezone Imports and Configuration ---
try:
    IST_TIMEZONE = zoneinfo.ZoneInfo("Asia/Kolkata")
except zoneinfo.ZoneInfoNotFoundError:
    if sys.version_info < (3, 9):
        try:
            import pytz
            IST_TIMEZONE = pytz.timezone("Asia/Kolkata")
        except ImportError:
            IST_TIMEZONE = timezone(timedelta(hours=5, minutes=30))
    else:
        IST_TIMEZONE = timezone(timedelta(hours=5, minutes=30))
except Exception:
    IST_TIMEZONE = timezone(timedelta(hours=5, minutes=30))

def get_now_ist():
    """Returns a timezone-aware datetime object for the current time in IST."""
    return datetime.now(IST_TIMEZONE)
# ------------------------------------------

load_dotenv()

# Load environment variables
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
AZURE_OPENAI_API_KEY = os.environ.get("AZURE_OPENAI_API_KEY")
AZURE_OPENAI_ENDPOINT = os.environ.get("AZURE_OPENAI_ENDPOINT")
AZURE_DEPLOYMENT_NAME = os.environ.get("AZURE_DEPLOYMENT_NAME")
AZURE_API_VERSION = os.environ.get("AZURE_API_VERSION")
FIREBASE_STORAGE_BUCKET = os.environ.get("FIREBASE_STORAGE_BUCKET")

# Audio processing configuration
AUDIO_CONNECT_TIMEOUT = int(os.environ.get("AUDIO_CONNECT_TIMEOUT", "45"))
AUDIO_READ_TIMEOUT = int(os.environ.get("AUDIO_READ_TIMEOUT", "120"))
ENABLE_AUDIO_CONVERSION = os.environ.get("ENABLE_AUDIO_CONVERSION", "true").lower() == "true"

# -------------------------------------------------
# Logging Configuration
# -------------------------------------------------
def setup_logging():
    """Sets up neat and IST-aware logging."""
    log_format = (
        "[%(levelname)s] %(asctime)s | %(filename)s:%(lineno)d - %(message)s"
    )
    
    formatter = logging.Formatter(log_format, datefmt="%Y-%m-%d %H:%M:%S IST")
    
    def ist_time_converter(timestamp):
        dt = datetime.fromtimestamp(timestamp, IST_TIMEZONE)
        return dt.timetuple()

    formatter.converter = ist_time_converter
    handler = logging.StreamHandler()
    handler.setFormatter(formatter)
    
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)
    root_logger.handlers = [] 
    root_logger.addHandler(handler)

    main_logger = logging.getLogger(__name__)
    main_logger.setLevel(logging.INFO)
    
    werkzeug_logger = logging.getLogger("werkzeug")
    werkzeug_logger.setLevel(logging.ERROR)
    
    return main_logger

logger = setup_logging()

# -------------------------------------------------
# Firebase Initialization
# -------------------------------------------------
try:
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
        'storageBucket': FIREBASE_STORAGE_BUCKET
    })
    db = firestore.client()
    bucket = storage.bucket()
    logger.info("Firebase initialized successfully with Storage")
except Exception as e:
    logger.error(f"Failed to initialize Firebase: {str(e)}")
    db = None
    bucket = None

# -------------------------------------------------
# Azure OpenAI Initialization
# -------------------------------------------------
azure_openai_client = None
if AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT:
    try:
        azure_openai_client = AzureOpenAI(
            api_key=AZURE_OPENAI_API_KEY,
            api_version=AZURE_API_VERSION,
            azure_endpoint=AZURE_OPENAI_ENDPOINT
        )
        logger.info("Azure OpenAI client initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize Azure OpenAI: {str(e)}")
        azure_openai_client = None
else:
    logger.warning("Azure OpenAI credentials not found")

# -------------------------------------------------
# Flask App
# -------------------------------------------------
app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024 # 50MB max file size

# Initialize Groq client
groq_client = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None

# Processed calls cache with LRU eviction (max 1000 entries)
processed_calls = OrderedDict()
MAX_PROCESSED_CALLS = 1000

# -------------------------------------------------
# Enhanced Audio Download Functions
# -------------------------------------------------
def get_file_extension(content_type, url):
    """Determine appropriate file extension from content type or URL"""
    if 'mp3' in content_type or '.mp3' in url.lower():
        return '.mp3'
    elif 'wav' in content_type or '.wav' in url.lower():
        return '.wav'
    elif 'mpeg' in content_type:
        return '.mp3'
    elif 'ogg' in content_type or '.ogg' in url.lower():
        return '.ogg'
    else:
        return '.mp3'  # Default to mp3

def ensure_audio_compatibility(file_path):
    if not ENABLE_AUDIO_CONVERSION:
        return file_path, None

    try:
        # Step 1: Check if file can be opened by soundfile
        try:
            with sf.SoundFile(file_path) as f:
                return file_path, None   # File is fine
        except Exception as e:
            logger.warning(f"SoundFile could not open file, attempting conversion: {e}")

        # Step 2: Convert using ffmpeg to WAV (more reliable than MP3)
        converted_path = file_path + "_converted.wav"

        try:
            cmd = [
                "ffmpeg", "-y",
                "-i", file_path,
                "-ac", "1",          # mono
                "-ar", "22050",      # safe sample rate
                converted_path
            ]

            subprocess.run(cmd, capture_output=True, timeout=60, check=True)

            # Validate converted file
            with sf.SoundFile(converted_path) as f:
                logger.info(f"Successfully converted audio  {converted_path}")
                try:
                    os.unlink(file_path)
                except:
                    pass
                return converted_path, None

        except subprocess.CalledProcessError as e:
            return file_path, f"FFmpeg conversion failed: {e}"
        except subprocess.TimeoutExpired:
            return file_path, "Audio conversion timeout"

    except Exception as e:
        return file_path, f"Audio compatibility check error: {e}"

def create_requests_session():
    """Create a robust requests session with proper headers and timeouts"""
    session = requests.Session()
    session.headers.update({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'audio/*, */*',
        'Accept-Encoding': 'identity',
        'Connection': 'keep-alive'
    })
    
    # Configure retry strategy
    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry
    
    retry_strategy = Retry(
        total=2,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET"],  # Changed from method_whitelist to allowed_methods
        backoff_factor=1
    )
    
    adapter = HTTPAdapter(max_retries=retry_strategy, pool_connections=10, pool_maxsize=10)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    
    return session

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception_type((requests.exceptions.Timeout, requests.exceptions.ConnectionError))
)
def download_audio(url):

    session = None
    temp_file = None

    try:
        session = create_requests_session()

        timeout_strategies = [
            (AUDIO_CONNECT_TIMEOUT, AUDIO_READ_TIMEOUT),
            (30, 60),
            (15, 30),
        ]

        last_error = None

        for attempt, (connect_timeout, read_timeout) in enumerate(timeout_strategies):
            try:
                logger.info(f"Download attempt {attempt+1}: connect={connect_timeout}s, read={read_timeout}s")

                response = session.get(
                    url,
                    stream=True,
                    timeout=(connect_timeout, read_timeout),
                    allow_redirects=True,
                    verify=True
                )
                response.raise_for_status()

                content_type = response.headers.get("content-type", "").lower()
                content_length = int(response.headers.get("content-length", 0))

                logger.info(f"Content-Type: {content_type}, Content-Length: {content_length} bytes")

                if content_length > 0 and content_length < 1024:
                    return None, f"Audio too small ({content_length} bytes)"

                # Create safe temp file
                file_extension = get_file_extension(content_type, url)
                temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=file_extension)

                downloaded_size = 0
                chunk_size = 8192

                for chunk in response.iter_content(chunk_size=chunk_size):
                    if chunk:
                        temp_file.write(chunk)
                        downloaded_size += len(chunk)

                        if content_length > 0 and downloaded_size % (512*1024) == 0:
                            progress = (downloaded_size / content_length) * 100
                            logger.info(f"Download progress: {progress:.1f}%")

                temp_file.close()
                logger.info(f"Download complete: {downloaded_size} bytes")

                # Check audio compatibility (conversion inside)
                compatible_path, compat_error = ensure_audio_compatibility(temp_file.name)

                return compatible_path, None

            except Exception as e:
                last_error = f"Attempt {attempt+1} failed: {str(e)}"
                logger.warning(last_error)

                if temp_file and os.path.exists(temp_file.name):
                    try: os.unlink(temp_file.name)
                    except: pass

                continue

        return None, f"All attempts failed. Last error: {last_error}"

    except Exception as e:
        if temp_file and os.path.exists(temp_file.name):
            try: os.unlink(temp_file.name)
            except: pass

        return None, f"Unexpected error: {str(e)}"

    finally:
        if session:
            session.close()

def decode_url_encoded_values(data: dict) -> dict:
    """Decode URL-encoded values from Kaleyra webhook."""
    decoded = {}
    for key, value in data.items():
        decoded[key] = unquote(value) if isinstance(value, str) else value
    return decoded

def generate_call_id(call_data):
    """Generate a unique call ID based on call metadata to prevent duplicates"""
    call_id = call_data.get('id', '')
    if not call_id:
        call_string = f"{call_data.get('caller', '')}-{call_data.get('called', '')}-{call_data.get('starttime', '')}"
        call_id = hashlib.md5(call_string.encode()).hexdigest()[:12]
    return call_id

def is_call_processed(call_id):
    """Check if call has already been processed to prevent duplicates"""
    if call_id in processed_calls:
        return True
    
    if db:
        try:
            calls_ref = db.collection('call_analysis')
            query = calls_ref.where(filter=firestore.FieldFilter('callId', '==', call_id)).limit(1)
            docs = query.stream()
            if any(True for _ in docs):
                add_to_processed_cache(call_id)
                return True
        except Exception as e:
            logger.error(f"Error checking Firestore for call ID {call_id}: {str(e)}")
    
    return False

def add_to_processed_cache(call_id):
    """Add call ID to processed cache with LRU eviction"""
    if call_id in processed_calls:
        processed_calls.move_to_end(call_id)
    else:
        processed_calls[call_id] = True
        if len(processed_calls) > MAX_PROCESSED_CALLS:
            processed_calls.popitem(last=False)

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=4, max=10))
def transcribe_audio_bilingual(file_path):
    """
    Enhanced transcription that handles bilingual content better.
    Uses segment-level language detection for mixed-language calls.
    
    """
    if not groq_client:
        return None, "Groq client not initialized"
    
    try:
        with open(file_path, "rb") as file:
            transcription = groq_client.audio.transcriptions.create(
                file=(file_path, file.read()),
                model="whisper-large-v3-turbo",
                response_format="verbose_json",
                temperature=0.0,  # Deterministic for better bilingual handling
            )
            
            # Analyze language distribution from segments
            languages_detected = []
            if hasattr(transcription, 'segments') and transcription.segments:
                for segment in transcription.segments:
                    # Whisper provides language per segment
                    if hasattr(segment, 'language'):
                        languages_detected.append(segment.language)
                    elif hasattr(segment, 'lang'):
                        languages_detected.append(segment.lang)
            
            # If no segment-level languages, use overall language
            if not languages_detected:
                languages_detected = [transcription.language] if hasattr(transcription, 'language') else ['unknown']
            
            # Determine if call is bilingual
            unique_langs = set(languages_detected)
            is_bilingual = len(unique_langs) > 1
            
            # Get primary language (most common)
            primary_language = transcription.language if hasattr(transcription, 'language') else 'unknown'
            
            # Calculate language distribution percentages
            lang_counts = Counter(languages_detected)
            total_segments = len(languages_detected)
            lang_distribution = {
                lang: round((count / total_segments) * 100, 1) 
                for lang, count in lang_counts.items()
            } if total_segments > 0 else {}
            
            return {
                'transcription': transcription,
                'is_bilingual': is_bilingual,
                'languages': list(unique_langs),
                'primary_language': primary_language,
                'language_distribution': lang_distribution,
                'segment_count': len(languages_detected)
            }, None
            
    except Exception as e:
        logger.error(f"Bilingual transcription error: {str(e)}")
        return None, f"Transcription failed: {str(e)}"


def detect_language_enhanced(transcription_result):
    """
    Enhanced language detection for bilingual calls.
    
    REPLACE: Your existing detect_language_simple() function
    
    Returns: String like "English", "Hindi", or "Bilingual (English+Hindi)"
    """
    if not transcription_result:
        return "Unknown"
    
    language_map = {
        'en': 'English',
        'hi': 'Hindi',
        'ta': 'Tamil',
        'te': 'Telugu',
        'kn': 'Kannada',
        'ml': 'Malayalam',
        'bn': 'Bengali',
        'gu': 'Gujarati',
        'mr': 'Marathi',
        'pa': 'Punjabi',
        'ur': 'Urdu',
        'or': 'Odia',
        'as': 'Assamese'
    }
    
    # Check if bilingual
    if transcription_result.get('is_bilingual'):
        # Get human-readable language names
        langs = transcription_result.get('languages', [])
        lang_names = [language_map.get(lang.lower(), lang.capitalize()) for lang in langs]
        
        # Add distribution percentages if available
        lang_dist = transcription_result.get('language_distribution', {})
        if lang_dist:
            lang_details = [
                f"{language_map.get(lang.lower(), lang)} ({pct}%)" 
                for lang, pct in lang_dist.items()
            ]
            return f"Bilingual ({' + '.join(lang_details)})"
        else:
            return f"Bilingual ({' + '.join(lang_names)})"
    
    # Single language
    primary = transcription_result.get('primary_language', 'unknown').lower()
    return language_map.get(primary, primary.capitalize())

# -------------------------------------------------
# Acoustic Feature and Tone Analysis Functions
# -------------------------------------------------

def extract_features(audio_path, chunk_sec=3):
    """
    Enhanced feature extraction with more discriminative acoustic features
    for better tone analysis.
    """
    try:
        f = sf.SoundFile(audio_path)
        sr = f.samplerate
        frame_size = sr * chunk_sec
        
        # Feature collectors
        energy_vals = []
        zcr_vals = []
        pitch_vals = []
        spectral_centroids = []
        spectral_rolloffs = []
        mfcc_means = []
        silence_segments = []
        
        total_frames = 0
        
        while True:
            data = f.read(frames=frame_size, dtype='float32')
            if len(data) == 0:
                break

            if data.ndim > 1:
                data = data.mean(axis=1)
            
            total_frames += len(data)
            
            # === Energy (RMS) ===
            rms = np.sqrt(np.mean(data**2))
            energy_vals.append(rms)
            
            # === Zero Crossing Rate ===
            zcr = np.mean(np.abs(np.diff(np.sign(data)))) / 2
            zcr_vals.append(zcr)
            
            # === Pitch Estimation (Autocorrelation) ===
            corr = np.correlate(data, data, mode='full')
            corr = corr[len(corr)//2:]
            d = np.diff(corr)
            start = np.where(d > 0)[0]
            if len(start) > 0:
                start = start[0]
                peak = np.argmax(corr[start:]) + start
                if 50 < sr / peak < 500:  # Human voice range
                    pitch_vals.append(sr / peak)
            
            # === Spectral Features ===
            if len(data) > 512:
                # Spectral Centroid
                spectrum = np.abs(np.fft.rfft(data))
                freqs = np.fft.rfftfreq(len(data), 1/sr)
                spectral_centroid = np.sum(freqs * spectrum) / (np.sum(spectrum) + 1e-10)
                spectral_centroids.append(spectral_centroid)
                
                # Spectral Rolloff (85% of energy)
                cumsum = np.cumsum(spectrum)
                rolloff_idx = np.where(cumsum >= 0.85 * cumsum[-1])[0]
                if len(rolloff_idx) > 0:
                    spectral_rolloffs.append(freqs[rolloff_idx[0]])
            
            # === Silence Detection ===
            if rms < 0.01:  # Threshold for silence
                silence_segments.append(1)
            else:
                silence_segments.append(0)
        
        duration_sec = total_frames / sr if sr > 0 else 0
        
        # === Calculate Statistics ===
        avg_energy = float(np.mean(energy_vals)) if energy_vals else 0.0
        energy_std = float(np.std(energy_vals)) if energy_vals else 0.0
        energy_range = float(np.max(energy_vals) - np.min(energy_vals)) if energy_vals else 0.0
        
        avg_pitch = float(np.mean(pitch_vals)) if pitch_vals else 0.0
        pitch_std = float(np.std(pitch_vals)) if pitch_vals else 0.0
        pitch_range = float(np.max(pitch_vals) - np.min(pitch_vals)) if len(pitch_vals) > 0 else 0.0
        
        avg_zcr = float(np.mean(zcr_vals)) if zcr_vals else 0.0
        
        avg_spectral_centroid = float(np.mean(spectral_centroids)) if spectral_centroids else 0.0
        avg_spectral_rolloff = float(np.mean(spectral_rolloffs)) if spectral_rolloffs else 0.0
        
        # === Speech Rate (words per minute estimate) ===
        # Count energy peaks as proxy for syllables
        if energy_vals:
            energy_array = np.array(energy_vals)
            threshold = np.percentile(energy_array, 75)
            syllable_count = np.sum(energy_array > threshold)
            speech_rate = (syllable_count / duration_sec) * 60 if duration_sec > 0 else 0
        else:
            speech_rate = 0.0
        
        # === Silence Ratio ===
        silence_ratio = np.mean(silence_segments) if silence_segments else 0.0
        
        return {
            "avg_pitch": round(avg_pitch, 2),
            "pitch_std": round(pitch_std, 2),
            "pitch_range": round(pitch_range, 2),
            "avg_energy": round(avg_energy, 4),
            "energy_std": round(energy_std, 4),
            "energy_range": round(energy_range, 4),
            "speech_rate": round(float(speech_rate), 2),
            "avg_zcr": round(avg_zcr, 4),
            "spectral_centroid": round(avg_spectral_centroid, 2),
            "spectral_rolloff": round(avg_spectral_rolloff, 2),
            "silence_ratio": round(silence_ratio, 3),
            "duration_sec": round(duration_sec, 2)
        }

    except Exception as e:
        logger.error(f"Enhanced feature extraction error for {audio_path}: {str(e)}")
        return None
        
def split_audio_channels(audio_path):
    try:
        # Read only metadata first
        with sf.SoundFile(audio_path) as f:
            sr = f.samplerate
            channels = f.channels

        # Mono  return same file for both
        if channels == 1:
            return audio_path, audio_path, sr

        # Create temporary files
        agent_temp = tempfile.NamedTemporaryFile(delete=False, suffix="_agent.wav")
        cust_temp = tempfile.NamedTemporaryFile(delete=False, suffix="_cust.wav")
        agent_temp.close()
        cust_temp.close()

        # Write channels separately
        with sf.SoundFile(audio_path) as f:
            data = f.read(dtype="float32")  # entire file, but light
            agent = data[:, 0]
            customer = data[:, 1] if channels > 1 else data[:, 0]

            sf.write(agent_temp.name, agent, sr)
            sf.write(cust_temp.name, customer, sr)

        logger.info(f"Split stereo audio to: {agent_temp.name}, {cust_temp.name}")
        return agent_temp.name, cust_temp.name, sr

    except Exception as e:
        logger.error(f"Error splitting audio {audio_path}: {e}")
        # Fallback: return original file
        return audio_path, audio_path, None
    
def calculate_talk_ratio_from_channels(agent_audio_path, customer_audio_path):
    """
    Calculate talk ratio using adaptive RMS-based VAD.
    
    Returns:
        "AGENT:CUSTOMER" as percentage string, e.g. "40:60"
        or None if ratio cannot be computed.
    """
    try:
        def calculate_speaking_time(audio_path):
            """Adaptive Voice Activity Detection using RMS chunks."""
            with sf.SoundFile(audio_path) as f:
                sr = f.samplerate
                if sr == 0:
                    return 0

                chunk = int(sr * 0.10)  # 100ms
                rms_values = []
                speaking_frames = 0
                total_frames = 0

                while True:
                    data = f.read(frames=chunk, dtype='float32')
                    if len(data) == 0:
                        break

                    # Stereo  mono
                    if data.ndim > 1:
                        data = data.mean(axis=1)

                    total_frames += len(data)

                    # Calculate RMS
                    rms = float(np.sqrt(np.mean(data ** 2)))
                    rms_values.append(rms)

                if not rms_values:
                    return 0

                # Adaptive threshold: mean + 1.5 * std
                noise_floor = np.mean(rms_values)
                noise_variance = np.std(rms_values)
                threshold = max(0.005, noise_floor + (1.5 * noise_variance))

                # Re-run pass to detect speaking frames
                with sf.SoundFile(audio_path) as f:
                    while True:
                        data = f.read(frames=chunk, dtype='float32')
                        if len(data) == 0:
                            break

                        if data.ndim > 1:
                            data = data.mean(axis=1)

                        rms = float(np.sqrt(np.mean(data ** 2)))

                        if rms > threshold:
                            speaking_frames += len(data)

                return speaking_frames / sr

        # --- Compute speaking times ---
        agent_time = calculate_speaking_time(agent_audio_path)
        customer_time = calculate_speaking_time(customer_audio_path)

        total = agent_time + customer_time

        if total <= 0:
            logger.warning("Talk ratio could not be computed  no speech detected.")
            return None

        # --- Correct ratio direction: AGENT : CUSTOMER ---
        agent_percent = int((agent_time / total) * 100)
        customer_percent = 100 - agent_percent

        talk_ratio = f"{agent_percent}:{customer_percent}"

        logger.info(
            f"Talk Ratio: {talk_ratio} "
            f"(Agent {agent_time:.2f}s, Customer {customer_time:.2f}s)"
        )
        return talk_ratio

    except Exception as e:
        logger.error(f"Talk ratio calculation error: {e}")
        return None

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=4, max=10))
def analyze_tone_with_azure(agent_features, customer_features):
    if not azure_openai_client:
        return None, "Azure OpenAI client not initialized"

    prompt = f"""
You are an expert tone analyst for Maatshi Fashions' customer service quality assurance team. You must be FAIR but STRICT in your evaluation, ensuring scores reflect genuine quality while recognizing good performance.

**AGENT ACOUSTIC FEATURES:**
- Pitch: Avg={agent_features.get('avg_pitch', 0)} Hz, Std={agent_features.get('pitch_std', 0)}, Range={agent_features.get('pitch_range', 0)}
- Energy: Avg={agent_features.get('avg_energy', 0)}, Std={agent_features.get('energy_std', 0)}, Range={agent_features.get('energy_range', 0)}
- Speech Rate: {agent_features.get('speech_rate', 0)} syllables/min
- Spectral Centroid: {agent_features.get('spectral_centroid', 0)} Hz (voice brightness)
- Spectral Rolloff: {agent_features.get('spectral_rolloff', 0)} Hz
- Silence Ratio: {agent_features.get('silence_ratio', 0)} (pause frequency)

**CUSTOMER ACOUSTIC FEATURES:**
- Pitch: Avg={customer_features.get('avg_pitch', 0)} Hz, Std={customer_features.get('pitch_std', 0)}, Range={customer_features.get('pitch_range', 0)}
- Energy: Avg={customer_features.get('avg_energy', 0)}, Std={customer_features.get('energy_std', 0)}, Range={customer_features.get('energy_range', 0)}
- Speech Rate: {customer_features.get('speech_rate', 0)} syllables/min
- Spectral Centroid: {customer_features.get('spectral_centroid', 0)} Hz
- Spectral Rolloff: {customer_features.get('spectral_rolloff', 0)} Hz
- Silence Ratio: {customer_features.get('silence_ratio', 0)}

**Maatshi Fashions STANDARDS - AGENT SHOULD:**
1. **Sound CONFIDENT & BOLD**: Energy > 0.05, clear projection
2. **Be ENTHUSIASTIC**: Pitch variation showing engagement
3. **Speak CLEARLY**: Good energy consistency, natural flow
4. **Project WARMTH**: Emotional engagement with customer
5. **Maintain PROFESSIONAL PACE**: 140-200 spm

**BALANCED STRICT TONE MARK SCORING (0-10):**

**SCORE 9-10 (EXCEPTIONAL - RARE ~2-5%):**
Reserved for truly outstanding, memorable performances:
- Energy > 0.09 (very confident, commanding presence)
- Pitch Std > 32 Hz (highly expressive, captivating)
- Energy Range > 0.09 (very dynamic delivery)
- Spectral Centroid 2200-3500 Hz (bright, professional voice)
- Speech Rate 165-195 spm (perfect natural flow)
- Silence Ratio 0.12-0.22 (confident pacing, no awkward pauses)
- Customer shows positive acoustic response
- **This is world-class service - you'd remember this call**

**SCORE 7-8 (EXCELLENT - ACHIEVABLE ~15-20%):**
Strong professional performance with clear strengths:
- Energy 0.06-0.09 (confident and clear)
- Pitch Std 24-32 Hz (expressive and engaging)
- Energy Range 0.06-0.09 (good dynamics)
- Spectral Centroid 1800-3000 Hz (clear, pleasant voice)
- Speech Rate 150-200 spm (natural flow)
- Silence Ratio 0.15-0.28 (professional pacing)
- Demonstrates enthusiasm and customer rapport
- **Strong agent you'd want handling important calls**

**SCORE 5-7 (GOOD/SOLID - TARGET ~50-60%):**
Professional baseline with room for growth:
- Energy 0.04-0.06 (adequate projection)
- Pitch Std 18-24 Hz (moderate expressiveness)
- Energy Range 0.04-0.06 (some variation)
- Spectral Centroid 1500-2500 Hz (functional voice quality)
- Speech Rate 140-160 or 190-210 spm (acceptable pace)
- Silence Ratio 0.20-0.32 (some hesitation but manageable)
- Gets the job done professionally
- **Competent agent meeting standards**

**SCORE 3-5 (NEEDS IMPROVEMENT ~15-20%):**
Below expectations, coaching required:
- Energy 0.03-0.04 (weak projection, lacks presence)
- Pitch Std 12-18 Hz (limited expression, somewhat flat)
- Energy Range < 0.04 (monotonous)
- Spectral Centroid < 1500 or > 3500 Hz (voice quality issues)
- Speech Rate < 140 or > 210 spm (pacing problems)
- Silence Ratio > 0.35 or < 0.12 (awkward flow)
- Customer may seem disengaged
- **Requires specific training interventions**

**SCORE 1-3 (POOR - INTERVENTION REQUIRED ~5-10%):**
Significant deficiencies, immediate action needed:
- Energy < 0.03 (barely audible, no confidence)
- Pitch Std < 12 Hz (robotic, no emotion)
- Energy Range < 0.03 (completely flat)
- Severe pacing or voice quality issues
- Customer likely frustrated
- **Performance improvement plan required**

**SCORE 0 (TECHNICAL FAILURE):**
- Complete communication breakdown or technical issues

**SCORING GUIDELINES:**
1. **Start from 6 as baseline** for a functioning professional agent
2. Award points for strengths: +1 for each strong metric
3. Deduct points for weaknesses: -1 for each poor metric
4. Consider holistic delivery, not just individual metrics
5. Compare agent energy/engagement vs customer response
6. Be fair: if unsure between two scores, choose middle ground
7. Reserve 9-10 for performances that truly stand out

**IMPORTANT CALIBRATION:**
- A competent, professional agent doing their job well = 6-7
- An engaged, confident agent with good energy = 7-8
- An exceptional agent creating memorable service = 8-9
- Perfect execution with customer delight = 9-10

Provide ONLY valid JSON with this EXACT structure:
{{
    "agent_mood": "2-3 words (e.g., 'Confident and Engaging' or 'Professional but Reserved')",
    "customer_mood": "2-3 words",
    "tone_mark": <integer 0-10, BE FAIR BUT DISCERNING>,
    "reasoning": "2-3 sentences citing specific metrics with context. Example: 'Agent demonstrates good energy (0.065) and moderate pitch variation (Std=22), showing professional confidence. Speech rate (170 spm) is natural. Solid performance with room for more enthusiasm. Customer engagement appears positive.'"
}}
"""

    try:
        response = azure_openai_client.chat.completions.create(
            model=AZURE_DEPLOYMENT_NAME,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.4,  # Balanced for fair assessment
            max_tokens=500,
            response_format={"type": "json_object"}
        )

        response_text = response.choices[0].message.content
        if not response_text:
            return None, "Tone analysis failed: Empty response"

        tone_analysis = json.loads(response_text)
        
        # Balanced validation - allow full range but cap extremes
        tone_mark = tone_analysis.get('tone_mark', 6)  # Default to 6 (baseline professional)
        try:
            tone_mark = max(0, min(10, int(tone_mark)))
            
            # Soft cap at 9 - only allow 10 for truly perfect scenarios
            if tone_mark == 10:
                agent_energy = agent_features.get('avg_energy', 0)
                agent_pitch_std = agent_features.get('pitch_std', 0)
                agent_energy_range = agent_features.get('energy_range', 0)
                agent_spectral = agent_features.get('spectral_centroid', 0)
                agent_rate = agent_features.get('speech_rate', 0)
                
                # Require ALL exceptional criteria for score of 10
                perfect_criteria_met = sum([
                    agent_energy > 0.09,
                    agent_pitch_std > 32,
                    agent_energy_range > 0.09,
                    2200 < agent_spectral < 3500,
                    165 < agent_rate < 195,
                    0.12 < agent_features.get('silence_ratio', 0) < 0.22
                ])
                
                if perfect_criteria_met < 4:
                    logger.info(f"Tone mark 10 reduced to 9 - not all perfect criteria met ({perfect_criteria_met}/6)")
                    tone_mark = 9
                    
        except:
            tone_mark = 6
        
        tone_analysis['tone_mark'] = tone_mark
        tone_analysis['agent_mood'] = tone_analysis.get('agent_mood', 'Professional')
        tone_analysis['customer_mood'] = tone_analysis.get('customer_mood', 'Neutral')
        tone_analysis['tone_status'] = 'ok'

        logger.info(f"Tone Analysis - Mark: {tone_mark}/10 | Agent: {tone_analysis['agent_mood']} | Customer: {tone_analysis['customer_mood']}")
        return tone_analysis, None

    except Exception as e:
        logger.error(f"Azure OpenAI tone analysis error: {str(e)}")
        return None, f"Tone analysis failed: {str(e)}"

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=4, max=10))
def analyze_call_with_azure_openai(transcript_text, language, tone_mark, talk_ratio):
    """
    Enhanced call analysis that handles bilingual content and uses actual talk ratio.
    """
    if not azure_openai_client:
        return None, "Azure OpenAI client not initialized"
    
    # Check if bilingual
    is_bilingual = "Bilingual" in language or "+" in language
    
    bilingual_instruction = ""
    if is_bilingual:
        bilingual_instruction = f"""
** BILINGUAL CALL DETECTED: {language}**

Special Considerations:
1. This call contains multiple languages - evaluate code-switching effectiveness
2. Check if agent can handle both languages smoothly
3. Note any language preferences from customer
4. Language transitions should be natural, not jarring
5. Agent's multilingual ability is a STRENGTH - consider it in scoring
6. Clarity score should account for how well agent navigated language mixing
"""
    
    system_prompt_addition = f"""
**ACOUSTIC TONE QUALITY SCORE:** {tone_mark}/10 (Balanced professional scale)
**ACTUAL TALK TIME RATIO:** {talk_ratio} (Customer:Agent speaking time based on voice activity detection)

**BALANCED SCORING PHILOSOPHY:**
- Tone mark reflects agent's confidence, boldness, enthusiasm, and vocal energy
- A score of 6-7 represents GOOD professional performance (most agents)
- Scores of 7-8 represent EXCELLENT performance (top 20%)
- Scores of 8-9 represent EXCEPTIONAL performance (top 5%)
- Scores of 9-10 are OUTSTANDING but achievable with excellence (top 2%)
- Your structure scores should align with realistic, fair expectations

**SCORING ALIGNMENT WITH TONE:**
- If tone_mark is 4-6: Structure scores should range 5-7 (solid professional work)
- If tone_mark is 6-7: Structure scores should range 6-8 (good to excellent elements)
- If tone_mark is 7-8: Structure scores can reach 7-9 (strong performance recognized)
- If tone_mark is 8-9: Structure scores can reach 8-10 (exceptional work deserves recognition)
- Be fair: recognize genuine quality while maintaining standards

**IMPORTANT CONTEXT:**
- The tone_mark is derived from acoustic analysis (pitch, energy, speech rate, voice quality, enthusiasm)
- The talk_ratio is MEASURED from audio, not estimated from text
- Use these objective metrics to inform your scoring, especially for 'clarity', 'confidence', 'structure', and 'sympathy'
- Agent should sound CONFIDENT, BOLD, ENTHUSIASTIC, and make customer comfortable
- Good performance should be rewarded with good scores (6-7 range)
- Excellent performance should reach 7-8 range
- Outstanding performance can achieve 8-9+ range

{bilingual_instruction}
"""

    try:
        analysis_prompt = f"""
You are a call analysis system for a saree company named Maatshi Fashions. Your task is to evaluate the customer's sentiment and the call's overall outcome from a customer service perspective. This is a call transcript in {language}.

{system_prompt_addition}

**CALL TYPE CLASSIFICATION CATEGORIES:**

1. **Product-related Queries**
     - Questions about saree collections, fabrics, designs, colors
     - Size and measurement inquiries
     - Product availability and stock checks
     - Pricing and discount questions
     - Customization requests

2. **Service Queries**
     - Store locations and timings
     - Tailoring services
     - Styling advice and recommendations
     - Exchange policies
     - Delivery options

3. **Loyalty & Membership Queries**
     - Loyalty program benefits
     - Membership registration
     - Points and rewards inquiries
     - Special member discounts
     - Membership tier questions

4. **Technical Queries (Online Platforms)**
     - Website/Shopify login issues
     - Online ordering problems
     - Payment gateway errors
     - Account management
     - Digital catalog access

5. **Complaint & Feedback Queries**
     - Product quality complaints
     - Delivery delays
     - Wrong items received
     - Customer service feedback
     - Return requests

6. **Order Management**
     - Order status tracking
     - Order modification requests
     - Cancellation requests
     - Bulk order inquiries
     - Shipping updates

7. **Sales & Promotion Inquiries**
     - Current offers and promotions
     - Festival discounts
     - Seasonal sales
     - Corporate bulk discounts
     - Wedding collection offers

**CLASSIFICATION RULES:**
- Choose the PRIMARY category that best represents the main purpose of the call
- If multiple categories apply, select the most dominant one
- For complaint-related calls, use "Complaint & Feedback Queries" even if it involves products or services
- For technical website issues, use "Technical Queries" regardless of context

Provide ONLY a valid JSON object with the following exact structure:

{{
    "summary": "2-line summary of the call",
    "call_type": {{
        "primary_category": "exact_category_name_from_above_list",
        "sub_category": "specific_sub_topic_based_on_call_content",
        "confidence_score": 0.95,
        "secondary_categories": ["list_of_other_relevant_categories"]
    }},
    "objections": ["list of top 3 customer objections with context"],
    "competitors": ["list of competitors mentioned with context about what was said"],
    "scores": {{
        "structure": score_out_of_10_based_on_call_flow,
        "clarity": score_out_of_10_based_on_communication_clearness_and_acoustic_tone,
        "confidence": score_out_of_10_based_on_agent_confidence_and_acoustic_delivery,
        "closing": score_out_of_10_based_on_closure_effectiveness,
        "intro": 10_if_maatshi_fashions_mentioned_in_first_3_seconds_else_0,
        "call_summary": score_out_of_10_based_on_whether_agent_provided_summary_at_end,
        "end_call": score_out_of_10_based_on_whether_agent_asked_for_additional_queries,
        "upselling": score_out_of_10_based_on_upselling_attempts,
        "sympathy": score_out_of_10_based_on_use_of_polite_language_and_empathetic_tone
    }},
    "coaching": ["3 specific coaching tips based on actual transcript"],
    "filler_words_count": number_of_filler_words_used,
    "talk_ratio": "{talk_ratio}",
    "key_topics": ["detailed main topics discussed with context"],
    "call_purpose": "Primary purpose of the call (e.g., Order Status, Refund, Query, Sales Inquiry, Complaint)",
    "sentiment": "overall customer satisfaction sentiment of the call (POSITIVE/NEGATIVE/NEUTRAL)",
    "hold_time": total_seconds_agent_asked_caller_to_hold,
    "call_analysis": {{
        "company_intro_early": boolean_if_agent_introduced_company_in_first_3_seconds,
        "provided_summary": boolean_if_agent_summarized_conversation_at_end,
        "asked_for_more_queries": boolean_if_agent_asked_about_additional_queries,
        "upselling_attempted": boolean_if_agent_tried_upselling,
        "polite_language_used": boolean_if_agent_used_polite_words
    }},
    "call_sections": {{
        "intro": {{"summary": "brief summary", "present": true/false}},
        "discovery": {{"summary": "brief summary", "present": true/false}},
        "demo": {{"summary": "brief summary", "present": true/false}},
        "objection": {{"summary": "brief summary", "present": true/false}},
        "closure": {{"summary": "brief summary", "present": true/false}}
    }},
    "intro_check": "Yes" if the agent introduced themselves as being from Maatshi Fashions in their greeting, otherwise "No"
}}

For filler words, look for: um, uh, like, you know, actually, basically, sort of, kind of, well, so, right, okay.

**SENTIMENT GUIDELINES FOR CUSTOMER SERVICE CONTEXT:**

**POSITIVE:**
- The customer's primary query or issue was successfully resolved.
- The customer expresses thanks, happiness, or satisfaction with the service.
- The agent effectively de-escalated a difficult situation and the customer was receptive.
- The call ends with the customer in a positive or appreciative mood.

**NEGATIVE:**
- The customer's issue was not resolved.
- The customer expresses frustration, anger, or dissatisfaction.
- The customer requests to speak with a manager or threatens to leave.
- The call ends abruptly, or the customer uses rude/angry language.
- The agent fails to provide a clear path to resolution.

**NEUTRAL:**
- The call is purely informational without clear emotional markers.
- The customer's query is answered, but no positive or negative emotion is expressed.
- The call ends without a clear resolution, but also without frustration.
- The conversation is short and transactional, such as a quick status check.

CRITICAL: First, determine the 'call_purpose'. Then, classify 'sentiment' based on whether the agent successfully handled that purpose to the customer's satisfaction. A resolved complaint is a POSITIVE outcome, not a NEUTRAL one. A sales call with buying signals is also a POSITIVE outcome.

**SCORING GUIDANCE:**
- Use the acoustic tone_mark ({tone_mark}/10) as a STRONG indicator for clarity, confidence, and sympathy scores
- A tone_mark of 8-10 should push clarity/confidence to 7-9 range
- A tone_mark of 3-5 should pull clarity/confidence to 4-6 range
- The talk_ratio ({talk_ratio}) indicates conversation balance - ideal is 40-60% customer time
- For bilingual calls, give credit for smooth language switching in clarity score
- Don't penalize agents for customer-initiated language changes

Transcript (first 15000 chars): {transcript_text[:15000]}
"""
        
        response = azure_openai_client.chat.completions.create(
            model=AZURE_DEPLOYMENT_NAME,
            messages=[{"role": "user", "content": analysis_prompt}],
            temperature=0.4,
            max_tokens=1500,
            top_p=0.95,
            response_format={"type": "json_object"}
        )
        
        response_text = response.choices[0].message.content
        
        if not response_text or response_text.strip() == "":
            return None, "Analysis failed: Empty response from Azure OpenAI"
        
        try:
            analysis = json.loads(response_text)
            
            # === Validate call_type structure ===
            call_type = analysis.get('call_type', {})
            if not isinstance(call_type, dict):
                analysis['call_type'] = {
                    'primary_category': 'Unknown',
                    'sub_category': 'Unknown',
                    'confidence_score': 0.0,
                    'secondary_categories': []
                }
            else:
                required_fields = ['primary_category', 'sub_category', 'confidence_score', 'secondary_categories']
                for field in required_fields:
                    if field not in call_type:
                        if field == 'primary_category':
                            call_type[field] = 'Unknown'
                        elif field == 'sub_category':
                            call_type[field] = 'Unknown'
                        elif field == 'confidence_score':
                            call_type[field] = 0.0
                        elif field == 'secondary_categories':
                            call_type[field] = []
            
            # === Override talk_ratio with actual measured value ===
            analysis['talk_ratio'] = talk_ratio
            
            # === Validate sentiment ===
            sentiment = analysis.get('sentiment', '').upper()
            valid_sentiments = ['POSITIVE', 'NEGATIVE', 'NEUTRAL']
            if sentiment not in valid_sentiments:
                logger.warning(f"Invalid sentiment value: {sentiment}. Defaulting to NEUTRAL")
                analysis['sentiment'] = 'NEUTRAL'
            else:
                analysis['sentiment'] = sentiment
            
            # === Ensure scores exist ===
            analysis.setdefault('scores', {})
            analysis.setdefault('call_analysis', {})
            
            # === Handle intro_check ===
            if analysis.get('intro_check') == 'Yes':
                analysis['scores']['intro'] = 10
                analysis['call_analysis']['company_intro_early'] = True
            else:
                analysis['scores']['intro'] = 0
                analysis['call_analysis']['company_intro_early'] = False
            
            primary_category = analysis.get('call_type', {}).get('primary_category', 'Unknown')
            logger.info(f"Call Analysis Complete - Type: {primary_category}, Sentiment: {sentiment}, Language: {language}")
            
        except json.JSONDecodeError as e:
            logger.error(f"JSON parsing failed. Response was: {response_text[:500]}")
            return None, f"Analysis failed: Invalid JSON response - {str(e)}"
        
        return analysis, None
        
    except Exception as e:
        logger.error(f"Azure OpenAI analysis error: {str(e)}")
        return None, f"Analysis failed: {str(e)}"
    
def calculate_call_score(structure_scores, tone_mark, compliance_score, efficiency_score, duration_sec):
    """
    BALANCED PROFESSIONAL SCORING SYSTEM
    - 25% weightage for tone (as per client requirement)
    - Most agents score 6-7 (good professional performance)
    - Excellent agents score 7-8
    - Exceptional agents score 8-9
    - Perfect score (9-10) is rare but achievable
    """

    # --- NON-SCORABLE CASE (<8 seconds) ---
    if duration_sec < 8:
        return {
            "score": None,
            "reason": "Call too short (<8s)",
            "scorable": False
        }

    # --- RAW STRUCTURE CALCULATION ---
    structure_total = (
        structure_scores.get("structure", 0) * 0.15 +
        structure_scores.get("clarity", 0) * 0.15 +
        structure_scores.get("confidence", 0) * 0.12 +
        structure_scores.get("closing", 0) * 0.12 +
        structure_scores.get("intro", 0) * 0.08 +
        structure_scores.get("call_summary", 0) * 0.08 +
        structure_scores.get("end_call", 0) * 0.08 +
        structure_scores.get("upselling", 0) * 0.06 +
        structure_scores.get("sympathy", 0) * 0.06
    )

    structure_score_raw = min(max(structure_total, 0), 10)

    # --- BALANCED NORMALIZATION (Centers around 6-7, not 5) ---
    def balanced_normalize(raw, floor=4.0, center=7.0, compression=0.90):
        """
        Balanced normalization that:
        - Sets floor at 3.0 (not 0) for functioning agents
        - Centers distribution around 6.5 (professional baseline)
        - Uses 0.75 compression (less aggressive than before)
        - Allows scores to reach 9+ for truly excellent performance
        """
        if raw < 3:
            return max(floor, raw)
        normalized = (raw - center) * compression + center
        return max(floor, min(10, normalized))

    structure_score = balanced_normalize(structure_score_raw)
    compliance_score = balanced_normalize(compliance_score if compliance_score > 0 else 6)
    efficiency_score = balanced_normalize(efficiency_score if efficiency_score > 0 else 6)

    # --- TONE MARK PROCESSING ---
    if tone_mark is None or tone_mark == 0:
        tone_mark = 6  # Baseline for missing tone
    
    # Allow full range for tone (no artificial capping)
    tone_mark = max(1, min(10, tone_mark))
    
    # Gentle normalization for tone (preserve high scores better)
    tone_component = balanced_normalize(tone_mark, floor=4.0, center=6.5, compression=0.80)
    
    logger.info(f"Score Components - Structure: {structure_score:.2f}, Tone: {tone_component:.2f} (raw: {tone_mark}), Compliance: {compliance_score:.2f}, Efficiency: {efficiency_score:.2f}")

    # --- DURATION-BASED SCORING LOGIC ---
    
    # SHORT CALLS (8-20s): Focus on structure
    if 8 <= duration_sec < 20:
        final_score = (
            structure_score * 0.85 +
            compliance_score * 0.15
        )
        # Apply gentle uplift for short calls (they shouldn't be penalized too much)
        final_score = min(10, final_score * 1.05)
        
        return {
            "score": round(final_score, 1),
            "reason": "Short call (8-20s): Structure-focused scoring",
            "scorable": True,
            "breakdown": {
                "structure": round(structure_score, 2),
                "tone": "N/A",
                "compliance": round(compliance_score, 2),
                "efficiency": "N/A"
            }
        }

    # MEDIUM CALLS (20-40s): Introduce tone at 15%
    if 20 <= duration_sec < 40:
        final_score = (
            structure_score * 0.65 +
            tone_component * 0.15 +
            compliance_score * 0.20
        )
        return {
            "score": round(final_score, 1),
            "reason": "Medium call (20-40s): Tone at 15% weightage",
            "scorable": True,
            "breakdown": {
                "structure": round(structure_score, 2),
                "tone": round(tone_component, 2),
                "compliance": round(compliance_score, 2),
                "efficiency": "N/A"
            }
        }

    final_score = (
        structure_score * 0.50 +        # Increased to 50% structure
        tone_component * 0.25 +         # Keep 25% tone
        compliance_score * 0.15 +       # Reduced to 15% compliance
        efficiency_score * 0.10         # Keep 10% efficiency
    )
    
    final_score = min(10.0, final_score)

    return {
        "score": round(final_score, 1),
        "reason": "Full scoring applied - 25% tone weightage (Balanced Professional Mode)",
        "scorable": True,
        "breakdown": {
            "structure": round(structure_score, 2),
            "tone": round(tone_component, 2),
            "compliance": round(compliance_score, 2),
            "efficiency": round(efficiency_score, 2)
        }
    }

# --- MODIFIED: get_agent_by_phone_number ---
def get_agent_by_phone_number(phone_number, call_source="INCOMING"):
    """Retrieve agent from Firestore by phone number, returning agentType/type."""
    if not db:
        logger.error("Firestore DB not initialized.")
        return None
    
    try:
        clean_phone = ''.join(filter(str.isdigit, str(phone_number).strip()))
        if len(clean_phone) > 10:
            clean_phone = clean_phone[-10:]
        
        agents_ref = db.collection('agents')
        query = agents_ref.where(filter=firestore.FieldFilter('phone', '==', clean_phone)).limit(1)
        docs = list(query.stream())
        
        if not docs:
            logger.warning(f"No agent found for phone={clean_phone} (source={call_source}).")
            return None
        
        doc = docs[0]
        agent_data = doc.to_dict()
        agent_type = agent_data.get('agentType', 'Unknown')
        
        return {**agent_data, 'id': doc.id, 'type': agent_type} 
    
    except Exception as e:
        logger.error(f"Error fetching agent for phone {phone_number}: {str(e)}")
        return None
# -----------------------------------------------------------

def get_next_call_document_name():
    try:
        calls_ref = db.collection('call_analysis')
        docs = calls_ref.stream()
        
        max_num = 0
        for doc in docs:
            doc_id = doc.id
            if doc_id.startswith('Call_'):
                try:
                    num = int(doc_id.split('_')[1])
                    max_num = max(max_num, num)
                except (ValueError, IndexError):
                    continue
        
        return f"Call_{max_num + 1:02d}"
    except Exception as e:
        logger.error(f"Error finding max call number: {str(e)}")
        return f"Call_{int(time.time())}"

def log_scoring_audit(call_id, duration_sec, tone_mark, structure_scores, final_score):
    """Log detailed scoring audit for quality assurance"""
    audit_log = {
        "call_id": call_id,
        "duration": duration_sec,
        "tone_mark": tone_mark,
        "structure_scores": structure_scores,
        "final_score": final_score.get("score"),
        "score_breakdown": final_score.get("breakdown", {}),
        "timestamp": get_now_ist().isoformat()
    }
    
    logger.info(f"SCORING AUDIT: {json.dumps(audit_log, indent=2)}")
    
    # Optional: Store audit trail in Firestore
    if db:
        try:
            db.collection('scoring_audits').document(call_id).set(audit_log)
        except Exception as e:
            logger.error(f"Failed to store scoring audit: {e}")

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=4, max=10))
def upload_to_firebase_storage(file_path, agent_email, call_id):
    if not bucket:
        return None, "Firebase Storage not initialized"
    
    try:
        timestamp = get_now_ist().strftime("%Y%m%d_%H%M%S")
        filename = f"audio_recordings/{agent_email}/{call_id}_{timestamp}.mp3"
        
        blob = bucket.blob(filename)
        expiration_time = get_now_ist() + timedelta(days=30)
        
        blob.metadata = {
            'firebaseStorageDownloadTokens': str(uuid.uuid4()),
            'deleteAfter': expiration_time.isoformat() 
        }
        
        blob.upload_from_filename(file_path, content_type='audio/mpeg')
        blob.make_public()
        download_url = blob.public_url
        
        token = blob.metadata.get('firebaseStorageDownloadTokens', '')
        if token:
            download_url = f"{download_url}?alt=media&token={token}"
        
        logger.info(f"Audio file uploaded to Firebase Storage: {filename}")
        return download_url, None
        
    except Exception as e:
        return None, f"Failed to upload to Firebase Storage: {str(e)}"

# --- MODIFIED: update_c2c_stats ---
def update_c2c_stats(call_data, agent_type, call_type="answered"):
    
    if not db:
        return

    try:
        c2c_ref = db.collection('c2c_stats').document('overall')
        c2c_doc = c2c_ref.get()
        c2c_data = c2c_doc.to_dict() if c2c_doc.exists else {}

        # --- Initialize totals ---
        c2c_data['totalCallsReceived'] = c2c_data.get('totalCallsReceived', 0) + 1
        if call_type == "answered":
            c2c_data['totalCallsAnswered'] = c2c_data.get('totalCallsAnswered', 0) + 1

        # --- Ensure type_distribution structure exists ---
        c2c_data.setdefault('type_distribution', {})

        # Normalize agent type
        agent_type = str(agent_type).lower().strip()

        # --- Increment type distribution ---
        c2c_data['type_distribution'].setdefault(agent_type, {
            "received": 0,
            "answered": 0
        })
        c2c_data['type_distribution'][agent_type]["received"] += 1

        if call_type == "answered":
            c2c_data['type_distribution'][agent_type]["answered"] += 1

        # --- Last Updated timestamp ---
        c2c_data['lastUpdated'] = get_now_ist()

        # --- Commit update ---
        c2c_ref.set(c2c_data, merge=True)
        logger.info(
            f"Updated C2C stats: received={c2c_data['totalCallsReceived']} "
            f"answered={c2c_data['totalCallsAnswered']} agentType={agent_type}"
        )

    except Exception as e:
        logger.error(f"Failed to update C2C stats: {str(e)}")
# ----------------------------------------------------------------------

def store_call_analysis(agent_data, call_data, analysis, tone_analysis, storage_url,
                        language, type_of_call, duration_sec, agent_type, final_score):

    if not db:
        logger.warning("Firestore not available - skipping storage")
        return None
    
    try:
        tone_mark = tone_analysis.get('tone_mark')

        # DO NOT MODIFY callDocName
        call_doc_name = get_next_call_document_name()
        timestamp = get_now_ist()

        call_type_data = analysis.get('call_type', {
            'primary_category': 'Unknown',
            'sub_category': 'Unknown',
            'confidence_score': 0.0,
            'secondary_categories': []
        })

        call_sections = analysis.get('call_sections', {
            "intro": {"summary": "", "present": False},
            "discovery": {"summary": "", "present": False},
            "demo": {"summary": "", "present": False},
            "objection": {"summary": "", "present": False},
            "closure": {"summary": "", "present": False}
        })

        talk_ratio = analysis.get('talk_ratio')  # Use real value only

        call_doc = {
            'callId': call_data.get('id', ''),
            'agentId': agent_data['id'],
            'agentName': agent_data.get('name', ''),
            'agentEmail': agent_data.get('email', ''),
            'timestamp': timestamp,
            'called': call_data.get('called', ''),
            'caller': call_data.get('caller', ''),
            'dialed': call_data.get('dialed', ''),
            'duration': int(call_data.get('duration', 0)),
            'recordingUrl': storage_url,
            'summary': analysis.get('summary', ''),
            'type_of_call': type_of_call,
            'receiverType': agent_type,
            'callType': {
                'primary': call_type_data.get('primary_category', 'Unknown'),
                'subCategory': call_type_data.get('sub_category', 'Unknown'),
                'confidence': call_type_data.get('confidence_score', 0.0),
                'secondary': call_type_data.get('secondary_categories', [])
            },

            'toneAnalysis': {
                'agentMood': tone_analysis.get('agent_mood'),
                'customerMood': tone_analysis.get('customer_mood'),
                'toneMark': tone_mark,
                'toneStatus': tone_analysis.get('tone_status'),
                'reasoning': tone_analysis.get('reasoning')
            },

            'objections': analysis.get('objections', []),
            'competitors': analysis.get('competitors', []),

            'scores': analysis.get('scores', {}),
            'overallScore': final_score.get("score"),
            'scoringStatus': (
                "non_scorable" if final_score.get("score") is None else "scored"
            ),
            'scoreReason': final_score.get("reason"),

            'coachingTips': analysis.get('coaching', []),
            'language': language,
            'fillerWords': analysis.get('filler_words_count', 0),
            'talkRatio': talk_ratio,
            'keyTopics': analysis.get('key_topics', []),
            'sentiment': analysis.get('sentiment', 'neutral'),
            'holdTime': analysis.get('hold_time', 0),
            'callAnalysis': analysis.get('call_analysis', {}),
            'callSections': call_sections,

            'metadata': {
                'circle': call_data.get('circle', ''),
                'network': call_data.get('network', ''),
                'ringtime': call_data.get('ringtime', ''),
                'starttime': call_data.get('starttime', ''),
                'endtime': call_data.get('endtime', ''),
                'processedAt': timestamp,
                'audioExpiresAt': (timestamp + timedelta(days=30)).replace(tzinfo=None).isoformat()
            }
        }

        db.collection('call_analysis').document(call_doc_name).set(call_doc)
        add_to_processed_cache(call_data.get('id', ''))
        update_agent_stats(agent_data['id'], call_doc, call_doc_name)

        # FIXED: Proper C2C stats update with correct parameter
        if type_of_call == "INCOMING":
            update_call_volume_stats(call_doc, agent_type, "answered")
        
        if type_of_call == "C2C":
            update_c2c_stats(call_doc, agent_type, "answered")  # FIX: Changed call_data to call_doc

        return call_doc_name

    except Exception as e:
        logger.error(f"Failed to store call analysis: {str(e)}")
        return None
        
def update_agent_stats(agent_id, call_data, call_doc_name):
    if not db:
        return
    
    try:
        agent_ref = db.collection('agents').document(agent_id)
        agent = agent_ref.get()
        
        if not agent.exists:
            return
        
        agent_data = agent.to_dict()
        agent_name = agent_data.get('name', 'Unknown')
        
        current_time_ist = get_now_ist()
        current_date = current_time_ist.strftime("%Y-%m-%d")
        current_week = current_time_ist.strftime("%Y-%U")
        current_month = current_time_ist.strftime("%Y-%m")
        
        daily_ref = db.collection('agent_stats').document(agent_id).collection('daily_stats').document(current_date)
        daily_doc = daily_ref.get()
        
        if daily_doc.exists:
            daily_data = daily_doc.to_dict()
            daily_data['callCount'] += 1
            daily_data['totalDuration'] += call_data['duration']
            daily_data['totalScore'] += call_data['overallScore']
            daily_data['avgScore'] = daily_data['totalScore'] / daily_data['callCount']
            daily_ref.set(daily_data)
        else:
            daily_ref.set({
                'callCount': 1,
                'totalDuration': call_data['duration'],
                'totalScore': call_data['overallScore'],
                'avgScore': call_data['overallScore'],
                'agentName': agent_name,
                'agentId': agent_id,
                'date': current_date
            })
        
        weekly_ref = db.collection('agent_stats').document(agent_id).collection('weekly_stats').document(current_week)
        weekly_doc = weekly_ref.get()
        
        if weekly_doc.exists:
            weekly_data = weekly_doc.to_dict()
            weekly_data['callCount'] += 1
            weekly_data['totalDuration'] += call_data['duration']
            weekly_data['totalScore'] += call_data['overallScore']
            weekly_data['avgScore'] = weekly_data['totalScore'] / weekly_data['callCount']
            weekly_ref.set(weekly_data)
        else:
            weekly_ref.set({
                'callCount': 1,
                'totalDuration': call_data['duration'],
                'totalScore': call_data['overallScore'],
                'avgScore': call_data['overallScore'],
                'agentName': agent_name,
                'agentId': agent_id,
                'week': current_week
            })
        
        monthly_ref = db.collection('agent_stats').document(agent_id).collection('monthly_stats').document(current_month)
        monthly_doc = monthly_ref.get()
        
        if monthly_doc.exists:
            monthly_data = monthly_doc.to_dict()
            monthly_data['callCount'] += 1
            monthly_data['totalDuration'] += call_data['duration']
            monthly_data['totalScore'] += call_data['overallScore']
            monthly_data['avgScore'] = monthly_data['totalScore'] / monthly_data['callCount']
            monthly_ref.set(monthly_data)
        else:
            monthly_ref.set({
                'callCount': 1,
                'totalDuration': call_data['duration'],
                'totalScore': call_data['overallScore'],
                'avgScore': call_data['overallScore'],
                'agentName': agent_name,
                'agentId': agent_id,
                'month': current_month
            })
        
        current_total_calls = agent_data.get('stats', {}).get('totalCalls', 0) + 1
        weight = min(0.7, 0.3 + (current_total_calls * 0.01)) 
        current_score = agent_data.get('stats', {}).get('overallScore', 0)
        new_overall = (current_score * (1 - weight) + call_data['overallScore'] * weight)
        
        agent_ref.update({
            'stats.totalCalls': current_total_calls,
            'stats.overallScore': new_overall,
            'stats.lastCallDate': current_time_ist, 
            'updatedAt': current_time_ist 
        })
        
        call_ref = db.collection('agent_stats').document(agent_id).collection('call_history').document(call_data['callId'])
        call_ref.set({
            'callId': call_data['callId'],
            'callDocName': call_doc_name,
            'timestamp': call_data.get('timestamp', current_time_ist), 
            'score': call_data['overallScore'],
            'duration': call_data['duration'],
            'agentName': agent_name,
            'agentId': agent_id
        })
        
    except Exception as e:
        logger.error(f"Failed to update agent stats: {str(e)}")

def update_call_volume_stats(call_data, agent_type, call_type="answered"):
    """Update incoming call volume statistics with flexible agent type handling."""
    if not db:
        logger.error("Firestore not initialized.")
        return

    try:
        current_time = get_now_ist()
        current_date = current_time.strftime("%Y-%m-%d")
        current_week = current_time.strftime("%Y-%U")
        current_month = current_time.strftime("%Y-%m")
        current_hour = current_time.strftime("%H:00")
        hour = current_time.hour
        is_off_hours = hour < 10 or hour >= 19

        volume_ref = db.collection("call_volume_stats").document("overall")
        doc = volume_ref.get()
        volume_data = doc.to_dict() if doc.exists else {}
        agent_type = str(agent_type).lower().strip()

        # --- 1. Initialize Root Structure Efficiently ---
        volume_data.setdefault("totalCallsReceived", 0)
        volume_data.setdefault("totalCallsAnswered", 0)
        volume_data.setdefault("totalOffHoursCalls", 0)
        volume_data.setdefault("offHoursDistribution", {"early_morning": 0, "evening_night": 0})
        volume_data.setdefault("hourlyDistribution", {})
        volume_data.setdefault("peakHours", {"daily": {}, "weekly": {}, "monthly": {}})
        volume_data.setdefault("dailyStats", {})
        volume_data.setdefault("weeklyStats", {})
        volume_data.setdefault("monthlyStats", {})
        volume_data.setdefault("type_distribution", {})

        # --- 2. Update Overall Cumulative Stats ---
        volume_data["totalCallsReceived"] += 1
        
        # Flexible agent type handling
        volume_data["type_distribution"].setdefault(agent_type, {"received": 0, "answered": 0})
        volume_data["type_distribution"][agent_type]["received"] += 1

        if call_type == "answered":
            volume_data["totalCallsAnswered"] += 1
            volume_data["type_distribution"][agent_type]["answered"] += 1

        if is_off_hours:
            volume_data["totalOffHoursCalls"] += 1
            if hour < 10:
                volume_data["offHoursDistribution"]["early_morning"] += 1
            else:
                volume_data["offHoursDistribution"]["evening_night"] += 1

        # --- 3. Update Daily Stats ---
        if current_date not in volume_data["dailyStats"]:
            volume_data["dailyStats"][current_date] = {
                "callsReceived": 0,
                "callsAnswered": 0,
                "offHoursCalls": 0,
                "hourlyBreakdown": {},
                "type_distribution": {}
            }

        daily_stats = volume_data["dailyStats"][current_date]
        daily_stats["callsReceived"] += 1
        
        # Flexible daily type distribution
        daily_stats["type_distribution"].setdefault(agent_type, {"received": 0, "answered": 0})
        daily_stats["type_distribution"][agent_type]["received"] += 1

        if call_type == "answered":
            daily_stats["callsAnswered"] += 1
            daily_stats["type_distribution"][agent_type]["answered"] += 1

        if is_off_hours:
            daily_stats["offHoursCalls"] += 1

        # Update hourly breakdown
        daily_stats["hourlyBreakdown"].setdefault(current_hour, {"received": 0, "answered": 0, "offHours": 0})
        daily_stats["hourlyBreakdown"][current_hour]["received"] += 1
        if is_off_hours:
            daily_stats["hourlyBreakdown"][current_hour]["offHours"] += 1
        if call_type == "answered":
            daily_stats["hourlyBreakdown"][current_hour]["answered"] += 1

        # --- 4. Update Weekly Stats ---
        if current_week not in volume_data["weeklyStats"]:
            volume_data["weeklyStats"][current_week] = {
                "callsReceived": 0,
                "callsAnswered": 0,
                "offHoursCalls": 0,
                "type_distribution": {}
            }

        weekly_stats = volume_data["weeklyStats"][current_week]
        weekly_stats["callsReceived"] += 1
        
        # Flexible weekly type distribution
        weekly_stats["type_distribution"].setdefault(agent_type, {"received": 0, "answered": 0})
        weekly_stats["type_distribution"][agent_type]["received"] += 1

        if call_type == "answered":
            weekly_stats["callsAnswered"] += 1
            weekly_stats["type_distribution"][agent_type]["answered"] += 1

        if is_off_hours:
            weekly_stats["offHoursCalls"] += 1

        # --- 5. Update Monthly Stats ---
        if current_month not in volume_data["monthlyStats"]:
            volume_data["monthlyStats"][current_month] = {
                "callsReceived": 0,
                "callsAnswered": 0,
                "offHoursCalls": 0,
                "type_distribution": {}
            }

        monthly_stats = volume_data["monthlyStats"][current_month]
        monthly_stats["callsReceived"] += 1
        
        # Flexible monthly type distribution
        monthly_stats["type_distribution"].setdefault(agent_type, {"received": 0, "answered": 0})
        monthly_stats["type_distribution"][agent_type]["received"] += 1

        if call_type == "answered":
            monthly_stats["callsAnswered"] += 1
            monthly_stats["type_distribution"][agent_type]["answered"] += 1

        if is_off_hours:
            monthly_stats["offHoursCalls"] += 1

        # --- 6. Update Hourly Distribution ---
        volume_data["hourlyDistribution"].setdefault(current_hour, {"received": 0, "answered": 0})
        volume_data["hourlyDistribution"][current_hour]["received"] += 1
        if call_type == "answered":
            volume_data["hourlyDistribution"][current_hour]["answered"] += 1

        # --- 7. Set Peak Hours Recalculation Flag ---
        volume_data["peakHours"]["needsRecalculation"] = True

        # --- 8. Update Last Updated ---
        volume_data["lastUpdated"] = current_time

        # --- 9. Commit to Firestore ---
        volume_ref.set(volume_data, merge=True)

        logger.info(
            f"Updated INCOMING volume stats for {call_type} call "
            f"(Agent Type: {agent_type}, OffHours={is_off_hours})"
        )

    except Exception as e:
        logger.error(f"Failed to update call volume stats: {str(e)}")


def calculate_peak_hours(volume_data):
    try:
        peak_hours = {
            'daily': {},
            'weekly': {},
            'monthly': {}
        }
        
        recent_days = list(volume_data.get('dailyStats', {}).items())[-7:]
        for date, day_data in recent_days:
            hourly_data = day_data.get('hourlyBreakdown', {})
            if hourly_data:
                peak_hour = max(hourly_data.items(), 
                                key=lambda x: x[1].get('received', 0))
                peak_hours['daily'][date] = {
                    'peakHour': peak_hour[0],
                    'callsReceived': peak_hour[1].get('received', 0),
                    'callsAnswered': peak_hour[1].get('answered', 0)
                }
        
        recent_weeks = list(volume_data.get('weeklyStats', {}).items())[-4:]
        for week, week_data in recent_weeks:
            daily_data = week_data.get('dailyBreakdown', {})
            if daily_data:
                peak_day = max(daily_data.items(), 
                              key=lambda x: x[1].get('received', 0))
                peak_hours['weekly'][week] = {
                    'peakDay': peak_day[0],
                    'callsReceived': peak_day[1].get('received', 0),
                    'callsAnswered': peak_day[1].get('answered', 0)
                }
        
        recent_months = list(volume_data.get('monthlyStats', {}).items())[-3:]
        for month, month_data in recent_months:
            weekly_data = month_data.get('weeklyBreakdown', {})
            if weekly_data:
                peak_week = max(weekly_data.items(), 
                                key=lambda x: x[1].get('received', 0))
                peak_hours['monthly'][month] = {
                    'peakWeek': peak_week[0],
                    'callsReceived': peak_week[1].get('received', 0),
                    'callsAnswered': peak_week[1].get('answered', 0)
                }
        
        return peak_hours
        
    except Exception as e:
        logger.error(f"Failed to calculate peak hours: {str(e)}")
        return {
            'daily': {},
            'weekly': {},
            'monthly': {}
        }
    
def get_call_volume_stats():
    """Retrieve overall incoming call stats safely with peak hour recalculation."""
    if not db:
        return None

    try:
        volume_ref = db.collection('call_volume_stats').document('overall')
        volume_doc = volume_ref.get()
        
        if not volume_doc.exists:
            return None
        
        volume_data = volume_doc.to_dict()

        # Ensure backward compatibility
        volume_data.setdefault('totalOffHoursCalls', 0)
        volume_data.setdefault('offHoursDistribution', {'early_morning': 0, 'evening_night': 0})
        volume_data.setdefault('type_distribution', {})
        volume_data.setdefault('hourlyDistribution', {})
        volume_data.setdefault('dailyStats', {})  # <-- Add this
        volume_data.setdefault('weeklyStats', {}) # <-- Add this  
        volume_data.setdefault('monthlyStats', {}) # <-- Add this
        volume_data.setdefault('peakHours', {'daily': {}, 'weekly': {}, 'monthly': {}})

        # Recalculate peak hours if needed
        if volume_data.get('peakHours', {}).get('needsRecalculation', False):
            peak_hours = calculate_peak_hours(volume_data)
            volume_data['peakHours'] = peak_hours
            volume_ref.set(volume_data, merge=True)

        return volume_data

    except Exception as e:
        logger.error(f"Failed to get call volume stats: {str(e)}")
        return None
    
def calculate_volume_trend(data_points):
    if not data_points or len(data_points) < 2:
        return "stable"
    
    calls = [point.get('callsReceived', 0) for point in data_points]
    
    if len(calls) >= 2:
        recent_avg = statistics.mean(calls[-2:])
        previous_avg = statistics.mean(calls[:-2]) if len(calls) > 2 else calls[0]
        
        if recent_avg > previous_avg * 1.1: 
            return "up"
        elif recent_avg < previous_avg * 0.9: 
            return "down"
    
    return "stable"

def generate_peak_recommendations(peak_hours):
    recommendations = []
    
    daily_peaks = peak_hours.get('daily', {})
    if daily_peaks:
        common_hours = defaultdict(int)
        for date, data in daily_peaks.items():
            common_hours[data.get('peakHour', '')] += 1
        
        if common_hours:
            most_common_hour = max(common_hours.items(), key=lambda x: x[1])
            recommendations.append(f"Most common peak hour: {most_common_hour[0]} ({most_common_hour[1]} days)")
    
    weekly_peaks = peak_hours.get('weekly', {})
    if weekly_peaks:
        week_days = defaultdict(int)
        for week, data in weekly_peaks.items():
            peak_day = data.get('peakDay', '')
            if peak_day:
                try:
                    day_of_week = datetime.strptime(peak_day, "%Y-%m-%d").strftime("%A")
                    week_days[day_of_week] += 1
                except:
                    pass
        
        if week_days:
            busiest_day = max(week_days.items(), key=lambda x: x[1])
            recommendations.append(f"Busiest day of week: {busiest_day[0]} ({busiest_day[1]} weeks)")
    
    monthly_peaks = peak_hours.get('monthly', {})
    if monthly_peaks:
        month_weeks = defaultdict(int)
        for month, data in monthly_peaks.items():
            peak_week = data.get('peakWeek', '')
            if peak_week:
                month_weeks[peak_week] += 1
        
        if month_weeks:
            busiest_week = max(month_weeks.items(), key=lambda x: x[1])
            rec_text = f"Busiest week of month: Week {busiest_week[0].split('-')[-1]} ({busiest_week[1]} months)"
            recommendations.append(rec_text)
    
    volume_data = get_call_volume_stats()
    if volume_data:
        hourly_dist = volume_data.get('hourlyDistribution', {})
        if hourly_dist:
            busiest_hours = sorted(
                [(hour, data.get('received', 0)) for hour, data in hourly_dist.items()],
                key=lambda x: x[1],
                reverse=True
            )[:3]
            
            if busiest_hours:
                rec_text = "Ensure adequate staffing during peak hours: "
                rec_text += ", ".join([f"{hour} ({calls} calls)" for hour, calls in busiest_hours])
                recommendations.append(rec_text)
    
    return recommendations if recommendations else ["Insufficient data for specific recommendations"]

def process_call_recording(recording_url, call_data, call_type):

    call_id = call_data.get('id')
    agent_type = call_data.get('agent_type')

    temp_files_to_clean = []

    # -----------------------------------------
    # 1 DOWNLOAD AUDIO
    # -----------------------------------------
    audio_path, error = download_audio(recording_url)

    if audio_path and os.path.exists(audio_path):
        temp_files_to_clean.append(audio_path)

    if error:
        logger.error(f" Audio download failed for call {call_id}: {error}")

        # Update call volume stats even when audio fails - FIXED FOR C2C
        call_data_for_stats = {
            'id': call_id,
            'duration': int(call_data.get('duration', 0)),
            'overallScore': None
        }

        if call_type == "INCOMING":
            update_call_volume_stats(call_data_for_stats, agent_type, "answered")
        else:  # C2C CALLS
            update_c2c_stats(call_data, agent_type, "answered")  # FIX: Added C2C stats update

        return {
            'callDocName': 'AUDIO_DOWNLOAD_FAILED',
            'storageUrl': None,
            'toneMark': None,
            'toneStatus': "unavailable",
            'agentType': agent_type,
            'talkRatio': None,
            'score': None,
            'scoringStatus': "unscorable"
        }, None

    # -----------------------------------------
    # 2 INITIALIZE VARIABLES
    # -----------------------------------------
    agent_audio_path = None
    cust_audio_path = None
    tone_analysis = None
    analysis = None
    duration_sec = 0
    language = "Unknown"
    talk_ratio = None

    try:
        # -----------------------------------------
        # 3 SPLIT CHANNELS
        # -----------------------------------------
        agent_audio_path, cust_audio_path, _ = split_audio_channels(audio_path)

        for f in [agent_audio_path, cust_audio_path]:
            if f and os.path.exists(f):
                temp_files_to_clean.append(f)

        # -----------------------------------------
        # 4 EXTRACT ACOUSTIC FEATURES
        # -----------------------------------------
        agent_features = extract_features(agent_audio_path)
        customer_features = extract_features(cust_audio_path)

        if not agent_features or not customer_features:
            return None, "Feature extraction failed"

        duration_sec = agent_features.get("duration_sec", 0)

        logger.info(f"Duration (agent channel): {duration_sec}s")

        # -----------------------------------------
        # 5 FAIR DURATION RULE: NON-SCORABLE (< 8s)
        # -----------------------------------------
        if duration_sec < 8:
            logger.warning(f"Non-scorable call (<8s): {call_id}")

            # FIXED: Update stats for both INCOMING and C2C short calls
            if call_type == "INCOMING":
                update_call_volume_stats(call_data, agent_type, "answered")
            else:  # C2C CALLS
                update_c2c_stats(call_data, agent_type, "answered")  # FIX: Added C2C stats update

            return {
                'callDocName': 'NON_SCORABLE_SHORT_CALL',
                'storageUrl': None,
                'toneMark': None,
                'toneStatus': "skipped_short_call",
                'agentType': agent_type,
                'talkRatio': None,
                'score': None,
                'scoringStatus': "non_scorable"
            }, None

        # -----------------------------------------
        # 6 TALK RATIO
        # -----------------------------------------
        talk_ratio = calculate_talk_ratio_from_channels(agent_audio_path, cust_audio_path)

        # -----------------------------------------
        # 7 TRANSCRIPTION
        # -----------------------------------------
        transcription_result, error = transcribe_audio_bilingual(audio_path)
        if error:
            return None, error

        transcript_text = (transcription_result['transcription'].text or "").strip()
        if len(transcript_text) < 10:
            return None, "Transcription too short"

        language = detect_language_enhanced(transcription_result)

        # -----------------------------------------
        # 8 TONE ANALYSIS (NO FAKE DEFAULT)
        # -----------------------------------------
        tone_analysis, tone_error = analyze_tone_with_azure(agent_features, customer_features)

        if tone_error:
            logger.warning(f"Tone unavailable: {tone_error}")
            tone_analysis = {
                'tone_mark': None,
                'tone_status': "unavailable",
                'agent_mood': None,
                'customer_mood': None,
                'reasoning': "Tone processing failed"
            }

        tone_mark = tone_analysis.get("tone_mark")

        # -----------------------------------------
        # 9 CONTENT ANALYSIS
        # -----------------------------------------
        analysis, error = analyze_call_with_azure_openai(
            transcript_text,
            language,
            tone_mark if tone_mark else 0,
            talk_ratio
        )
        if error:
            return None, error

        analysis.setdefault("scores", {})
        analysis.setdefault("compliance", 0)
        analysis.setdefault("efficiency", 0)

        # -----------------------------------------
        # 10 IDENTIFY AGENT
        # -----------------------------------------
        agent = get_agent_by_phone_number(
            call_data.get('dialed' if call_type == "INCOMING" else 'caller', ''), call_type
        )
        if not agent:
            return None, "Agent not found"

        # -----------------------------------------
        # 11 UPLOAD AUDIO
        # -----------------------------------------
        storage_url, error = upload_to_firebase_storage(audio_path, agent.get('email'), call_id)
        if error:
            storage_url = None

        # -----------------------------------------
        # 12 FAIR SCORING (OUTSIDE STORE FUNCTION)
        # -----------------------------------------
        final_score = calculate_call_score(
            structure_scores=analysis.get("scores", {}),
            tone_mark=tone_mark,
            compliance_score=analysis.get("compliance", 0),
            efficiency_score=analysis.get("efficiency", 0),
            duration_sec=duration_sec
        )

        log_scoring_audit(call_id, duration_sec, tone_mark, analysis.get("scores", {}), final_score)

        # -----------------------------------------
        # 13 STORE CALL ANALYSIS
        # -----------------------------------------
        call_doc_name = store_call_analysis(
            agent,
            call_data,
            analysis,
            tone_analysis,
            storage_url,
            language,
            call_type,
            duration_sec,
            agent_type,
            final_score
        )

        return {
            'agent': agent,
            'analysis': analysis,
            'callDocName': call_doc_name,
            'language': language,
            'storageUrl': storage_url,
            'toneMark': tone_mark,
            'toneStatus': tone_analysis.get("tone_status", "ok"),
            'agentType': agent_type,
            'talkRatio': talk_ratio,
            'score': final_score
        }, None

    except Exception as e:
        logger.error(f"Processing failed: {e}")
        return None, str(e)

    finally:
        for f in temp_files_to_clean:
            try:
                if f and os.path.exists(f):
                    os.unlink(f)
            except Exception:
                pass

@app.route("/webhook", methods=["GET", "POST"])
def webhook():
    """Unified Webhook endpoint with enhanced audio download error handling"""
    try:
        # 1. Collect and Decode Data
        data = {}
        if request.method == "GET":
            data.update(request.args.to_dict())
        else:
            if request.args:
                data.update(request.args.to_dict())
            if request.form:
                data.update(request.form.to_dict())
            if request.is_json:
                try:
                    data.update(request.get_json() or {})
                except Exception as json_error:
                    logger.warning(f"Failed to parse JSON data: {json_error}")

        data = decode_url_encoded_values(data)
        call_source = data.get("call_source", "INCOMING").upper() 
        
        # 2. Generate Call ID and Check for Duplicates IMMEDIATELY
        call_id = generate_call_id(data)
        data['id'] = call_id
        
        if is_call_processed(call_id):
            logger.warning(f"Call {call_id} already processed/in-progress - skipping webhook execution.")
            return jsonify({"status": "skipped", "message": "Call already processed"}), 200

        # Mark as processed early to prevent race conditions
        add_to_processed_cache(call_id)
        
        # 3. Determine Agent Type
        agent_for_stats = None
        agent_type = 'Unknown'
        if call_source == "INCOMING":
            agent_for_stats = get_agent_by_phone_number(data.get('dialed', ''), "INCOMING")
        else: 
            agent_for_stats = get_agent_by_phone_number(data.get('caller', ''), "C2C")

        if agent_for_stats:
            agent_type = agent_for_stats.get('type', 'Unknown')
        
        data['agent_type'] = agent_type

        log_data = {k: v for k, v in data.items() if 'password' not in k.lower() and 'token' not in k.lower()}
        logger.info(f"Webhook received ({call_source}, Agent Type: {agent_type}): {log_data}")

        dial_status = data.get("dialstatus", "").upper()
        
        # 4. Handle Answered Calls
        if dial_status == "ANSWER":
            
            if not data.get('recording'):
                logger.warning(f"No recording URL provided for answered {call_source} call")
                if call_id in processed_calls: processed_calls.pop(call_id)
                return jsonify({"status": "skipped", "message": "No recording URL"}), 200
            
            result, error = process_call_recording(data.get('recording', ''), data, call_source)
            
            if error:
                logger.error(f"{call_source} call processing failed: {error}")
                return jsonify({"status": "error", "message": error}), 500
            
            # Handle different result types
            if result.get('callDocName') == 'SKIPPED_SHORT_CALL':
                result_agent_type = result.get('agentType', 'Unknown')
                
                if call_source == "C2C":
                    update_c2c_stats(data, result_agent_type, call_type="answered")
                
                return jsonify({
                    "status": "skipped_short_call", 
                    "message": "Call duration < 10s. Counted for volume, skipped for deep analysis.",
                    "source": call_source,
                    "receiverType": result_agent_type
                }), 200
                
            elif result.get('callDocName') == 'AUDIO_DOWNLOAD_FAILED':
                return jsonify({
                    "status": "partial_success", 
                    "message": "Call counted but audio download failed. Statistics updated.",
                    "source": call_source,
                    "receiverType": result.get('agentType', 'Unknown')
                }), 200

            # Handle Successful Processing
            if call_source == "C2C":
                update_c2c_stats(data, result.get('agentType', 'Unknown'), call_type="answered")
                
            logger.info(f"{call_source} call processed successfully - Doc: {result['callDocName']}")
            return jsonify({
                "status": "success", 
                "message": "Call processed and stored",
                "source": call_source,
                "callDocName": result['callDocName'],
                "toneMark": result.get('toneMark', 'N/A'),
                "receiverType": result.get('agentType', 'Unknown')
            }), 200
            
        # 5. Handle Non-Answered Calls
        else:
            call_data_for_stats = {
                'id': call_id,
                'duration': int(data.get('duration', 0)),
                'overallScore': 0
            }

            if call_source == "C2C":
                update_c2c_stats(data, agent_type, call_type="unanswered")
            else:
                update_call_volume_stats(call_data_for_stats, agent_type, "unanswered")
                
            logger.info(f"Skipping non-answered {call_source} call with status: {dial_status}")
            return jsonify({
                "status": "skipped", 
                "message": f"Not an ANSWERed call (source: {call_source}, status: {dial_status})",
                "receiverType": agent_type
            }), 200

    except Exception as e:
        logger.error(f"Error processing webhook: {str(e)}")
        if 'call_id' in locals() and call_id in processed_calls: 
            processed_calls.pop(call_id)
        return jsonify({"status": "error", "message": str(e)}), 500
        
@app.route("/health", methods=["GET"])
def health_check():
    """Enhanced health check with audio service status"""
    services = {
        "flask": "healthy",
        "groq": "healthy" if groq_client else "unavailable",
        "azure_openai": "healthy" if azure_openai_client else "unavailable",
        "firebase": "healthy" if db else "unavailable",
        "firebase_storage": "healthy" if bucket else "unavailable",
        "audio_processing": "enabled"
    }
    
    # Test audio service connectivity
    try:
        test_url = "https://httpbin.org/delay/1"
        response = requests.get(test_url, timeout=5)
        services["external_connectivity"] = "healthy"
    except:
        services["external_connectivity"] = "unhealthy"
    
    return jsonify({
        "status": "healthy", 
        "timestamp": get_now_ist().isoformat(), 
        "services": services,
        "processedCalls": len(processed_calls),
        "audio_timeouts": f"connect={AUDIO_CONNECT_TIMEOUT}s, read={AUDIO_READ_TIMEOUT}s"
    }), 200

@app.route("/debug/audio", methods=["GET"])
def debug_audio():
    """Debug endpoint for audio download issues"""
    url = request.args.get('url')
    if not url:
        return jsonify({"error": "URL parameter required"}), 400
    
    try:
        start_time = time.time()
        audio_path, error = download_audio(url)
        download_time = time.time() - start_time
        
        result = {
            "url": url,
            "download_time_seconds": round(download_time, 2),
            "success": error is None
        }
        
        if error:
            result["error"] = error
        else:
            result["file_path"] = audio_path
            result["file_size"] = os.path.getsize(audio_path) if os.path.exists(audio_path) else 0
            
            # Clean up
            try:
                os.unlink(audio_path)
            except:
                pass
        
        return jsonify(result), 200
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/agent/<email>", methods=["GET"])
def get_agent_stats(email):
# ... (unchanged logic for get_agent_stats)
    """Get agent statistics and call history by email"""
    if not db:
        return jsonify({"error": "Database not available"}), 500
    
    try:
        # Query agents collection by email
        agents_ref = db.collection('agents')
        query = agents_ref.where(filter=firestore.FieldFilter('email', '==', email)).limit(1)
        docs = query.stream()
        
        agent = None
        for doc in docs:
            agent = {**doc.to_dict(), 'id': doc.id}
        
        if not agent:
            return jsonify({"error": "Agent not found"}), 404
        
        # Get recent calls for this agent
        calls_ref = db.collection('call_analysis')
        query = calls_ref.where(filter=firestore.FieldFilter('agentEmail', '==', email)).order_by('timestamp', direction=firestore.Query.DESCENDING).limit(10)
        calls = [doc.to_dict() for doc in query.stream()]
        
        # Get daily stats for the last 7 days
        daily_stats = {}
        daily_docs = db.collection('agent_stats').document(agent['id']).collection('daily_stats').order_by('date', direction=firestore.Query.DESCENDING).limit(7).stream()
        
        for doc in daily_docs:
            daily_stats[doc.id] = doc.to_dict()
        
        # Calculate ranking based on overall score
        all_agents = db.collection('agents').stream()
        agent_scores = []
        for a in all_agents:
            a_data = a.to_dict()
            if 'stats' in a_data and 'overallScore' in a_data['stats']:
                agent_scores.append({
                    'id': a.id,
                    'name': a_data.get('name', 'Unknown'),
                    'email': a_data.get('email', ''),
                    'score': a_data['stats']['overallScore']
                })
        
        # Sort by score descending
        agent_scores.sort(key=lambda x: x['score'], reverse=True)
        
        # Find current agent's rank
        rank = next((i+1 for i, a in enumerate(agent_scores) if a['email'] == email), None)
        
        return jsonify({
            "agent": agent,
            "recentCalls": calls,
            "dailyStats": daily_stats,
            "ranking": {
                "position": rank,
                "totalAgents": len(agent_scores),
                "topPerformers": agent_scores[:3] if len(agent_scores) >= 3 else agent_scores
            }
        }), 200
        
    except Exception as e:
        logger.error(f"Error fetching agent stats: {str(e)}")
        return jsonify({"error": "Internal server error"}), 500

@app.route("/stats/volume", methods=["GET"])
def get_volume_stats():
    """Get call volume statistics with peak hours, including current day's distribution."""
    if not db:
        return jsonify({"error": "Database not available"}), 500
    
    try:
        volume_data = get_call_volume_stats()
        c2c_ref = db.collection('c2c_stats').document('overall')
        c2c_doc = c2c_ref.get()
        c2c_data = c2c_doc.to_dict() if c2c_doc.exists else {'totalCallsReceived': 0, 'totalCallsAnswered': 0}
        
        if not volume_data:
            volume_data = {} # Initialize empty to prevent error
            
        # Current time for daily key
        current_date = get_now_ist().strftime("%Y-%m-%d") # <-- Use IST for the key

        # --- NEW LOGIC: Extract Current Day's Type Distribution ---
        daily_stats = volume_data.get('dailyStats', {})
        current_day_data = daily_stats.get(current_date, {})
        current_day_type_distribution = current_day_data.get('type_distribution', {})
        # --------------------------------------------------------
        
        # Calculate some additional metrics for INCOMING
        total_received = volume_data.get('totalCallsReceived', 0)
        total_answered = volume_data.get('totalCallsAnswered', 0)
        answer_ratio = round((total_answered / total_received * 100), 2) if total_received > 0 else 0
        
        # Get recent data for trends
        weekly_stats = volume_data.get('weeklyStats', {})
        monthly_stats = volume_data.get('monthlyStats', {})
        
        # Calculate trends
        daily_trend = calculate_volume_trend(list(daily_stats.values())[-7:]) if daily_stats else "stable"
        weekly_trend = calculate_volume_trend(list(weekly_stats.values())[-4:]) if weekly_stats else "stable"
        monthly_trend = calculate_volume_trend(list(monthly_stats.values())[-3:]) if monthly_stats else "stable"
        
        return jsonify({
            "overview": {
                "totalIncomingReceived": total_received,
                "totalIncomingAnswered": total_answered,
                "incomingAnswerRatio": answer_ratio,
                "totalC2CAttempts": c2c_data.get('totalCallsReceived', 0),
                "totalC2CAnswered": c2c_data.get('totalCallsAnswered', 0),
            },
            "timeBased": {
                "daily": daily_stats,
                "weekly": weekly_stats,
                "monthly": monthly_stats
            },
            "hourlyDistribution": volume_data.get('hourlyDistribution', {}),
            "peakHours": volume_data.get('peakHours', {}),
            "trends": {
                "daily": daily_trend,
                "weekly": weekly_trend,
                "monthly": monthly_trend
            },
            # --- Cumulative Distribution (All Time) ---
            "cumulativeTypeDistribution": volume_data.get('type_distribution', {}),
            
            # --- Daily Distribution (Snapshot) ---
            "currentDayTypeDistribution": current_day_type_distribution, # <-- NEW FIELD
            
            "c2cTypeDistribution": c2c_data.get('type_distribution', {}),
            "lastUpdated": volume_data.get('lastUpdated', '')
        }), 200
        
    except Exception as e:
        logger.error(f"Error fetching volume stats: {str(e)}")
        return jsonify({"error": "Internal server error"}), 500

@app.route("/stats/peak-hours", methods=["GET"])
def get_peak_hours():
    """Get current peak hours analysis"""
    if not db:
        return jsonify({"error": "Database not available"}), 500
    
    try:
        volume_data = get_call_volume_stats()
        
        if not volume_data:
            return jsonify({"error": "Volume stats not found"}), 404
        
        peak_hours = volume_data.get('peakHours', {})
        
        # Get current recommendations
        recommendations = generate_peak_recommendations(peak_hours)
        
        return jsonify({
            "peakHours": peak_hours,
            "recommendations": recommendations,
            "lastUpdated": volume_data.get('lastUpdated', '')
        }), 200
        
    except Exception as e:
        logger.error(f"Error fetching peak hours: {str(e)}")
        return jsonify({"error": "Internal server error"}), 500

@app.route("/", methods=["GET"])
def root():
    """Root endpoint with service information"""
    return jsonify({
        "service": "Maatshi Fashions Customer Support Call Analysis API",
        "status": "running", 
        "timestamp": get_now_ist().isoformat(),
        "features": {
            "enhanced_audio_download": True,
            "audio_format_conversion": ENABLE_AUDIO_CONVERSION,
            "timeout_handling": f"{AUDIO_CONNECT_TIMEOUT}s connect, {AUDIO_READ_TIMEOUT}s read",
            "duplicate_prevention": True
        },
        "endpoints": {
            "health": "/health",
            "webhook": "/webhook (POST)",
            "debug_audio": "/debug/audio?url=URL (GET)",
            "agent_stats": "/agent/<email> (GET)",
            "volume_stats": "/stats/volume (GET)", 
            "peak_hours": "/stats/peak-hours (GET)"
        },
        "version": "2.0-enhanced"
    }), 200

# -------------------------------------------------
# Main Runner  
# -------------------------------------------------
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    logger.info(f"Starting enhanced audio processing server on port {port}")
    logger.info(f"Audio timeouts: connect={AUDIO_CONNECT_TIMEOUT}s, read={AUDIO_READ_TIMEOUT}s")
    logger.info(f"Audio conversion: {'ENABLED' if ENABLE_AUDIO_CONVERSION else 'DISABLED'}")
    app.run(host="0.0.0.0", port=port, debug=False)