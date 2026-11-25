import { browser } from 'wxt/browser';

/**
 * API keys, by provider id, in the extension origin's IndexedDB. Only extension pages and the
 * service worker share that origin; content scripts run in the web page's origin and can never
 * open this database, even before the worker has started and locked `storage.local`.
 *
 * Optionally the keys are encrypted with a passphrase (AES-GCM, key from PBKDF2). Unlocking
 * puts the derived key in `storage.session`: memory only, readable by extension pages and the
 * worker (never content scripts), and gone when the browser closes.
 */
const DB_NAME = 'cadenza-secrets';
const STORE = 'secrets';
const PLAIN = 'apiKeys';
const SEALED = 'apiKeysSealed';
const SESSION_KEY = 'unlockKey';
const ITERATIONS = 600_000;

export type ApiKeys = Record<string, string>;
export type LockState = 'none' | 'locked' | 'unlocked';

interface Sealed {
  v: 1;
  iterations: number;
  salt: string;
  iv: string;
  data: string;
}

export class LockedError extends Error {
  constructor() {
    super('Cadenza is locked.');
    this.name = 'LockedError';
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Run operations in one transaction; resolves with the last request's result. */
async function run<T>(
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest | undefined,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = op(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result as T);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

const getRecord = <T>(name: string) => run<T | undefined>('readonly', (s) => s.get(name));

async function sessionKey(): Promise<CryptoKey | null> {
  const raw = (await browser.storage.session.get(SESSION_KEY))[SESSION_KEY];
  if (typeof raw !== 'string') return null;
  return crypto.subtle.importKey('raw', fromB64(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function lockState(): Promise<LockState> {
  if (!(await getRecord<Sealed>(SEALED))) return 'none';
  return (await sessionKey()) ? 'unlocked' : 'locked';
}

/** All saved keys. Throws LockedError while a passphrase is set and not entered. */
export async function readApiKeys(): Promise<ApiKeys> {
  const sealed = await getRecord<Sealed>(SEALED);
  if (!sealed) return (await getRecord<ApiKeys>(PLAIN)) ?? {};
  const key = await sessionKey();
  if (!key) throw new LockedError();
  return open(sealed, key);
}

/** Replace all saved keys. Throws LockedError while locked. */
export async function writeApiKeys(keys: ApiKeys): Promise<void> {
  const sealed = await getRecord<Sealed>(SEALED);
  if (!sealed) {
    await run('readwrite', (s) => s.put(keys, PLAIN));
    return;
  }
  const key = await sessionKey();
  if (!key) throw new LockedError();
  const next = await seal(keys, key, sealed);
  await run('readwrite', (s) => s.put(next, SEALED));
}

/** Encrypt the saved keys with a new passphrase (keys must be readable: none or unlocked). */
export async function setPassphrase(passphrase: string): Promise<void> {
  const keys = await readApiKeys();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const { key, raw } = await derive(passphrase, salt, ITERATIONS);
  const sealed = await seal(keys, key, { iterations: ITERATIONS, salt: toB64(salt) });
  await run('readwrite', (s) => {
    s.put(sealed, SEALED);
    return s.delete(PLAIN);
  });
  await browser.storage.session.set({ [SESSION_KEY]: toB64(raw) });
}

/** Unlock for this browser session; false if the passphrase is wrong. */
export async function unlock(passphrase: string): Promise<boolean> {
  const sealed = await getRecord<Sealed>(SEALED);
  if (!sealed) return true;
  const { key, raw } = await derive(passphrase, fromB64(sealed.salt), sealed.iterations);
  try {
    await open(sealed, key);
  } catch {
    return false;
  }
  await browser.storage.session.set({ [SESSION_KEY]: toB64(raw) });
  return true;
}

export async function lock(): Promise<void> {
  await browser.storage.session.remove(SESSION_KEY);
}

/** Store the keys unencrypted again (must be unlocked). */
export async function removePassphrase(): Promise<void> {
  const keys = await readApiKeys();
  await run('readwrite', (s) => {
    s.put(keys, PLAIN);
    return s.delete(SEALED);
  });
  await lock();
}

/** Forgotten passphrase: delete the encrypted keys. Providers stay; their keys must be re-entered. */
export async function forgetSealedKeys(): Promise<void> {
  await run('readwrite', (s) => {
    s.delete(SEALED);
    return s.put({}, PLAIN);
  });
  await lock();
}

// ---- Crypto --------------------------------------------------------------------------------

async function derive(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const raw = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
      material,
      256,
    ),
  );
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { key, raw };
}

async function seal(
  keys: ApiKeys,
  key: CryptoKey,
  params: Pick<Sealed, 'iterations' | 'salt'>,
): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(keys)),
  );
  return {
    v: 1,
    iterations: params.iterations,
    salt: params.salt,
    iv: toB64(iv),
    data: toB64(new Uint8Array(data)),
  };
}

async function open(sealed: Sealed, key: CryptoKey): Promise<ApiKeys> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(sealed.iv) },
    key,
    fromB64(sealed.data),
  );
  return JSON.parse(new TextDecoder().decode(plain)) as ApiKeys;
}

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
