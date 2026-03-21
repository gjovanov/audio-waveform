# Architecture

## System Overview

```mermaid
graph TB
    subgraph Browser["Browser — All Processing Happens Here"]
        direction TB
        subgraph UI_Layer["UI Layer"]
            DROP["Drop Zone<br/>File picker · Drag-and-drop"]
            CONTROLS["Controls<br/>Play · Pause · Zoom · Seek"]
            LOG["Log Panel<br/>Status · Errors · Timing"]
        end

        subgraph Storage_Layer["Storage Layer"]
            IDB[("IndexedDB<br/>file-meta + file-chunks stores")]
        end

        subgraph Processing_Layer["Processing Layer"]
            FFMPEG["ffmpeg.wasm 0.12<br/>WebAssembly runtime"]
            WASM_FS["WASM Virtual FS<br/>MEMFS (small) · WORKERFS (large)"]
        end

        subgraph Analysis_Layer["Analysis Layer"]
            DOWNSAMPLE["Downsampler<br/>16kHz mono float32 PCM"]
            PEAKS["Peak Extractor<br/>min/max per pixel bucket"]
        end

        subgraph Render_Layer["Render Layer"]
            CANVAS["Canvas 2D<br/>Waveform · DPR-aware"]
            CURSOR["Playback Cursor<br/>requestAnimationFrame sync"]
            PLAYER["&lt;audio&gt; Element<br/>Object URL from Blob"]
        end
    end

    subgraph Server["Dev Server (static only)"]
        STATIC["Node.js / Bun<br/>COOP + COEP headers<br/>:3000"]
    end

    DROP -->|"File object"| IDB
    IDB -->|"Reassembled Blob"| FFMPEG
    FFMPEG --> WASM_FS
    WASM_FS -->|"Audio Blob (AAC)"| PLAYER
    WASM_FS -->|"Audio Blob"| DOWNSAMPLE
    DOWNSAMPLE -->|"Float32Array"| PEAKS
    PEAKS -->|"[{min,max}]"| CANVAS
    CONTROLS --> PLAYER
    PLAYER -->|"currentTime"| CURSOR
    CURSOR --> CANVAS

    STATIC -.->|"serves HTML/JS/CSS/WASM"| Browser

    style DROP fill:#4fc3f7,color:#1a1a2e
    style CONTROLS fill:#4fc3f7,color:#1a1a2e
    style LOG fill:#4fc3f7,color:#1a1a2e
    style IDB fill:#78909c,color:#fff
    style FFMPEG fill:#e65100,color:#fff
    style WASM_FS fill:#e65100,color:#fff
    style DOWNSAMPLE fill:#00695c,color:#fff
    style PEAKS fill:#00695c,color:#fff
    style CANVAS fill:#0f3460,color:#fff
    style CURSOR fill:#0f3460,color:#fff
    style PLAYER fill:#1565c0,color:#fff
    style STATIC fill:#ff9800,color:#fff
```

All audio extraction, analysis, and rendering happens in the browser. The server exists only to serve static files with the correct COOP/COEP headers required for SharedArrayBuffer.

## Processing Pipeline

```mermaid
sequenceDiagram
    participant U as User
    participant UI as app.js
    participant FS as file-store.js
    participant IDB as IndexedDB
    participant FF as ffmpeg-worker.js
    participant WASM as ffmpeg.wasm
    participant AN as audio-analyzer.js
    participant WR as waveform-renderer.js
    participant AP as <audio> Element

    U->>UI: Drop video file (2 GB)
    UI->>FS: storeFile(file)
    loop Every 50 MB chunk
        FS->>IDB: put(chunk Blob)
        FS-->>UI: onProgress(stored, total)
    end
    FS-->>UI: {id, name, size}

    U->>UI: Click "Extract & Visualize"
    UI->>FF: loadFFmpeg()
    FF->>WASM: load(coreURL, wasmURL)
    FF-->>UI: ready

    UI->>FS: getFileAsBlob(id)
    FS->>IDB: get chunks 0..N
    FS-->>UI: Blob (lazy, not in memory)

    UI->>FF: extractAudio(blob, 'aac')
    alt File ≤ 1.5 GB
        FF->>WASM: writeFile(uint8array)
    else File > 1.5 GB
        FF->>WASM: mount('WORKERFS', {files: [blob]})
    end
    FF->>WASM: exec(['-i','input','-vn','-c:a','copy','output.aac'])
    WASM-->>FF: output.aac
    FF-->>UI: Audio Blob (~30 MB)

    UI->>FF: downsampleForAnalysis(audioBlob, 16000)
    FF->>WASM: exec(['-i','input','-ac','1','-ar','16000','-f','f32le','output.raw'])
    WASM-->>FF: Float32Array
    FF-->>UI: PCM samples

    UI->>AN: extractPeaksFromPCM(samples, width)
    AN-->>UI: [{min, max}, ...]

    UI->>WR: setPeaks(peaks, duration)
    WR->>WR: render() on Canvas

    UI->>AP: src = objectURL(audioBlob)

    U->>UI: Click Play
    UI->>AP: play()
    loop requestAnimationFrame
        AP-->>WR: updateCursor(currentTime)
    end

    U->>WR: Click on waveform
    WR->>AP: seek(time)
```

