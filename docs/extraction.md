# Audio Extraction

## ffmpeg.wasm Loading

```mermaid
sequenceDiagram
    participant APP as app.js
    participant FF as ffmpeg-worker.js
    participant WASM as ffmpeg.wasm

    APP->>FF: loadFFmpeg(onProgress)
    FF->>FF: import('@ffmpeg/ffmpeg')
    FF->>FF: new FFmpeg()
    FF->>FF: Register log + progress handlers

    alt SharedArrayBuffer available (COOP/COEP headers set)
        FF->>WASM: load(esm/ffmpeg-core.js, esm/ffmpeg-core.wasm)
        WASM-->>FF: Multi-threaded mode
    else SharedArrayBuffer unavailable
        FF->>WASM: load(umd/ffmpeg-core.js, umd/ffmpeg-core.wasm)
        WASM-->>FF: Single-threaded mode (slower)
    end

    FF-->>APP: loaded = true
```

### Build Variants

| Variant | Path | SharedArrayBuffer | Performance |
|---------|------|-------------------|-------------|
| ESM (multi-threaded) | `@ffmpeg/core/dist/esm/` | Required | Fast |
| UMD (single-threaded) | `@ffmpeg/core/dist/umd/` | Not required | ~3-5x slower |

The app tries multi-threaded first and falls back automatically. Single-threaded mode still works — just slower for re-encoding operations. Stream copy (`-c:a copy`) is fast regardless.

## Input Strategy: Small vs Large Files

```mermaid
graph TD
    INPUT["Video Blob from IndexedDB"]
    CHECK{"blob.size > 1.5 GB?"}

    subgraph Small["≤ 1.5 GB: writeFile"]
        AB["blob.arrayBuffer()"]
        U8["new Uint8Array(buffer)"]
        WF["ffmpeg.writeFile('input.mp4', uint8)"]
    end

    subgraph Large["> 1.5 GB: WORKERFS"]
        DIR["ffmpeg.createDir('/input')"]
        MNT["ffmpeg.mount('WORKERFS',<br/>{files: [File]}, '/input')"]
        REF["Reference: /input/input.mp4"]
    end

    INPUT --> CHECK
    CHECK -->|No| AB --> U8 --> WF
    CHECK -->|Yes| DIR --> MNT --> REF

    style INPUT fill:#4fc3f7,color:#1a1a2e
    style CHECK fill:#ffa726,color:#1a1a2e
    style AB fill:#78909c,color:#fff
    style U8 fill:#78909c,color:#fff
    style WF fill:#78909c,color:#fff
    style DIR fill:#66bb6a,color:#1a1a2e
    style MNT fill:#66bb6a,color:#1a1a2e
    style REF fill:#66bb6a,color:#1a1a2e
```

### Why 1.5 GB Threshold?

- `Blob.arrayBuffer()` returns an `ArrayBuffer` — limited to ~2 GB in most browsers
- `Uint8Array` backed by that buffer has the same limit
- The 1.5 GB threshold provides safety margin for the browser's own memory overhead
- WORKERFS reads from the Blob on demand without copying — zero additional memory cost

### WORKERFS Mount

WORKERFS is an Emscripten filesystem type that provides read-only access to browser `File`/`Blob` objects. ffmpeg.wasm can read from the mounted file as if it were a regular file on disk:

```
/input/input.mp4  →  reads from Blob via file.slice() internally
```

After extraction completes, the mount is cleaned up:

```js
await ffmpeg.unmount('/input');
await ffmpeg.deleteDir('/input');
```

## Extraction Command

```
ffmpeg -i input.mp4 -vn -sn -c:a copy output.aac
```

| Flag | Purpose |
|------|---------|
| `-i input.mp4` | Input file (MEMFS path or WORKERFS mount path) |
| `-vn` | No video output |
| `-sn` | No subtitle output |
| `-c:a copy` | Stream copy audio (no re-encoding) |
| `output.aac` | Output file in MEMFS |

**Stream copy is critical** — it copies the audio bitstream without decoding/re-encoding, making it:
- Extremely fast (seconds, not minutes)
- Lossless (bit-identical to the original audio track)
- Low memory (no decode buffers needed)

The output file is typically 30-50 MB for a 2-hour video, easily fitting in WASM memory.

## Downsampling for Waveform Analysis

After extraction, the audio is downsampled for efficient waveform analysis:

```
ffmpeg -i audio.aac -ac 1 -ar 16000 -f f32le -acodec pcm_f32le output.raw
```

| Flag | Purpose |
|------|---------|
| `-ac 1` | Mono (single channel) |
| `-ar 16000` | 16 kHz sample rate (default; 8 kHz for files over 2 hours) |
| `-f f32le` | Raw float32 little-endian output |
| `-acodec pcm_f32le` | 32-bit float PCM codec |

### Adaptive Sample Rate

The sample rate is chosen automatically based on estimated audio duration:

- **≤ 2 hours**: 16 kHz — smoother waveforms, better peak accuracy per pixel bucket
- **> 2 hours**: 8 kHz — halves memory usage to stay within ~460 MB budget

### Output Size

| Input Duration | 16 kHz Samples | 16 kHz Size | 8 kHz Samples | 8 kHz Size |
|---------------|---------------|-------------|--------------|------------|
| 30 min | 28.8 M | ~115 MB | 14.4 M | ~55 MB |
| 1 hour | 57.6 M | ~230 MB | 28.8 M | ~110 MB |
| 2 hours | 115.2 M | ~460 MB | 57.6 M | ~230 MB |
| 3 hours | — (falls back) | — | 86.4 M | ~330 MB |

This produces a `Float32Array` that fits comfortably in JavaScript heap memory and can be processed for peak extraction without chunking.

## Cleanup and Memory Management

```mermaid
graph LR
    EXT["Extraction Done"]
    DEL_IN["Delete input from WASM FS<br/>or unmount WORKERFS"]
    DEL_OUT["Delete output from WASM FS"]
    TERM["ffmpeg.terminate()<br/>Free WASM heap"]
    REVOKE["URL.revokeObjectURL()<br/>when done playing"]

    EXT --> DEL_IN --> DEL_OUT --> TERM --> REVOKE

    style EXT fill:#66bb6a,color:#1a1a2e
    style DEL_IN fill:#ffa726,color:#1a1a2e
    style DEL_OUT fill:#ffa726,color:#1a1a2e
    style TERM fill:#ef5350,color:#fff
    style REVOKE fill:#ef5350,color:#fff
```

After the full pipeline completes, `ffmpeg.terminate()` is called to free the entire WASM heap. Object URLs are revoked when replaced or when the page unloads.
