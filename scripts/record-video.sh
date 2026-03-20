#!/usr/bin/env bash
set -e

# ---------------------------------------------------------------------------
# Audio Waveform — Intro Video Recorder
#
# Records a Playwright walkthrough of the app, converts to MP4,
# and overlays background music.
#
# Prerequisites:
#   1. Dev server running:  bun server.bun.js  (or node server.js)
#   2. Playwright installed: cd e2e && npm install
#   3. Sample video at:     e2e/video/sample.mp4
#   4. ffmpeg installed (for WebM → MP4 conversion + music overlay)
#
# Usage:
#   ./scripts/record-video.sh
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
E2E_DIR="$PROJECT_ROOT/e2e"
VIDEO_DIR="$E2E_DIR/video"
RESULTS_DIR="$E2E_DIR/test-results"
MUSIC_FILE="$VIDEO_DIR/background-music.mp3"
OUTPUT_FILE="$PROJECT_ROOT/audio-waveform-intro.mp4"

echo "=== Audio Waveform Intro Video Recorder ==="
echo ""

# Check prerequisites
if ! command -v ffmpeg &> /dev/null; then
  echo "WARNING: ffmpeg not found. Will record WebM but cannot convert to MP4."
  echo "Install ffmpeg: sudo apt install ffmpeg  (or: brew install ffmpeg)"
  echo ""
fi

if [ ! -f "$VIDEO_DIR/sample.mp4" ]; then
  echo "ERROR: Sample video not found at $VIDEO_DIR/sample.mp4"
  echo ""
  echo "You need a sample video file for the demo. Options:"
  echo "  1. Copy any .mp4 file:  cp /path/to/video.mp4 $VIDEO_DIR/sample.mp4"
  echo "  2. Download a sample:   curl -L -o $VIDEO_DIR/sample.mp4 <url>"
  echo ""
  exit 1
fi

# Clean previous results
rm -rf "$RESULTS_DIR"

# Create a timestamp file to help locate the video after recording
TIMESTAMP_FILE=$(mktemp)
touch "$TIMESTAMP_FILE"

echo "Step 1/3: Recording Playwright walkthrough..."
echo ""

cd "$E2E_DIR"
npx playwright test video/record-intro.spec.ts --config=playwright.video.config.ts 2>&1 || true

echo ""
echo "Step 2/3: Locating recorded video..."

# Find the WebM file in test results
WEBM_FILE=""

# Try to find by timestamp first (newer than our marker)
if [ -f "$TIMESTAMP_FILE" ]; then
  WEBM_FILE=$(find "$RESULTS_DIR" -name "*.webm" -newer "$TIMESTAMP_FILE" -type f 2>/dev/null | head -1)
fi

# Fallback: find any WebM
if [ -z "$WEBM_FILE" ]; then
  WEBM_FILE=$(find "$RESULTS_DIR" -name "*.webm" -type f 2>/dev/null | head -1)
fi

rm -f "$TIMESTAMP_FILE"

if [ -z "$WEBM_FILE" ]; then
  echo "ERROR: No WebM video found in $RESULTS_DIR"
  echo "Check the Playwright test output above for errors."
  exit 1
fi

echo "Found: $WEBM_FILE"
echo ""

# Convert to MP4 with background music
echo "Step 3/3: Converting to MP4 with background music..."

if command -v ffmpeg &> /dev/null; then
  if [ -f "$MUSIC_FILE" ]; then
    # Overlay background music (loop music, mix at lower volume, keep original audio if any)
    ffmpeg -y \
      -i "$WEBM_FILE" \
      -stream_loop -1 -i "$MUSIC_FILE" \
      -filter_complex "[1:a]volume=0.3[music];[0:a][music]amix=inputs=2:duration=shortest[aout]" \
      -map 0:v -map "[aout]" \
      -c:v libx264 -preset slow -crf 18 \
      -c:a aac -b:a 192k \
      -shortest \
      "$OUTPUT_FILE" 2>&1
  else
    # No music file — just convert video
    echo "NOTE: No background music found at $MUSIC_FILE — converting without music."
    ffmpeg -y \
      -i "$WEBM_FILE" \
      -c:v libx264 -preset slow -crf 18 \
      -c:a aac -b:a 192k \
      "$OUTPUT_FILE" 2>&1
  fi

  echo ""
  echo "=== Done! ==="
  echo "Output: $OUTPUT_FILE"
  echo "Size: $(du -h "$OUTPUT_FILE" | cut -f1)"
  echo ""
  echo "Next steps:"
  echo "  1. Review the video: mpv $OUTPUT_FILE"
  echo "  2. Upload to YouTube or embed in README"
else
  # No ffmpeg — copy the raw WebM
  cp "$WEBM_FILE" "$PROJECT_ROOT/audio-waveform-intro.webm"
  echo ""
  echo "=== Partial Done ==="
  echo "Raw WebM saved to: $PROJECT_ROOT/audio-waveform-intro.webm"
  echo ""
  echo "To convert to MP4 with music, install ffmpeg and run:"
  echo "  ffmpeg -y -i audio-waveform-intro.webm -stream_loop -1 -i $MUSIC_FILE \\"
  echo "    -filter_complex '[1:a]volume=0.3[music];[0:a][music]amix=inputs=2:duration=shortest[aout]' \\"
  echo "    -map 0:v -map '[aout]' -c:v libx264 -preset slow -crf 18 -c:a aac -b:a 192k \\"
  echo "    -shortest audio-waveform-intro.mp4"
fi
