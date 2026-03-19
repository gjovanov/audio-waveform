# Waveform Visualization

## Analysis Pipeline

```mermaid
graph LR
    RAW["Float32Array<br/>8kHz mono PCM<br/>(from ffmpeg)"]
    BUCKET["Bucket by pixel width<br/>samplesPerBucket = length / targetWidth"]
    PEAKS["Extract min/max per bucket"]
    DATA["peaks: [{min, max}, ...]<br/>one entry per pixel column"]

    RAW --> BUCKET --> PEAKS --> DATA

    style RAW fill:#00695c,color:#fff
    style BUCKET fill:#00695c,color:#fff
    style PEAKS fill:#00695c,color:#fff
    style DATA fill:#4fc3f7,color:#1a1a2e
```

### Peak Extraction Algorithm

For each pixel column (bucket) of the target width:

1. Calculate the range of samples: `start = i * bucketSize`, `end = start + bucketSize`
2. Scan all samples in the range to find minimum and maximum values
3. Store `{min, max}` — these represent the waveform's negative and positive peaks at that pixel

This produces one `{min, max}` pair per pixel column, giving pixel-perfect resolution regardless of audio length or canvas width.

### Analysis Strategies

```mermaid
graph TD
    AUDIO["Extracted Audio Blob"]
    SIZE{"Blob size?"}

    subgraph Primary["Primary: ffmpeg Downsample"]
        DS["ffmpeg → 8kHz mono float32"]
        PCM["Float32Array (~230 MB for 2hr)"]
        PK1["extractPeaksFromPCM()"]
    end

    subgraph Fallback["Fallback: AudioContext"]
        DEC["AudioContext.decodeAudioData()"]
        BUF["AudioBuffer.getChannelData(0)"]
        PK2["extractPeaksFromPCM()"]
    end

    AUDIO --> SIZE
    SIZE -->|"Any size (recommended)"| DS --> PCM --> PK1
    SIZE -->|"< 50 MB only"| DEC --> BUF --> PK2

    style AUDIO fill:#4fc3f7,color:#1a1a2e
    style SIZE fill:#ffa726,color:#1a1a2e
    style DS fill:#66bb6a,color:#1a1a2e
    style PCM fill:#66bb6a,color:#1a1a2e
    style PK1 fill:#66bb6a,color:#1a1a2e
    style DEC fill:#78909c,color:#fff
    style BUF fill:#78909c,color:#fff
    style PK2 fill:#78909c,color:#fff
```

The ffmpeg-based downsampling is the primary strategy because:
- Works for any file size (the downsampled output is always manageable)
- Predictable memory usage (Float32Array at 8 kHz mono)
- No browser `decodeAudioData` quirks or memory limits

The `AudioContext.decodeAudioData()` fallback is available for small files but is not used in the default pipeline.

## Canvas Rendering

```mermaid
graph TB
    subgraph Canvas["Canvas 2D (DPR-aware)"]
        BG["Background fill<br/>#0f3460"]
        CENTER["Center line<br/>#1a4a7a"]
        WAVE["Waveform bars<br/>1px wide, mirrored"]
        CURSOR["Playback cursor<br/>2px red line"]
    end

    subgraph Colors["Amplitude Color Map"]
        BLUE["< 0.4 amplitude<br/>#4fc3f7 (quiet)"]
        GREEN["0.4 – 0.7<br/>#66bb6a (normal)"]
        ORANGE["0.7 – 0.9<br/>#ffa726 (loud)"]
        RED["> 0.9<br/>#ef5350 (clipping)"]
    end

    Colors --> WAVE

    style BG fill:#0f3460,color:#fff
    style CENTER fill:#1a4a7a,color:#fff
    style WAVE fill:#66bb6a,color:#1a1a2e
    style CURSOR fill:#ef5350,color:#fff
    style BLUE fill:#4fc3f7,color:#1a1a2e
    style GREEN fill:#66bb6a,color:#1a1a2e
    style ORANGE fill:#ffa726,color:#1a1a2e
    style RED fill:#ef5350,color:#fff
```

### Rendering Steps

1. **Set canvas dimensions** — multiply display size by `devicePixelRatio` for crisp rendering on HiDPI screens
2. **Fill background** — dark blue (`#0f3460`)
3. **Draw center line** — horizontal line at `height / 2`
4. **Draw waveform** — for each pixel column `x`:
   - Look up `peaks[x]` → `{min, max}`
   - Calculate color based on amplitude
   - Draw a 1px-wide rectangle from `centerY + min * centerY` to `centerY + max * centerY`
5. **Show cursor** — positioned via CSS `left` property

### Zoom

Zoom changes the canvas width relative to the container:

| Zoom | Canvas Width | Effect |
|------|-------------|--------|
| 0.1x | Container / 10 | Extreme zoom out |
| **1x** | **Container width** | **Fit to view (default)** |
| 5x | Container × 5 | 5x zoom with horizontal scroll |
| 50x | Container × 50 | Maximum zoom |

When zoomed in, the container scrolls horizontally. The cursor auto-scrolls to keep the playback position visible.

## Playback Synchronization

```mermaid
sequenceDiagram
    participant U as User
    participant WR as WaveformRenderer
    participant AP as <audio> Element
    participant RAF as requestAnimationFrame

    U->>WR: Click on waveform at x=400
    WR->>WR: time = (x / canvasWidth) × duration
    WR->>AP: audioPlayer.currentTime = time
    WR->>WR: updateCursor(time)

    U->>AP: Click Play
    loop Every frame (~16ms)
        RAF->>WR: updatePlayback()
        WR->>AP: read currentTime
        WR->>WR: updateCursor(currentTime)
        WR->>WR: Update time display
        WR->>WR: Auto-scroll if cursor off-screen
    end

    AP->>AP: ended event
    AP-->>U: Reset Play button
```

The playback cursor position is calculated as:

```
cursorX = (currentTime / duration) × canvasWidth
```

This runs every frame via `requestAnimationFrame` for smooth 60fps cursor movement. The time display updates in sync showing `m:ss / m:ss` format.

## WaveformRenderer API

| Method | Description |
|--------|-------------|
| `setPeaks(peaks, duration)` | Set peak data and initial render |
| `render()` | Re-render at current zoom |
| `setZoom(level)` | Set absolute zoom level |
| `zoomIn()` | Zoom in by 1.5x |
| `zoomOut()` | Zoom out by 1.5x |
| `zoomFit()` | Reset to 1x (fit container) |
| `updateCursor(time)` | Move cursor to time position |
| `onSeek` | Callback when user clicks waveform |
