// Inventaire à cases : chaque case contient un seul type d'objet, jusqu'à une pile maximale.

export interface Slot {
  t: string;
  n: number;
}

export class Inventory {
  slots: (Slot | null)[];
  readonly stack: number;

  constructor(size: number, stack: number) {
    this.slots = new Array(size).fill(null);
    this.stack = stack;
  }

  count(t: string): number {
    let n = 0;
    for (const s of this.slots) if (s && s.t === t) n += s.n;
    return n;
  }

  total(): number {
    let n = 0;
    for (const s of this.slots) if (s) n += s.n;
    return n;
  }

  /** Place restante pour un type d'objet. */
  room(t: string): number {
    let n = 0;
    for (const s of this.slots) {
      if (!s) n += this.stack;
      else if (s.t === t) n += this.stack - s.n;
    }
    return n;
  }

  /** Ajoute jusqu'à n objets ; renvoie le nombre ajouté. */
  add(t: string, n: number): number {
    let left = n;
    for (const s of this.slots) {
      if (left <= 0) break;
      if (s && s.t === t && s.n < this.stack) {
        const k = Math.min(left, this.stack - s.n);
        s.n += k; left -= k;
      }
    }
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      if (!this.slots[i]) {
        const k = Math.min(left, this.stack);
        this.slots[i] = { t, n: k };
        left -= k;
      }
    }
    return n - left;
  }

  /** Retire jusqu'à n objets ; renvoie le nombre retiré. */
  take(t: string, n: number): number {
    let left = n;
    for (let i = this.slots.length - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i];
      if (s && s.t === t) {
        const k = Math.min(left, s.n);
        s.n -= k; left -= k;
        if (s.n === 0) this.slots[i] = null;
      }
    }
    return n - left;
  }

  /** Types présents, du plus abondant au moins abondant. */
  kinds(): string[] {
    const m = new Map<string, number>();
    for (const s of this.slots) if (s) m.set(s.t, (m.get(s.t) ?? 0) + s.n);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }

  save(): (Slot | null)[] {
    return this.slots.map((s) => (s ? { ...s } : null));
  }

  load(data: (Slot | null)[] | undefined): void {
    if (!data) return;
    for (let i = 0; i < this.slots.length; i++) this.slots[i] = data[i] ? { ...data[i]! } : null;
  }
}
