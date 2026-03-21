/**
 * Audio analysis — extracts peak waveform data from PCM samples.
 */

import { log } from './utils.js';

/**
 * Extract waveform peaks from raw float32 PCM data.
 * Returns an array of {min, max} pairs — one per "bucket" (pixel column).
 *
 * @param {Float32Array} samples - mono PCM samples
 * @param {number} targetWidth - number of buckets (canvas pixel width)
 * @param {function} onProgress - optional progress callback (0-1)
 * @returns {{peaks: Array<{min: number, max: number}>, sampleRate: number}}
 */
export function extractPeaksFromPCM(samples, targetWidth, onProgress) {
  const bucketSize = Math.max(1, Math.floor(samples.length / targetWidth));
  const peaks = [];

  for (let i = 0; i < targetWidth; i++) {
    const start = i * bucketSize;
    const end = Math.min(start + bucketSize, samples.length);

    let min = 1;
    let max = -1;

    for (let j = start; j < end; j++) {
      const val = samples[j];
      if (val < min) min = val;
      if (val > max) max = val;
    }

    peaks.push({ min, max });

    if (onProgress && i % 1000 === 0) {
      onProgress(i / targetWidth);
    }
  }

  if (onProgress) onProgress(1);
  log(`Extracted ${peaks.length} peak buckets from ${samples.length} samples`, 'success');
  return peaks;
}

