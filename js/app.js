/**
 * Main application controller.
 * Wires together file storage, ffmpeg extraction, audio analysis, and waveform rendering.
 */

import { log, formatBytes, formatTime, show, hide, setProgress } from './utils.js';
import { storeFile, getFileAsBlob, deleteFile, listFiles, checkQuota } from './file-store.js';
import { loadFFmpeg, extractAudio, downsampleForAnalysis, terminate as terminateFFmpeg } from './ffmpeg-worker.js';
import { extractPeaksFromPCM } from './audio-analyzer.js';
import { WaveformRenderer } from './waveform-renderer.js';

// ---- DOM Elements ----
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const uploadProgress = document.getElementById('upload-progress');
const uploadStatus = document.getElementById('upload-status');
const uploadBar = document.getElementById('upload-bar');
const uploadDetail = document.getElementById('upload-detail');

const filesSection = document.getElementById('files-section');
const fileList = document.getElementById('file-list');

const processingSection = document.getElementById('processing-section');
const extractStatus = document.getElementById('extract-status');
const extractBar = document.getElementById('extract-bar');
const extractDetail = document.getElementById('extract-detail');
const analyzeProgress = document.getElementById('analyze-progress');
const analyzeStatus = document.getElementById('analyze-status');
const analyzeBar = document.getElementById('analyze-bar');
const analyzeDetail = document.getElementById('analyze-detail');

const waveformSection = document.getElementById('waveform-section');
const waveformCanvas = document.getElementById('waveform-canvas');
const waveformContainer = document.getElementById('waveform-container');
const cursorEl = document.getElementById('cursor');
const playBtn = document.getElementById('play-btn');
const timeDisplay = document.getElementById('time-display');
const zoomInBtn = document.getElementById('zoom-in-btn');
const zoomOutBtn = document.getElementById('zoom-out-btn');
const zoomFitBtn = document.getElementById('zoom-fit-btn');
const audioPlayer = document.getElementById('audio-player');

// ---- State ----
let currentAudioURL = null;
const renderer = new WaveformRenderer(waveformCanvas, waveformContainer, cursorEl);

// ---- File Upload ----

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) handleFileUpload(file);
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (file) handleFileUpload(file);
  fileInput.value = '';
});

async function handleFileUpload(file) {
  if (!file.type.startsWith('video/') && !file.name.match(/\.(mp4|mkv|webm|mov|avi)$/i)) {
    log('Please select a video file', 'error');
    return;
  }

  // Check quota
  const quota = await checkQuota();
  if (quota && file.size > quota.available) {
    log(`Not enough storage. Need ${formatBytes(file.size)}, available: ${formatBytes(quota.available)}`, 'error');
    return;
  }

  log(`Uploading: ${file.name} (${formatBytes(file.size)})`);
  show(uploadProgress);
  uploadStatus.textContent = `Storing ${file.name}...`;

  try {
    const meta = await storeFile(file, (stored, total) => {
      const pct = (stored / total) * 100;
      setProgress(uploadBar, pct);
      uploadDetail.textContent = `${formatBytes(stored)} / ${formatBytes(total)}`;
    });

    log(`Stored: ${meta.name} (${formatBytes(meta.size)})`, 'success');
    hide(uploadProgress);
    setProgress(uploadBar, 0);
    await refreshFileList();
  } catch (err) {
    log(`Upload failed: ${err.message}`, 'error');
    hide(uploadProgress);
  }
}

// ---- File List ----

