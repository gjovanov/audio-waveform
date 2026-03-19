/**
 * ffmpeg.wasm integration for audio extraction.
 * Uses stream copy (-c:a copy) to avoid re-encoding — fast and memory-efficient.
 */

import { log } from './utils.js';

let ffmpeg = null;
let loaded = false;

const FFMPEG_CORE_URL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';

/**
 * Load ffmpeg.wasm. Must be called before extractAudio.
 * @param {function} onProgress - optional progress callback
 */
export async function loadFFmpeg(onProgress) {
  if (loaded) return;

  log('Loading ffmpeg.wasm...');

  // Dynamic import from CDN
  const { FFmpeg } = await import('https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js');

  ffmpeg = new FFmpeg();

  ffmpeg.on('log', ({ message }) => {
    log(`ffmpeg: ${message}`);
  });

  if (onProgress) {
    ffmpeg.on('progress', ({ progress, time }) => {
      onProgress(progress, time);
    });
  }

  // Try multi-threaded first, fall back to single-threaded
  try {
    await ffmpeg.load({
      coreURL: `${FFMPEG_CORE_URL}/ffmpeg-core.js`,
      wasmURL: `${FFMPEG_CORE_URL}/ffmpeg-core.wasm`,
      workerURL: `${FFMPEG_CORE_URL}/ffmpeg-core.worker.js`,
    });
    log('ffmpeg.wasm loaded (multi-threaded)', 'success');
  } catch (e) {
    log(`Multi-threaded load failed: ${e.message}. Trying single-threaded...`, 'warn');
    const ST_URL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
    await ffmpeg.load({
      coreURL: `${ST_URL}/ffmpeg-core.js`,
      wasmURL: `${ST_URL}/ffmpeg-core.wasm`,
    });
    log('ffmpeg.wasm loaded (single-threaded)', 'success');
  }

  loaded = true;
}

/**
 * Extract audio from a video Blob using stream copy (no re-encoding).
 * @param {Blob} videoBlob - the video file
 * @param {string} outputFormat - 'aac', 'mp3', or 'wav'
 * @returns {Promise<Blob>} - the extracted audio
 */
export async function extractAudio(videoBlob, outputFormat = 'aac') {
  if (!loaded) throw new Error('ffmpeg not loaded');

  const inputName = 'input.mp4';
  const outputName = `output.${outputFormat}`;

  log(`Writing video to ffmpeg FS (${(videoBlob.size / 1024 / 1024).toFixed(0)} MB)...`);

  // Convert Blob to Uint8Array
  const arrayBuffer = await videoBlob.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);

  await ffmpeg.writeFile(inputName, uint8);
  log('Video written to ffmpeg FS');

  // Extract audio — stream copy is very fast
  const codecArgs = outputFormat === 'wav'
    ? ['-c:a', 'pcm_s16le']
    : ['-c:a', 'copy'];

  log(`Extracting audio (${outputFormat}, ${outputFormat === 'wav' ? 're-encode' : 'stream copy'})...`);

  await ffmpeg.exec([
    '-i', inputName,
    '-vn',           // no video
    '-sn',           // no subtitles
    ...codecArgs,
    outputName,
  ]);

  log('Audio extraction complete');

  // Read output
  const outputData = await ffmpeg.readFile(outputName);

  // Clean up ffmpeg FS
  await ffmpeg.deleteFile(inputName);
  await ffmpeg.deleteFile(outputName);

  const audioBlob = new Blob([outputData.buffer], {
    type: outputFormat === 'wav' ? 'audio/wav'
        : outputFormat === 'mp3' ? 'audio/mpeg'
        : 'audio/aac',
  });

  log(`Extracted audio: ${(audioBlob.size / 1024 / 1024).toFixed(2)} MB`, 'success');
  return audioBlob;
}

/**
 * Downsample audio to low-rate mono PCM for waveform analysis.
 * Produces a small float32 raw PCM buffer suitable for peak extraction.
 * @param {Blob} audioBlob - extracted audio
 * @param {number} sampleRate - target sample rate (default 8000)
 * @returns {Promise<Float32Array>} - raw PCM samples
 */
export async function downsampleForAnalysis(audioBlob, sampleRate = 8000) {
  if (!loaded) throw new Error('ffmpeg not loaded');

  const inputName = 'analysis_input';
  const outputName = 'analysis_output.raw';

  log(`Downsampling audio to ${sampleRate}Hz mono for waveform analysis...`);

  const arrayBuffer = await audioBlob.arrayBuffer();
  await ffmpeg.writeFile(inputName, new Uint8Array(arrayBuffer));

  await ffmpeg.exec([
    '-i', inputName,
    '-ac', '1',                    // mono
    '-ar', sampleRate.toString(),  // target sample rate
    '-f', 'f32le',                 // 32-bit float little-endian
    '-acodec', 'pcm_f32le',
    outputName,
  ]);

  const rawData = await ffmpeg.readFile(outputName);

  await ffmpeg.deleteFile(inputName);
  await ffmpeg.deleteFile(outputName);

  const float32 = new Float32Array(rawData.buffer);
  const durationSec = float32.length / sampleRate;

  log(`Downsampled: ${float32.length} samples (${durationSec.toFixed(1)}s at ${sampleRate}Hz)`, 'success');
  return float32;
}

/**
 * Terminate ffmpeg instance and free resources.
 */
export function terminate() {
  if (ffmpeg) {
    ffmpeg.terminate();
    ffmpeg = null;
    loaded = false;
    log('ffmpeg terminated');
  }
}
