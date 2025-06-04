// Application state
let currentVideoInfo = null;
let currentDownloadId = null;

// DOM elements
const urlForm = document.getElementById('urlForm');
const videoUrlInput = document.getElementById('videoUrl');
const errorMessage = document.getElementById('errorMessage');
const loadingState = document.getElementById('loadingState');
const videoInfoSection = document.getElementById('videoInfoSection');
const downloadProgress = document.getElementById('downloadProgress');
const supportedSitesBtn = document.getElementById('supportedSitesBtn');

// Initialize application
document.addEventListener('DOMContentLoaded', function() {
    initializeEventListeners();
    loadSupportedSites();
});

function initializeEventListeners() {
    // URL form submission
    urlForm.addEventListener('submit', handleUrlSubmit);
    
    // Supported sites button
    supportedSitesBtn.addEventListener('click', function() {
        const modal = new bootstrap.Modal(document.getElementById('supportedSitesModal'));
        modal.show();
    });
    
    // Download button clicks (event delegation)
    document.addEventListener('click', function(e) {
        if (e.target.closest('.download-btn')) {
            const btn = e.target.closest('.download-btn');
            const formatId = btn.dataset.formatId;
            const quality = btn.dataset.quality;
            handleDownload(formatId, quality);
        }
    });
}

async function handleUrlSubmit(e) {
    e.preventDefault();
    
    const url = videoUrlInput.value.trim();
    if (!url) {
        showError('Veuillez entrer une URL valide');
        return;
    }
    
    // Validate URL format
    if (!isValidUrl(url)) {
        showError('Veuillez entrer une URL valide (ex: https://www.youtube.com/watch?v=...)');
        return;
    }
    
    await getVideoInfo(url);
}

function isValidUrl(string) {
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

async function getVideoInfo(url) {
    try {
        showLoading(true);
        hideError();
        hideVideoInfo();
        
        const response = await fetch('/get_info', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ url: url })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to get video information');
        }
        
        currentVideoInfo = data;
        displayVideoInfo(data);
        
    } catch (error) {
        console.error('Error getting video info:', error);
        showError(error.message || 'Impossible d\'obtenir les informations de la vidéo. Veuillez vérifier l\'URL et réessayer.');
    } finally {
        showLoading(false);
    }
}

function displayVideoInfo(info) {
    // Update video thumbnail
    const thumbnail = document.getElementById('videoThumbnail');
    if (info.thumbnail) {
        thumbnail.src = info.thumbnail;
        thumbnail.alt = info.title;
    }
    
    // Update platform badge
    const platformBadge = document.getElementById('platformBadge');
    platformBadge.textContent = info.platform || 'Unknown';
    
    // Update video details
    document.getElementById('videoTitle').textContent = info.title || 'Unknown Title';
    document.getElementById('videoUploader').textContent = info.uploader || 'Unknown';
    document.getElementById('videoDuration').textContent = formatDuration(info.duration);
    
    // Populate video formats
    populateVideoFormats(info.formats || []);
    
    // Show video info section
    showVideoInfo();
}

function populateVideoFormats(formats) {
    const videoFormatsContainer = document.getElementById('videoFormats');
    videoFormatsContainer.innerHTML = '';
    
    if (formats.length === 0) {
        videoFormatsContainer.innerHTML = `
            <div class="alert alert-info">
                <i data-feather="info"></i>
                Aucun format spécifique disponible. Vous pouvez toujours télécharger la vidéo en meilleure qualité.
            </div>
            <div class="format-option">
                <div class="format-info">
                    <span class="format-title">Meilleure Qualité</span>
                    <span class="format-quality">Sélection automatique</span>
                </div>
                <button class="btn btn-success download-btn" data-quality="best">
                    <i data-feather="download"></i>
                    Télécharger Vidéo
                </button>
            </div>
        `;
    } else {
        // Filter and sort formats
        const videoFormats = formats
            .filter(f => f.vcodec && f.vcodec !== 'none')
            .sort((a, b) => {
                // Sort by quality/resolution
                const aHeight = parseInt(a.quality) || 0;
                const bHeight = parseInt(b.quality) || 0;
                return bHeight - aHeight;
            });
        
        // Add best quality option first
        videoFormatsContainer.innerHTML = `
            <div class="format-option">
                <div class="format-info">
                    <span class="format-title">Meilleure Qualité</span>
                    <span class="format-quality">Sélection automatique</span>
                </div>
                <button class="btn btn-success download-btn" data-quality="best">
                    <i data-feather="download"></i>
                    Télécharger Meilleur
                </button>
            </div>
        `;
        
        // Add specific format options
        videoFormats.slice(0, 10).forEach(format => { // Limit to 10 formats
            const formatElement = document.createElement('div');
            formatElement.className = 'format-option';
            
            const quality = format.quality || 'Unknown';
            const ext = format.ext || 'mp4';
            const filesize = format.filesize ? formatFileSize(format.filesize) : '';
            
            formatElement.innerHTML = `
                <div class="format-info">
                    <span class="format-title">${quality} (${ext.toUpperCase()})</span>
                    <span class="format-quality">${filesize}</span>
                </div>
                <button class="btn btn-success download-btn" data-format-id="${format.format_id}">
                    <i data-feather="download"></i>
                    Télécharger
                </button>
            `;
            
            videoFormatsContainer.appendChild(formatElement);
        });
    }
    
    // Re-initialize feather icons
    feather.replace();
}

