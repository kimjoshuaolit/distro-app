// Local-first durable buffer (AD-1). Every capture lands here synchronously,
// before any network. Raw IndexedDB — one object store, keyed by shot id.

export type ShotType = 'photo' | 'clip'
// 'rejected' is client-only: the server refused to reserve it (cap reached, or
// uploads for the event closed — Story 3.2), so no server row exists and the
// queue must stop retrying it. Server rows are only ever 'local' | 'uploaded'.
export type UploadStatus = 'local' | 'uploaded' | 'rejected'

/** Why the server refused a shot: over the 25/5 cap, or the upload window had ended. */
export type RejectReason = 'cap' | 'closed'

export type Shot = {
  id: string
  eventId: string
  guestId: string
  type: ShotType
  blob: Blob
  capturedAt: string // ISO-8601 UTC
  uploadStatus: UploadStatus
  /** Set with 'rejected'; absent on shots rejected before 3.2 (those were all 'cap'). */
  rejectReason?: RejectReason
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

/** How many of this event's shots the server refused (cap reached). */
export async function countRejected(eventId: string): Promise<number> {
  const shots = await getShotsByEvent(eventId)
  return shots.filter((s) => s.uploadStatus === 'rejected').length
}

/** Shots for an event still awaiting upload (oldest first, so rolls drain in order). */
export async function getPendingUploads(eventId: string): Promise<Shot[]> {
  const shots = await getShotsByEvent(eventId)
  return shots
    .filter((s) => s.uploadStatus === 'local')
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
}

async function setUploadStatus(id: string, status: UploadStatus, reason?: RejectReason): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      const get = store.get(id)
      get.onsuccess = () => {
        const shot = get.result as Shot | undefined
        if (shot) {
          shot.uploadStatus = status
          if (reason) shot.rejectReason = reason
          store.put(shot)
        }
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

/** Flip a stored shot to 'uploaded' once the server has confirmed it. */
export function markUploaded(id: string): Promise<void> {
  return setUploadStatus(id, 'uploaded')
}

/** Mark a shot the server refused to reserve (cap reached, or uploads closed) so we stop retrying it. */
export function markRejected(id: string, reason: RejectReason = 'cap'): Promise<void> {
  return setUploadStatus(id, 'rejected', reason)
}
