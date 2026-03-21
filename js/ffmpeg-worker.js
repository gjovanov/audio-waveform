/**
 * ffmpeg.wasm integration for audio extraction.
 * Uses stream copy (-c:a copy) to avoid re-encoding — fast and memory-efficient.
 */

import { log } from './utils.js';

let ffmpeg = null;
let loaded = false;

const BASE = '/node_modules/@ffmpeg';
const CORE_URL = `${BASE}/core/dist/esm`;
const CORE_UMD_URL = `${BASE}/core/dist/umd`;

/**
 * Load ffmpeg.wasm. Must be called before extractAudio.
 * @param {function} onProgress - optional progress callback
 */
export async function loadFFmpeg(onProgress) {
  if (loaded) return;

  log('Loading ffmpeg.wasm...');

  const { FFmpeg } = await import(`${BASE}/ffmpeg/dist/esm/index.js`);

  ffmpeg = new FFmpeg();

  ffmpeg.on('log', ({ message }) => {
    log(`ffmpeg: ${message}`);
  });

  if (onProgress) {
    ffmpeg.on('progress', ({ progress, time }) => {
      onProgress(progress, time);
    });
  }

  // Try multi-threaded (requires SharedArrayBuffer + COOP/COEP), fall back to single-threaded
  try {
    await ffmpeg.load({
      coreURL: `${CORE_URL}/ffmpeg-core.js`,
      wasmURL: `${CORE_URL}/ffmpeg-core.wasm`,
    });
    log('ffmpeg.wasm loaded (multi-threaded)', 'success');
  } catch (e) {
    log(`Multi-threaded load failed: ${e.message}. Trying single-threaded...`, 'warn');
    await ffmpeg.load({
      coreURL: `${CORE_UMD_URL}/ffmpeg-core.js`,
      wasmURL: `${CORE_UMD_URL}/ffmpeg-core.wasm`,
    });
    log('ffmpeg.wasm loaded (single-threaded)', 'success');
  }

  loaded = true;
}

/**
 * Write a Blob to ffmpeg's virtual FS.
 * For files <=1.5GB: uses writeFile (loads into memory as Uint8Array).
 * For files >1.5GB: uses WORKERFS mount (reads from Blob on demand, no full copy).
 */
const LARGE_FILE_THRESHOLD = 1.5 * 1024 * 1024 * 1024; // 1.5GB

async function mountInput(blob, fileName) {
  if (blob.size <= LARGE_FILE_THRESHOLD) {
    log(`Writing ${fileName} to ffmpeg FS (${(blob.size / 1024 / 1024).toFixed(0)} MB)...`);
    const arrayBuffer = await blob.arrayBuffer();
    await ffmpeg.writeFile(fileName, new Uint8Array(arrayBuffer));
    log(`${fileName} written to ffmpeg FS`);
    return { inputPath: fileName, mounted: false };
  }

  // Large file: mount via WORKERFS so ffmpeg reads from Blob on demand
  const mountDir = '/input';
  log(`Mounting ${fileName} via WORKERFS (${(blob.size / 1024 / 1024).toFixed(0)} MB, avoids full memory copy)...`);
  await ffmpeg.createDir(mountDir);
  await ffmpeg.mount(
    'WORKERFS',
    { files: [new File([blob], fileName)] },
    mountDir,
  );
  log(`${fileName} mounted at ${mountDir}/${fileName}`);
  return { inputPath: `${mountDir}/${fileName}`, mounted: true, mountDir };
}

async function unmountInput(mountInfo) {
  if (mountInfo.mounted) {
    await ffmpeg.unmount(mountInfo.mountDir);
    await ffmpeg.deleteDir(mountInfo.mountDir);
  } else {
    await ffmpeg.deleteFile(mountInfo.inputPath);
  }
}

/**
 * Extract audio from a video Blob using stream copy (no re-encoding).
 * @param {Blob} videoBlob - the video file
 * @param {string} outputFormat - 'aac', 'mp3', or 'wav'
 * @returns {Promise<Blob>} - the extracted audio
 */
export async function extractAudio(videoBlob, outputFormat = 'aac') {
  if (!loaded) throw new Error('ffmpeg not loaded');

  const outputName = `output.${outputFormat}`;
  const mount = await mountInput(videoBlob, 'input.mp4');

  // Extract audio — stream copy is very fast
  const codecArgs = outputFormat === 'wav'
    ? ['-c:a', 'pcm_s16le']
    : ['-c:a', 'copy'];

  log(`Extracting audio (${outputFormat}, ${outputFormat === 'wav' ? 're-encode' : 'stream copy'})...`);

  await ffmpeg.exec([
    '-i', mount.inputPath,
    '-vn',           // no video
    '-sn',           // no subtitles
    ...codecArgs,
    outputName,
  ]);

  log('Audio extraction complete');

  // Read output (audio is small relative to video)
  const outputData = await ffmpeg.readFile(outputName);

  // Clean up
  await unmountInput(mount);
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
 * @param {number} sampleRate - target sample rate (default 16000)
 * @returns {Promise<{samples: Float32Array, sampleRate: number}>}
 */
export async function downsampleForAnalysis(audioBlob, sampleRate = 16000) {
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
  return { samples: float32, sampleRate };
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