async function handleDownload(formatId, quality) {
    if (!currentVideoInfo) {
        showError('Veuillez d\'abord sélectionner une vidéo');
        return;
    }
    
    try {
        hideError();
        showDownloadProgress();
        
        const response = await fetch('/download', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                url: videoUrlInput.value.trim(),
                format_id: formatId,
                quality: quality || 'best'
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to start download');
        }
        
        currentDownloadId = data.download_id;
        pollDownloadProgress();
        
    } catch (error) {
        console.error('Download error:', error);
        showError(error.message || 'Impossible de démarrer le téléchargement');
        hideDownloadProgress();
    }
}

function pollDownloadProgress() {
    if (!currentDownloadId) return;
    
    const poll = async () => {
        try {
            const response = await fetch(`/progress/${currentDownloadId}`);
            const progress = await response.json();
            
            updateProgressDisplay(progress);
            
            if (progress.status === 'finished') {
                // Download completed
                setTimeout(() => {
                    hideDownloadProgress();
                    showDownloadCompleted(progress.filename);
                }, 2000);
                return;
            } else if (progress.status === 'error') {
                hideDownloadProgress();
                showError(progress.error || 'Échec du téléchargement');
                return;
            } else if (progress.status === 'downloading' || progress.status === 'starting') {
                // Continue polling
                setTimeout(poll, 1000);
            }
            
        } catch (error) {
            console.error('Progress polling error:', error);
            hideDownloadProgress();
            showError('Impossible de vérifier le progrès du téléchargement');
        }
    };
    
    poll();
}

function updateProgressDisplay(progress) {
    const progressBar = document.getElementById('progressBar');
    const progressPercent = document.getElementById('progressPercent');
    const progressSpeed = document.getElementById('progressSpeed');
    const progressETA = document.getElementById('progressETA');
    const progressStatus = document.getElementById('progressStatus');
    
    const percent = Math.round(progress.percent || 0);
    
    progressBar.style.width = `${percent}%`;
    progressPercent.textContent = `${percent}%`;
    
    if (progress.speed) {
        progressSpeed.textContent = `Vitesse: ${progress.speed}`;
    }
    
    if (progress.eta) {
        progressETA.textContent = `Temps restant: ${progress.eta}`;
    }
    
    if (progress.filename) {
        progressStatus.textContent = `Téléchargement: ${getFileName(progress.filename)}`;
    }
    
    if (progress.status === 'starting') {
        progressStatus.textContent = 'Préparation du téléchargement...';
    }
}

// Utility functions
function formatDuration(seconds) {
    if (!seconds) return 'Inconnue';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
}

function formatFileSize(bytes) {
    if (!bytes) return '';
    
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}

function getFileName(filepath) {
    return filepath.split('/').pop() || filepath;
}

function showError(message) {
    errorMessage.querySelector('span').textContent = message;
    errorMessage.classList.remove('d-none');
    feather.replace();
}

function hideError() {
    errorMessage.classList.add('d-none');
}

function showLoading(show) {
    if (show) {
        loadingState.classList.remove('d-none');
    } else {
        loadingState.classList.add('d-none');
    }
}

function showVideoInfo() {
    videoInfoSection.classList.remove('d-none');
}

function hideVideoInfo() {
    videoInfoSection.classList.add('d-none');
}

function showDownloadProgress() {
    downloadProgress.classList.remove('d-none');
    
    // Reset progress
    document.getElementById('progressBar').style.width = '0%';
    document.getElementById('progressPercent').textContent = '0%';
    document.getElementById('progressSpeed').textContent = '';
    document.getElementById('progressETA').textContent = '';
    document.getElementById('progressStatus').textContent = 'Initialisation du téléchargement...';
}

function hideDownloadProgress() {
    downloadProgress.classList.add('d-none');
    currentDownloadId = null;
}

function showSuccess(message) {
    // Create and show success alert
    const successAlert = document.createElement('div');
    successAlert.className = 'alert alert-success';
    successAlert.innerHTML = `
        <i data-feather="check-circle"></i>
        <span>${message}</span>
    `;
    
    // Insert after URL form
    urlForm.parentNode.insertBefore(successAlert, urlForm.nextSibling);
    
    feather.replace();
    
    // Remove after 5 seconds
    setTimeout(() => {
        successAlert.remove();
    }, 5000);
}

async function loadSupportedSites() {
    try {
        const response = await fetch('/supported_sites');
        const data = await response.json();
        
        if (data.sites && data.sites.length > 0) {
            // Could update the modal with actual supported sites
            console.log('Supported sites loaded:', data.sites.length);
        }
    } catch (error) {
        console.error('Failed to load supported sites:', error);
    }
}

// Handle URL input paste event for immediate validation
videoUrlInput.addEventListener('paste', function() {
    setTimeout(() => {
        const url = this.value.trim();
        if (url && isValidUrl(url)) {
            hideError();
        }
    }, 100);
});

// Auto-focus URL input on page load
window.addEventListener('load', function() {
    videoUrlInput.focus();
});
