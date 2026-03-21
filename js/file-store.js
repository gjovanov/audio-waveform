/**
 * IndexedDB chunked file storage
 * Stores large files as 50MB Blob chunks to avoid memory issues.
 */

const DB_NAME = 'audio-waveform-db';
const DB_VERSION = 1;
const CHUNK_SIZE = 50 * 1024 * 1024; // 50MB

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('file-meta')) {
        db.createObjectStore('file-meta', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('file-chunks')) {
        db.createObjectStore('file-chunks');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function generateId() {
  return crypto.randomUUID();
}

/**
 * Store a File into IndexedDB in chunks.
 * @param {File} file
 * @param {function} onProgress - called with (storedBytes, totalBytes)
 * @returns {Promise<{id: string, name: string, size: number, type: string}>}
 */
export async function storeFile(file, onProgress) {
  const db = await openDB();
  const id = generateId();
  const chunkCount = Math.ceil(file.size / CHUNK_SIZE);
  let storedChunks = 0;

  try {
    // Store chunks
    for (let i = 0; i < chunkCount; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = file.slice(start, end);

      await new Promise((resolve, reject) => {
        const tx = db.transaction('file-chunks', 'readwrite');
        tx.objectStore('file-chunks').put(chunk, `${id}-${i}`);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });

      storedChunks++;
      if (onProgress) onProgress(end, file.size);
    }

    // Store metadata
    const meta = {
      id,
      name: file.name,
      size: file.size,
      type: file.type,
      chunkCount,
      createdAt: Date.now(),
    };

    await new Promise((resolve, reject) => {
      const tx = db.transaction('file-meta', 'readwrite');
      tx.objectStore('file-meta').put(meta);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });

    return meta;
  } catch (err) {
    // Clean up orphaned chunks on failure
    for (let i = 0; i < storedChunks; i++) {
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction('file-chunks', 'readwrite');
          tx.objectStore('file-chunks').delete(`${id}-${i}`);
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
      } catch { /* best effort cleanup */ }
    }
    throw err;
  }
}

/**
 * Reassemble a stored file as a single Blob (lazy, no full memory load).
 * @param {string} fileId
 * @returns {Promise<Blob>}
 */
export async function getFileAsBlob(fileId) {
  const db = await openDB();
  const meta = await getMeta(db, fileId);
  if (!meta) throw new Error(`File ${fileId} not found`);

  const chunks = [];
  for (let i = 0; i < meta.chunkCount; i++) {
    const chunk = await new Promise((resolve, reject) => {
      const tx = db.transaction('file-chunks', 'readonly');
      const req = tx.objectStore('file-chunks').get(`${fileId}-${i}`);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    chunks.push(chunk);
  }

  return new Blob(chunks, { type: meta.type });
}

/**
 * Delete a stored file and all its chunks.
 */
export async function deleteFile(fileId) {
  const db = await openDB();
  const meta = await getMeta(db, fileId);
  if (!meta) return;

  // Delete all chunks in a single transaction
  await new Promise((resolve, reject) => {
    const tx = db.transaction('file-chunks', 'readwrite');
    const store = tx.objectStore('file-chunks');
    for (let i = 0; i < meta.chunkCount; i++) {
      store.delete(`${fileId}-${i}`);
    }
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });

  await new Promise((resolve, reject) => {
    const tx = db.transaction('file-meta', 'readwrite');
    tx.objectStore('file-meta').delete(fileId);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * List all stored file metadata.
 */
export async function listFiles() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('file-meta', 'readonly');
    const req = tx.objectStore('file-meta').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Check available storage quota.
 */
export async function checkQuota() {
  if (navigator.storage && navigator.storage.estimate) {
    const { usage, quota } = await navigator.storage.estimate();
    return { usage, quota, available: quota - usage };
  }
  return null;
}

function getMeta(db, fileId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('file-meta', 'readonly');
    const req = tx.objectStore('file-meta').get(fileId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
