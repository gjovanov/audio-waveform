# Audio Waveform — Project Guide

Browser-only audio extraction and waveform visualization from large video files (up to 5 GB). Zero server-side processing — everything runs in the browser via ffmpeg.wasm, IndexedDB, and Canvas.

## Quick Start

```bash
bun install          # or: npm install
bun server.bun.js    # or: node server.js
# Open http://localhost:3000
```

Both servers set COOP/COEP headers required for SharedArrayBuffer (ffmpeg.wasm multi-threading).

## Tech Stack

- **Frontend**: Vanilla JS (ES modules), HTML5, CSS3 — no build step, no framework
- **Audio**: ffmpeg.wasm 0.12 (WebAssembly) — stream copy extraction, ffmpeg-based downsampling
- **Storage**: IndexedDB with 50 MB chunked Blob storage
- **Rendering**: HTML5 Canvas 2D (device-pixel-ratio aware)
- **Dev Server**: Node.js (`server.js`) or Bun (`server.bun.js`) — static files + COOP/COEP headers

## Architecture

Single-page app with 6 ES modules orchestrated by `app.js`:

```
app.js (controller)
├── utils.js          — log(), formatBytes(), formatTime(), show/hide, setProgress
├── file-store.js     — IndexedDB chunked storage (store, get, delete, list, quota)
├── ffmpeg-worker.js  — ffmpeg.wasm lifecycle, audio extraction, downsampling
├── audio-analyzer.js — peak extraction from float32 PCM samples
└── waveform-renderer.js — Canvas waveform with zoom, cursor, seek, auto-scroll
```

## Processing Pipeline

```
1. File upload (drag-drop / picker) → validate + quota check
2. Store in IndexedDB              → 50 MB Blob chunks via file-store.js
3. Load ffmpeg.wasm                → multi-threaded ESM, fallback to single-threaded UMD
4. Reassemble file                 → getFileAsBlob() — lazy Blob concatenation
5. Extract audio                   → -vn -c:a copy (stream copy, no re-encoding)
6. Downsample                      → 16 kHz mono float32 PCM via ffmpeg (8 kHz for >2hr files)
7. Extract peaks                   → one {min, max} pair per pixel bucket
8. Render waveform                 → Canvas with amplitude color coding
9. Playback sync                   → requestAnimationFrame cursor + auto-scroll
```

## Module Guide

### `js/app.js` (277 lines)
Main controller. Wires DOM events to modules. Handles file upload, processing pipeline orchestration, playback controls (play/pause/seek/zoom). Adaptive sample rate selection: 16 kHz for files under ~2 hours, 8 kHz fallback for longer files. Entry point loaded as ES module from `index.html`.

### `js/file-store.js` (163 lines)
IndexedDB wrapper. Database `audio-waveform-db` with two object stores: `file-meta` (keyPath: `id`) and `file-chunks` (manual keys `{id}-{i}`). Chunk size: 50 MB. `storeFile()` splits with `File.slice()`. `getFileAsBlob()` reassembles via `new Blob(chunks)` (lazy, no memory copy). `checkQuota()` uses `navigator.storage.estimate()`.

### `js/ffmpeg-worker.js` (191 lines)
ffmpeg.wasm integration. Dual-mode loading: ESM (multi-threaded, requires SharedArrayBuffer) with UMD fallback (single-threaded). `mountInput()` uses `writeFile()` for files ≤1.5 GB, WORKERFS mount for larger files (avoids ArrayBuffer limit). `extractAudio()` runs stream copy (`-c:a copy`). `downsampleForAnalysis()` produces 16 kHz mono float32 PCM (default), returns `{ samples, sampleRate }`. `terminate()` frees WASM heap.

### `js/audio-analyzer.js` (73 lines)
Peak extraction. `extractPeaksFromPCM()` is O(n) single-pass: groups float32 samples into buckets matching pixel width, finds min/max per bucket. Fallback `extractPeaksViaAudioContext()` for small files (<50 MB).

### `js/waveform-renderer.js` (139 lines)
Canvas renderer. `WaveformRenderer` class handles: device-pixel-ratio scaling, mirrored waveform drawing with amplitude color coding (blue <0.4, green <0.7, orange <0.9, red ≥0.9), zoom (0.1x–50x), click-to-seek, playback cursor positioning, auto-scroll.

### `js/utils.js` (42 lines)
Shared helpers: `log()` appends timestamped entries to log panel, `formatBytes()`, `formatTime()`, `show()`/`hide()`, `setProgress()`.

### `index.html` (83 lines)
Single HTML page with sections: upload (drop zone + file picker), stored files list, processing progress, waveform (canvas + controls), log panel. Loads `app.js` as ES module.

### `css/styles.css` (246 lines)
Dark theme (`#1a1a2e` background, `#4fc3f7` cyan accent). Responsive layout. Waveform container with horizontal scroll. Progress bars. Log panel with color-coded entries.

### `server.js` / `server.bun.js`
Minimal static file servers on port 3000. Both set `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` on all responses.

## Key Design Decisions

1. **Stream copy** (`-c:a copy`) — extracts audio without re-encoding. Seconds instead of minutes for 2-hour videos.
2. **50 MB chunks** — balance between IDB transaction limits and overhead. Proven across Chrome, Firefox, Edge.
3. **1.5 GB threshold** — files above this use WORKERFS mount (Emscripten virtual FS reading from Blob on-demand) to avoid ArrayBuffer limits.
4. **16 kHz mono downsampling** (adaptive) — default 16 kHz for smoother waveforms (~460 MB for 2hr). Falls back to 8 kHz for files over 2 hours to cap memory at ~460 MB.
5. **One peak per pixel** — no oversampling, no interpolation. Exact pixel-column amplitude representation.
6. **No build step** — pure ES modules served directly. No bundler, no transpiler.

## Memory Strategy

| Stage | Memory | Strategy |
|-------|--------|----------|
| Upload (5 GB) | ~50 MB/chunk | `File.slice()` → IndexedDB |
| Reassemble | ~0 bytes | `new Blob(chunks)` is lazy |
| Extract (≤1.5 GB) | ≤1.5 GB | `writeFile()` to WASM heap |
| Extract (>1.5 GB) | ~0 bytes | WORKERFS mount (on-demand) |
| Audio output | ~30-50 MB | AAC Blob |
| Downsample | ≤460 MB | Float32Array at 16 kHz mono (8 kHz for >2hr) |
| Peaks | ~50 KB | `[{min, max}]` array |

## Browser Requirements

- SharedArrayBuffer + COOP/COEP headers (multi-threaded ffmpeg)
- IndexedDB (chunked storage)
- WebAssembly (ffmpeg.wasm)
- Canvas 2D (waveform)
- Tested: Chrome 120+, Firefox 120+, Edge 120+. Safari falls back to single-threaded.

## Documentation

- `docs/architecture.md` — system overview, pipeline, memory strategy
- `docs/storage.md` — IndexedDB schema, chunking, quota
- `docs/extraction.md` — ffmpeg.wasm loading, WORKERFS, codec strategies
- `docs/waveform.md` — analysis, rendering, playback sync
