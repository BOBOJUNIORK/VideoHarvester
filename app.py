import os
import logging
import json
import asyncio
import threading
from urllib.parse import urlparse
from flask import Flask, render_template, request, jsonify, send_file, flash, redirect, url_for
import yt_dlp
import uuid
from datetime import datetime

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.secret_key = os.environ.get("SESSION_SECRET", "dev-secret-key-change-in-production")

# Ensure downloads directory exists
DOWNLOADS_DIR = os.path.join(os.getcwd(), 'downloads')
os.makedirs(DOWNLOADS_DIR, exist_ok=True)

# Global variable to store download progress
download_progress = {}

class ProgressHook:
    def __init__(self, download_id):
        self.download_id = download_id
    
    def __call__(self, d):
        if d['status'] == 'downloading':
            try:
                percent = d.get('_percent_str', '0%').replace('%', '')
                speed = d.get('_speed_str', 'N/A')
                eta = d.get('_eta_str', 'N/A')
                
                download_progress[self.download_id] = {
                    'status': 'downloading',
                    'percent': float(percent) if percent != 'N/A' else 0,
                    'speed': speed,
                    'eta': eta,
                    'filename': d.get('filename', 'Unknown')
                }
            except (ValueError, TypeError):
                download_progress[self.download_id] = {
                    'status': 'downloading',
                    'percent': 0,
                    'speed': 'N/A',
                    'eta': 'N/A',
                    'filename': 'Unknown'
                }
        elif d['status'] == 'finished':
            download_progress[self.download_id] = {
                'status': 'finished',
                'percent': 100,
                'filename': d.get('filename', 'Unknown'),
                'filepath': d.get('filename', '')
            }

def get_video_info(url):
    """Get video information without downloading"""
    try:
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
        }
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            
            # Extract formats
            formats = []
            if 'formats' in info:
                for f in info['formats']:
                    if f.get('vcodec') != 'none' or f.get('acodec') != 'none':
                        format_info = {
                            'format_id': f.get('format_id'),
                            'ext': f.get('ext'),
                            'quality': f.get('format_note', f.get('quality', 'Unknown')),
                            'filesize': f.get('filesize'),
                            'vcodec': f.get('vcodec'),
                            'acodec': f.get('acodec')
                        }
                        formats.append(format_info)
            
            return {
                'title': info.get('title', 'Unknown'),
                'thumbnail': info.get('thumbnail'),
                'duration': info.get('duration'),
                'uploader': info.get('uploader'),
                'formats': formats,
                'platform': info.get('extractor_key', 'Unknown')
            }
    except Exception as e:
        logger.error(f"Error getting video info: {str(e)}")
        return None

def download_video(url, format_id, quality, download_id):
    """Download video in a separate thread"""
    try:
        # Configure download options
        ydl_opts = {
            'outtmpl': os.path.join(DOWNLOADS_DIR, '%(title)s.%(ext)s'),
            'progress_hooks': [ProgressHook(download_id)],
        }
        
        # Set format based on user selection
        if quality == 'audio':
            ydl_opts['format'] = 'bestaudio/best'
            ydl_opts['postprocessors'] = [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }]
        elif format_id:
            ydl_opts['format'] = format_id
        else:
            ydl_opts['format'] = 'best'
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
            
    except Exception as e:
        logger.error(f"Download error: {str(e)}")
        download_progress[download_id] = {
            'status': 'error',
            'error': str(e)
        }

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/get_info', methods=['POST'])
def get_info():
    """Get video information from URL"""
    data = request.get_json()
    url = data.get('url', '').strip()
    
    if not url:
        return jsonify({'error': 'Veuillez fournir une URL valide'}), 400
    
    # Validate URL
    try:
        parsed_url = urlparse(url)
        if not parsed_url.scheme or not parsed_url.netloc:
            return jsonify({'error': 'Veuillez fournir une URL valide'}), 400
    except Exception:
        return jsonify({'error': 'Format d\'URL invalide'}), 400
    
    # Get video information
    info = get_video_info(url)
    if not info:
        return jsonify({'error': 'Impossible d\'extraire les informations de la vidéo. Veuillez vérifier l\'URL et réessayer.'}), 400
    
    return jsonify(info)

@app.route('/download', methods=['POST'])
def download():
    """Start video download"""
    data = request.get_json()
    url = data.get('url', '').strip()
    format_id = data.get('format_id')
    quality = data.get('quality', 'best')
    
    if not url:
        return jsonify({'error': 'Veuillez fournir une URL valide'}), 400
    
    # Generate unique download ID
    download_id = str(uuid.uuid4())
    
    # Initialize progress
    download_progress[download_id] = {
        'status': 'starting',
        'percent': 0
    }
    
    # Start download in separate thread
    thread = threading.Thread(
        target=download_video,
        args=(url, format_id, quality, download_id)
    )
    thread.daemon = True
    thread.start()
    
    return jsonify({'download_id': download_id})

@app.route('/progress/<download_id>')
def get_progress(download_id):
    """Get download progress"""
    progress = download_progress.get(download_id, {'status': 'not_found'})
    return jsonify(progress)

@app.route('/download_file/<filename>')
def download_file(filename):
    """Serve downloaded files"""
    try:
        file_path = os.path.join(DOWNLOADS_DIR, filename)
        if os.path.exists(file_path):
            return send_file(file_path, as_attachment=True)
        else:
            return jsonify({'error': 'Fichier non trouvé'}), 404
    except Exception as e:
        logger.error(f"Error serving file: {str(e)}")
        return jsonify({'error': 'Erreur lors du téléchargement du fichier'}), 500

@app.route('/supported_sites')
def supported_sites():
    """Get list of supported sites"""
    try:
        # Get extractors from yt-dlp
        extractors = yt_dlp.extractor.list_extractors()
        sites = []
        
        # Popular sites to highlight
        popular_sites = [
            'YouTube', 'Facebook', 'Twitter', 'Instagram', 'TikTok',
            'Vimeo', 'Dailymotion', 'Twitch', 'Pinterest', 'Reddit'
        ]
        
        for extractor in extractors[:50]:  # Limit to first 50 for display
            name = extractor.IE_NAME
            if any(site.lower() in name.lower() for site in popular_sites):
                sites.append(name)
        
        return jsonify({'sites': sites})
    except Exception as e:
        logger.error(f"Error getting supported sites: {str(e)}")
        return jsonify({'sites': popular_sites})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
