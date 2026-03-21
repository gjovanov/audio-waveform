/**
 * Canvas-based waveform renderer with zoom, scroll, and playback cursor.
 */

import { log } from './utils.js';

export class WaveformRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {HTMLElement} container - scrollable parent
   * @param {HTMLElement} cursorEl - playback cursor element
   */
  constructor(canvas, container, cursorEl) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.container = container;
    this.cursorEl = cursorEl;
    this.peaks = null;
    this.zoom = 1;
    this.duration = 0; // seconds
    this.displayWidth = 0; // current rendered width in CSS pixels
    this.onSeek = null; // callback(timeInSeconds)

    this.container.addEventListener('click', (e) => this._handleClick(e));
  }

  /**
   * Set peak data and render.
   * @param {Array<{min: number, max: number}>} peaks
   * @param {number} duration - audio duration in seconds
   */
  setPeaks(peaks, duration) {
    this.peaks = peaks;
    this.duration = duration;
    this.zoom = 1;
    this.render();
    log(`Waveform rendered: ${peaks.length} points, ${duration.toFixed(1)}s`);
  }

  /**
   * Render the waveform at current zoom level.
   */
  render() {
    if (!this.peaks) return;

    const dpr = window.devicePixelRatio || 1;
    const containerWidth = this.container.clientWidth;
    const displayWidth = Math.max(containerWidth, Math.floor(this.peaks.length * this.zoom));
    const displayHeight = this.container.clientHeight;

    this.displayWidth = displayWidth;
    this.canvas.width = displayWidth * dpr;
    this.canvas.height = displayHeight * dpr;
    this.canvas.style.width = `${displayWidth}px`;
    this.canvas.style.height = `${displayHeight}px`;

    const ctx = this.ctx;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = '#0f3460';
    ctx.fillRect(0, 0, displayWidth, displayHeight);

    // Center line
    const centerY = displayHeight / 2;
    ctx.strokeStyle = '#1a4a7a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(displayWidth, centerY);
    ctx.stroke();

    // Draw waveform
    const peaksPerPixel = this.peaks.length / displayWidth;

    for (let x = 0; x < displayWidth; x++) {
      const peakIdx = Math.floor(x * peaksPerPixel);
      if (peakIdx >= this.peaks.length) break;

      const { min, max } = this.peaks[peakIdx];
      const amplitude = Math.max(Math.abs(min), Math.abs(max));

      // Color by amplitude
      let color;
      if (amplitude > 0.9) color = '#ef5350';       // clipping - red
      else if (amplitude > 0.7) color = '#ffa726';   // loud - orange
      else if (amplitude > 0.4) color = '#66bb6a';   // normal - green
      else color = '#4fc3f7';                         // quiet - blue

      const top = centerY + min * centerY;
      const bottom = centerY + max * centerY;
      const height = Math.max(1, bottom - top);

      ctx.fillStyle = color;
      ctx.fillRect(x, top, 1, height);
    }

    this.cursorEl.style.display = 'block';
  }

  /**
   * Set zoom level and re-render.
   */
  setZoom(level) {
    this.zoom = Math.max(0.1, Math.min(50, level));
    this.render();
  }

  zoomIn() { this.setZoom(this.zoom * 1.5); }
  zoomOut() { this.setZoom(this.zoom / 1.5); }
  zoomFit() { this.setZoom(1); }

  /**
   * Update playback cursor position.
   * @param {number} currentTime - current playback time in seconds
   */
  updateCursor(currentTime) {
    if (!this.duration || !this.displayWidth) return;
    const fraction = currentTime / this.duration;
    const x = fraction * this.displayWidth;
    this.cursorEl.style.left = `${x}px`;

    // Auto-scroll to keep cursor visible
    const scrollLeft = this.container.scrollLeft;
    const viewWidth = this.container.clientWidth;
    if (x < scrollLeft || x > scrollLeft + viewWidth) {
      this.container.scrollLeft = x - viewWidth / 2;
    }
  }

  _handleClick(e) {
    if (!this.duration || !this.displayWidth || !this.onSeek) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left + this.container.scrollLeft;
    const time = (x / this.displayWidth) * this.duration;
    this.onSeek(Math.max(0, Math.min(this.duration, time)));
  }
}
