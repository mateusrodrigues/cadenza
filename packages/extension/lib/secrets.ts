/**
 * API keys, by provider id, in the extension origin's IndexedDB. Only extension pages and the
 * service worker share that origin; content scripts run in the web page's origin and can never
 * open this database, even before the worker has started and locked `storage.local`.
 */
const DB_NAME = 'cadenza-secrets';
const STORE = 'secrets';
const RECORD = 'apiKeys';

export type ApiKeys = Record<string, string>;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = op(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result as T);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function readApiKeys(): Promise<ApiKeys> {
  return (await run<ApiKeys | undefined>('readonly', (s) => s.get(RECORD))) ?? {};
}

export async function writeApiKeys(keys: ApiKeys): Promise<void> {
  await run('readwrite', (s) => s.put(keys, RECORD));
}
