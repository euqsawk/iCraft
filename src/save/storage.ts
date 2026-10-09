// Sauvegarde locale dans IndexedDB (plus fiable que localStorage sur iPhone).
// Trois emplacements de partie, plus la dernière partie jouée.
import type { GameSave } from '../sim/game.ts';

const DB = 'usine-fractale';
const STORE = 'saves';
/** Ancienne clé (une seule partie), reprise dans le premier emplacement. */
const LEGACY = 'partie';
const LAST = 'derniere';
export const SLOTS = 3;
const slotKey = (i: number) => `partie-${i}`;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function get<T>(key: string): Promise<T | null> {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    try {
      const raw = localStorage.getItem(`uf-${key}`);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch { return null; }
  }
}

async function put(key: string, value: unknown): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    try { localStorage.setItem(`uf-${key}`, JSON.stringify(value)); } catch { /* stockage indisponible */ }
  }
}

async function del(key: string): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* rien */ }
  try { localStorage.removeItem(`uf-${key}`); } catch { /* rien */ }
}

let migrated = false;
/** L'ancienne partie unique devient la partie du premier emplacement. */
async function migrate(): Promise<void> {
  if (migrated) return;
  migrated = true;
  const old = await get<GameSave>(LEGACY);
  if (!old) {
    try {
      const raw = localStorage.getItem(LEGACY);
      if (raw) { await put(slotKey(0), JSON.parse(raw)); localStorage.removeItem(LEGACY); await put(LAST, 0); }
    } catch { /* rien */ }
    return;
  }
  if (!(await get<GameSave>(slotKey(0)))) await put(slotKey(0), old);
  await put(LAST, 0);
  await del(LEGACY);
}

/** Les trois emplacements (null = libre). */
export async function listSlots(): Promise<(GameSave | null)[]> {
  await migrate();
  const out: (GameSave | null)[] = [];
  for (let i = 0; i < SLOTS; i++) out.push(await get<GameSave>(slotKey(i)));
  return out;
}

export async function loadSlot(i: number): Promise<GameSave | null> {
  await migrate();
  return get<GameSave>(slotKey(i));
}

export async function saveSlot(i: number, s: GameSave): Promise<void> {
  await put(slotKey(i), s);
}

export async function deleteSlot(i: number): Promise<void> {
  await del(slotKey(i));
  if ((await lastSlot()) === i) await del(LAST);
}

/** Le dernier emplacement joué, s'il existe encore. */
export async function lastSlot(): Promise<number | null> {
  await migrate();
  const v = await get<number>(LAST);
  return typeof v === 'number' && v >= 0 && v < SLOTS ? v : null;
}

export async function setLastSlot(i: number): Promise<void> {
  await put(LAST, i);
}

/** Demande au navigateur de ne pas effacer la sauvegarde (Safari peut le faire hors application installée). */
export async function requestPersistence(): Promise<void> {
  try { await navigator.storage?.persist?.(); } catch { /* rien */ }
}
