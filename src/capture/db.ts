// Local-first durable buffer (AD-1). Every capture lands here synchronously,
// before any network. Raw IndexedDB — one object store, keyed by shot id.

export type ShotType = 'photo' | 'clip'
export type UploadStatus = 'local' | 'uploaded'

export type Shot = {
  id: string
  eventId: string
  guestId: string
  type: ShotType
  blob: Blob
  capturedAt: string // ISO-8601 UTC
  uploadStatus: UploadStatus
}

const DB_NAME = 'drc'
const DB_VERSION = 1
const STORE = 'shots'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('eventId', 'eventId', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'))
  })
}

/** Durably store a shot. Resolves only after the transaction commits. */
export async function putShot(shot: Shot): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(shot)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

/** All shots for an event (used by the own-roll view in Story 1.6). */
export async function getShotsByEvent(eventId: string): Promise<Shot[]> {
  const db = await openDb()
  try {
    return await new Promise<Shot[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).index('eventId').getAll(eventId)
      req.onsuccess = () => resolve(req.result as Shot[])
      req.onerror = () => reject(req.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

/** Count locally-stored shots of a type for an event. */
export async function countByType(eventId: string, type: ShotType): Promise<number> {
  const shots = await getShotsByEvent(eventId)
  return shots.filter((s) => s.type === type).length
}
