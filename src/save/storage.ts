// Sauvegarde locale dans IndexedDB (plus fiable que localStorage sur iPhone).
import type { GameSave } from '../sim/game.ts';

const DB = 'usine-fractale';
const STORE = 'saves';
const KEY = 'partie';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadGame(): Promise<GameSave | null> {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as GameSave) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as GameSave) : null;
    } catch { return null; }
  }
}

export async function saveGame(s: GameSave): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(s, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* stockage indisponible */ }
  }
}

export async function clearGame(): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* rien */ }
  try { localStorage.removeItem(KEY); } catch { /* rien */ }
}

/** Demande au navigateur de ne pas effacer la sauvegarde (Safari peut le faire hors application installée). */
export async function requestPersistence(): Promise<void> {
  try { await navigator.storage?.persist?.(); } catch { /* rien */ }
}
