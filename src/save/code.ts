// Code de partie : la sauvegarde compressée, en texte à copier-coller.
// « UF1. » + base64url(deflate(JSON)) ; « UF0. » sans compression si le navigateur ne sait pas compresser.
import type { GameSave } from '../sim/game.ts';

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function encodeSave(s: GameSave): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify(s));
  if (typeof CompressionStream !== 'undefined') {
    try { return `UF1.${toB64(await pipe(raw, new CompressionStream('deflate-raw')))}`; } catch { /* sans compression */ }
  }
  return `UF0.${toB64(raw)}`;
}

/** Lit un code de partie ; lève une erreur lisible si le code est invalide. */
export async function decodeSave(code: string): Promise<GameSave> {
  const c = code.replace(/\s+/g, '');
  const m = /^UF([01])\.([A-Za-z0-9_-]+)$/.exec(c);
  if (!m) throw new Error('Ce n’est pas un code de partie (il commence par « UF1. »).');
  let bytes: Uint8Array;
  try { bytes = fromB64(m[2]); } catch { throw new Error('Code abîmé : il manque peut-être un morceau.'); }
  if (m[1] === '1') {
    if (typeof DecompressionStream === 'undefined') throw new Error('Ce navigateur ne sait pas lire ce code.');
    try { bytes = await pipe(bytes, new DecompressionStream('deflate-raw')); } catch { throw new Error('Code abîmé : il manque peut-être un morceau.'); }
  }
  let s: GameSave;
  try { s = JSON.parse(new TextDecoder().decode(bytes)) as GameSave; } catch { throw new Error('Code abîmé : il manque peut-être un morceau.'); }
  if (!s || typeof s.seed !== 'string' || typeof s.money !== 'number' || !s.factory || !s.robot) throw new Error('Ce code ne contient pas de partie.');
  return s;
}
