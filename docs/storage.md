# Storage

## IndexedDB Schema

```mermaid
erDiagram
    FILE_META {
        string id PK "e.g. m1abc2def"
        string name "Original filename"
        number size "Total bytes"
        string type "MIME type"
        number chunkCount "ceil(size / 50MB)"
        number createdAt "Unix timestamp"
    }

    FILE_CHUNKS {
        string key PK "fileId-chunkIndex"
        blob value "50 MB Blob slice"
    }

    FILE_META ||--o{ FILE_CHUNKS : "has chunks"
```

The database `audio-waveform-db` has two object stores:

| Store | Key | Value | Purpose |
|-------|-----|-------|---------|
| `file-meta` | `id` (keyPath) | Metadata object | File listing, chunk count for reassembly |
| `file-chunks` | `${fileId}-${index}` | Blob (50 MB) | Actual file data, disk-backed |

## Chunked Upload Flow

```mermaid
sequenceDiagram
    participant U as User
    participant FS as file-store.js
    participant IDB as IndexedDB

    U->>FS: storeFile(file)
    FS->>FS: Generate ID (timestamp + random)
    FS->>FS: Calculate chunkCount = ceil(size / 50MB)

    loop i = 0 to chunkCount - 1
        FS->>FS: file.slice(i*50MB, (i+1)*50MB)
        FS->>IDB: tx('file-chunks', 'readwrite').put(blob, 'id-i')
        FS-->>U: onProgress(bytesStored, totalBytes)
    end

    FS->>IDB: tx('file-meta', 'readwrite').put(meta)
    FS-->>U: {id, name, size, type}
```

### Why 50 MB Chunks?

| Chunk Size | Pros | Cons |
|-----------|------|------|
| 1 MB | Low memory per transaction | Too many IDB transactions (slow) |
| **50 MB** | **Good balance of speed and memory** | **~50 MB peak per transaction** |
| 500 MB | Fewer transactions | May exceed IDB transaction limits |

## Blob Reassembly

```mermaid
graph LR
    C0["Chunk 0<br/>50 MB Blob"]
    C1["Chunk 1<br/>50 MB Blob"]
    C2["Chunk 2<br/>50 MB Blob"]
    CN["Chunk N<br/>≤50 MB Blob"]
    BLOB["new Blob([c0, c1, c2, ...cN])<br/>Lazy — no memory copy"]

    C0 --> BLOB
    C1 --> BLOB
    C2 --> BLOB
    CN --> BLOB

    style BLOB fill:#4fc3f7,color:#1a1a2e
    style C0 fill:#78909c,color:#fff
    style C1 fill:#78909c,color:#fff
    style C2 fill:#78909c,color:#fff
    style CN fill:#78909c,color:#fff
```

`getFileAsBlob()` reads all chunks from IndexedDB and passes them to `new Blob(chunks)`. This is **lazy** — the browser does not copy the data into memory. The resulting Blob references the disk-backed IndexedDB data and only reads it when accessed (e.g., via `blob.slice()` or WORKERFS).

## Quota Management

Browser storage quotas vary:

| Browser | Default Quota | Notes |
|---------|--------------|-------|
| Chrome | ~60% of disk | Persistent storage available via `navigator.storage.persist()` |
| Firefox | ~50% of disk | Per-origin limit of ~2 GB (configurable) |
| Safari | ~1 GB | Prompts user for more; aggressive eviction |

The app checks quota on startup and before each upload using `navigator.storage.estimate()`:

```js
const { usage, quota, available } = await checkQuota();
// available = quota - usage
```

If the file exceeds available quota, the upload is rejected with a clear error message.

## File Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Uploading : User drops file
    Uploading --> Stored : All chunks written
    Uploading --> Failed : Quota exceeded / IDB error
    Failed --> [*]
    Stored --> Processing : User clicks "Extract & Visualize"
    Stored --> Deleted : User clicks "Delete"
    Deleted --> [*]
    Processing --> Stored : Processing complete or failed
```

Files remain in IndexedDB until explicitly deleted. They persist across page reloads, browser restarts, and even system reboots (as long as the browser does not evict the storage).
