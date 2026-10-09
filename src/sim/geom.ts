// Directions et clés de cases.

/** 0 = est, 1 = sud, 2 = ouest, 3 = nord. */
export type Dir = 0 | 1 | 2 | 3;

export const DX = [1, 0, -1, 0] as const;
export const DY = [0, 1, 0, -1] as const;

export function opposite(d: Dir): Dir {
  return ((d + 2) % 4) as Dir;
}

/** Direction d'une case vers une case voisine, ou null si elles ne se touchent pas. */
export function dirBetween(ax: number, ay: number, bx: number, by: number): Dir | null {
  const dx = bx - ax, dy = by - ay;
  if (dx === 1 && dy === 0) return 0;
  if (dx === 0 && dy === 1) return 1;
  if (dx === -1 && dy === 0) return 2;
  if (dx === 0 && dy === -1) return 3;
  return null;
}

/** Direction d'une case vers une autre sur la même ligne ou colonne (même éloignée), sinon null. */
export function dirToward(ax: number, ay: number, bx: number, by: number): Dir | null {
  const dx = bx - ax, dy = by - ay;
  if (dy === 0 && dx !== 0) return dx > 0 ? 0 : 2;
  if (dx === 0 && dy !== 0) return dy > 0 ? 1 : 3;
  return null;
}

/** Clé numérique unique d'une case (coordonnées entre -32768 et 32767). */
export function key(x: number, y: number): number {
  return (x + 32768) * 65536 + (y + 32768);
}

export function unkey(k: number): [number, number] {
  return [Math.floor(k / 65536) - 32768, (k % 65536) - 32768];
}