## Memory Strategy

Large video files are the primary challenge. This diagram shows how memory is managed at each stage:

```mermaid
graph LR
    subgraph Upload["1. Upload"]
        F["File (5 GB on disk)"]
        S["file.slice() → 50 MB Blob"]
    end

    subgraph Store["2. IndexedDB"]
        C["100× Blob chunks<br/>disk-backed, not in heap"]
    end

    subgraph Reassemble["3. Reassemble"]
        B["new Blob(chunks)<br/>lazy, ~0 bytes in heap"]
    end

    subgraph Extract["4. ffmpeg"]
        direction TB
        SMALL["≤1.5 GB: writeFile<br/>~1.5 GB in WASM heap"]
        LARGE["&gt;1.5 GB: WORKERFS<br/>~0 bytes in WASM heap<br/>reads from Blob on demand"]
    end

    subgraph Output["5. Audio Output"]
        AAC["AAC Blob<br/>~30-50 MB"]
    end

    subgraph Analyze["6. Downsample"]
        PCM["Float32Array<br/>~460 MB (2hr @ 16kHz)"]
    end

    subgraph Render["7. Peaks"]
        PK["[{min,max}]<br/>~50 KB"]
    end

    F --> S --> C --> B
    B --> SMALL
    B --> LARGE
    SMALL --> AAC
    LARGE --> AAC
    AAC --> PCM --> PK

    style F fill:#78909c,color:#fff
    style S fill:#78909c,color:#fff
    style C fill:#78909c,color:#fff
    style B fill:#4fc3f7,color:#1a1a2e
    style SMALL fill:#ffa726,color:#1a1a2e
    style LARGE fill:#66bb6a,color:#1a1a2e
    style AAC fill:#4fc3f7,color:#1a1a2e
    style PCM fill:#ffa726,color:#1a1a2e
    style PK fill:#66bb6a,color:#1a1a2e
```

**Key insight:** At no point is the full 5 GB video loaded into JavaScript heap memory. IndexedDB stores disk-backed Blobs, `new Blob(chunks)` is lazy, and WORKERFS lets ffmpeg read from the Blob on demand.

## Module Structure

```mermaid
graph LR
    APP["app.js<br/>Main controller"]
    UTILS["utils.js<br/>log · formatBytes · formatTime"]
    FS["file-store.js<br/>IndexedDB chunked I/O"]
    FF["ffmpeg-worker.js<br/>Load · Extract · Downsample"]
    AN["audio-analyzer.js<br/>Peak extraction"]
    WR["waveform-renderer.js<br/>Canvas + cursor"]

    APP --> UTILS
    APP --> FS
    APP --> FF
    APP --> AN
    APP --> WR
    FF --> UTILS
    AN --> UTILS

    style APP fill:#e65100,color:#fff
    style UTILS fill:#78909c,color:#fff
    style FS fill:#1565c0,color:#fff
    style FF fill:#e65100,color:#fff
    style AN fill:#00695c,color:#fff
    style WR fill:#0f3460,color:#fff
```

| Module | Responsibility | Key APIs |
|--------|---------------|----------|
| `app.js` | Wires everything together, handles UI events | DOM events, pipeline orchestration |
| `utils.js` | Logging, formatting, DOM helpers | `log()`, `formatBytes()`, `setProgress()` |
| `file-store.js` | Chunked IndexedDB storage | `storeFile()`, `getFileAsBlob()`, `deleteFile()` |
| `ffmpeg-worker.js` | ffmpeg.wasm lifecycle, audio extraction | `loadFFmpeg()`, `extractAudio()`, `downsampleForAnalysis()` |
| `audio-analyzer.js` | Peak extraction from PCM data | `extractPeaksFromPCM()` |
| `waveform-renderer.js` | Canvas rendering, zoom, playback cursor | `WaveformRenderer` class |

## COOP/COEP Headers

ffmpeg.wasm's multi-threaded mode uses `SharedArrayBuffer`, which requires cross-origin isolation:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Both `server.js` (Node.js) and `server.bun.js` (Bun) set these headers on every response. Without them, the browser falls back to single-threaded ffmpeg (slower but functional).

For production deployment on Netlify, Cloudflare Pages, or similar, configure these headers in the platform's `_headers` file or equivalent.