async function refreshFileList() {
  const files = await listFiles();
  if (files.length === 0) {
    hide(filesSection);
    return;
  }

  show(filesSection);
  fileList.innerHTML = '';

  for (const meta of files) {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="file-info">
        <span class="file-name">${meta.name}</span>
        <span class="file-size">${formatBytes(meta.size)}</span>
      </div>
    `;

    const processBtn = document.createElement('button');
    processBtn.textContent = 'Extract & Visualize';
    processBtn.addEventListener('click', () => processFile(meta));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      await deleteFile(meta.id);
      log(`Deleted: ${meta.name}`);
      await refreshFileList();
    });

    li.appendChild(processBtn);
    li.appendChild(deleteBtn);
    fileList.appendChild(li);
  }
}

// ---- Processing Pipeline ----

async function processFile(meta) {
  show(processingSection);
  hide(waveformSection);

  // Clean up previous audio
  if (currentAudioURL) {
    URL.revokeObjectURL(currentAudioURL);
    currentAudioURL = null;
  }

  try {
    // Step 1: Load ffmpeg
    extractStatus.textContent = 'Loading ffmpeg.wasm...';
    setProgress(extractBar, 0);

    await loadFFmpeg((progress) => {
      setProgress(extractBar, progress * 30); // 0-30% for extraction progress
      extractDetail.textContent = `${Math.round(progress * 100)}%`;
    });

    // Step 2: Get file from IndexedDB
    extractStatus.textContent = `Reading ${meta.name} from storage...`;
    setProgress(extractBar, 0);
    const videoBlob = await getFileAsBlob(meta.id);
    log(`Read from IndexedDB: ${formatBytes(videoBlob.size)}`);

    // Check if file might be too large for WASM
    if (videoBlob.size > 2 * 1024 * 1024 * 1024) {
      log('File is >2GB — this may fail due to WASM memory limits. Attempting anyway...', 'warn');
    }

    // Step 3: Extract audio
    extractStatus.textContent = 'Extracting audio track...';
    setProgress(extractBar, 10);

    const audioBlob = await extractAudio(videoBlob, 'aac');
    setProgress(extractBar, 100);
    extractStatus.textContent = `Audio extracted: ${formatBytes(audioBlob.size)}`;

    // Step 4: Downsample for waveform analysis
    show(analyzeProgress);
    analyzeStatus.textContent = 'Downsampling audio for waveform analysis...';
    setProgress(analyzeBar, 10);

    const pcmSamples = await downsampleForAnalysis(audioBlob, 8000);
    setProgress(analyzeBar, 60);

    // Step 5: Extract peaks
    analyzeStatus.textContent = 'Extracting waveform peaks...';
    const containerWidth = waveformContainer.clientWidth || 1200;
    const targetWidth = Math.max(containerWidth, 2000);

    const peaks = extractPeaksFromPCM(pcmSamples, targetWidth, (p) => {
      setProgress(analyzeBar, 60 + p * 40);
    });

    setProgress(analyzeBar, 100);
    analyzeStatus.textContent = 'Analysis complete';

    // Step 6: Calculate duration from PCM data
    const duration = pcmSamples.length / 8000;

    // Step 7: Set up audio playback
    currentAudioURL = URL.createObjectURL(audioBlob);
    audioPlayer.src = currentAudioURL;

    // Step 8: Render waveform
    show(waveformSection);
    renderer.setPeaks(peaks, duration);

    // Wire up seek
    renderer.onSeek = (time) => {
      audioPlayer.currentTime = time;
      renderer.updateCursor(time);
      timeDisplay.textContent = `${formatTime(time)} / ${formatTime(duration)}`;
    };

    // Terminate ffmpeg to free memory
    terminateFFmpeg();

    log('Processing complete!', 'success');
  } catch (err) {
    log(`Processing failed: ${err.message}`, 'error');
    console.error(err);
  }
}

// ---- Playback Controls ----

playBtn.addEventListener('click', () => {
  if (audioPlayer.paused) {
    audioPlayer.play();
    playBtn.innerHTML = '&#9646;&#9646; Pause';
  } else {
    audioPlayer.pause();
    playBtn.innerHTML = '&#9654; Play';
  }
});

audioPlayer.addEventListener('ended', () => {
  playBtn.innerHTML = '&#9654; Play';
});

// Cursor animation
function updatePlayback() {
  if (!audioPlayer.paused) {
    renderer.updateCursor(audioPlayer.currentTime);
    timeDisplay.textContent = `${formatTime(audioPlayer.currentTime)} / ${formatTime(audioPlayer.duration || 0)}`;
  }
  requestAnimationFrame(updatePlayback);
}
requestAnimationFrame(updatePlayback);

// Zoom controls
zoomInBtn.addEventListener('click', () => renderer.zoomIn());
zoomOutBtn.addEventListener('click', () => renderer.zoomOut());
zoomFitBtn.addEventListener('click', () => renderer.zoomFit());

// ---- Init ----

(async function init() {
  log('Audio Waveform Extractor initialized');

  const quota = await checkQuota();
  if (quota) {
    log(`Storage: ${formatBytes(quota.usage)} used / ${formatBytes(quota.quota)} total`);
  }

  // Check for SharedArrayBuffer support
  if (typeof SharedArrayBuffer === 'undefined') {
    log('SharedArrayBuffer not available — ffmpeg will run in single-threaded mode (slower)', 'warn');
  }

  await refreshFileList();
})();
