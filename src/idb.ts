// Tiny IndexedDB key-value store for things too big for localStorage (an unfinished AI run with its PDFs).
const DB = 'battlecert'
const STORE = 'kv'

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE)
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode)
    const req = fn(t.objectStore(STORE))
    t.oncomplete = () => { res(req.result); db.close() }
    t.onerror = () => { rej(t.error); db.close() }
  })
}
export const idb = {
  get: async <T>(k: string): Promise<T | undefined> => { try { return await tx('readonly', (s) => s.get(k) as IDBRequest<T>) } catch { return undefined } },
  set: async (k: string, v: unknown): Promise<boolean> => { try { await tx('readwrite', (s) => s.put(v, k)); return true } catch { return false } },
  del: async (k: string): Promise<void> => { try { await tx('readwrite', (s) => s.delete(k)) } catch { /* ignore */ } },
}
