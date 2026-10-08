// Gestes tactiles : glisser, pincer, taper, et tracer avec un outil.
// Sans outil : glisser déplace la caméra, taper envoie le robot.
// Avec un outil : un doigt trace ou pose. Deux doigts : caméra et zoom, toujours.
import type { Camera } from '../render/camera.ts';

export interface GestureHandlers {
  /** Un outil est-il actif (un doigt sert alors à tracer ou poser) ? */
  toolActive(): boolean;
  tap(sx: number, sy: number): void;
  toolStart(sx: number, sy: number): void;
  toolMove(sx: number, sy: number): void;
  toolEnd(cancelled: boolean): void;
  cameraMoved(): void;
}

const TAP_SLOP = 10;
const TAP_TIME = 450;

export class Gestures {
  private pointers = new Map<number, { x: number; y: number; sx: number; sy: number; t: number }>();
  private mode: 'idle' | 'pending' | 'pan' | 'tool' | 'pinch' | 'done' = 'idle';
  private pinch = { d: 0, mx: 0, my: 0 };
  private el: HTMLElement;
  private cam: Camera;
  private h: GestureHandlers;

  constructor(el: HTMLElement, cam: Camera, h: GestureHandlers) {
    this.el = el; this.cam = cam; this.h = h;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e, false));
    el.addEventListener('pointercancel', (e) => this.up(e, true));
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = this.el.getBoundingClientRect();
      this.cam.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
      this.h.cameraMoved();
    }, { passive: false });
    // Empêche le zoom de la page par Safari.
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, (e) => e.preventDefault());
  }

  private local(e: PointerEvent): { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private down(e: PointerEvent): void {
    const p = this.local(e);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    this.el.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: p.x, y: p.y, sx: p.x, sy: p.y, t: e.timeStamp });
    if (this.pointers.size === 1) {
      if (this.h.toolActive() && e.button !== 2) {
        this.mode = 'tool';
        this.h.toolStart(p.x, p.y);
      } else {
        this.mode = 'pending';
      }
    } else if (this.pointers.size === 2) {
      if (this.mode === 'tool') this.h.toolEnd(true);
      this.startPinch();
    }
  }

  private startPinch(): void {
    this.mode = 'pinch';
    const [a, b] = [...this.pointers.values()];
    this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }

  private move(e: PointerEvent): void {
    const ptr = this.pointers.get(e.pointerId);
    if (!ptr) return;
    const p = this.local(e);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    const dx = p.x - ptr.x, dy = p.y - ptr.y;
    ptr.x = p.x; ptr.y = p.y;
    if (this.mode === 'pending' && Math.hypot(p.x - ptr.sx, p.y - ptr.sy) > TAP_SLOP) this.mode = 'pan';
    if (this.mode === 'pan') {
      this.cam.panBy(dx, dy);
      this.h.cameraMoved();
    } else if (this.mode === 'tool') {
      this.h.toolMove(p.x, p.y);
    } else if (this.mode === 'pinch' && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      this.cam.panBy(mx - this.pinch.mx, my - this.pinch.my);
      if (this.pinch.d > 0 && d > 0) this.cam.zoomAt(mx, my, d / this.pinch.d);
      this.pinch = { d, mx, my };
      this.h.cameraMoved();
    }
  }

  private up(e: PointerEvent, cancelled: boolean): void {
    const ptr = this.pointers.get(e.pointerId);
    if (!ptr) return;
    this.pointers.delete(e.pointerId);
    if (this.mode === 'pending' && !cancelled) {
      const quick = e.timeStamp - ptr.t < TAP_TIME;
      if (quick) this.h.tap(ptr.x, ptr.y);
    } else if (this.mode === 'tool') {
      this.h.toolEnd(cancelled);
    }
    if (this.pointers.size === 0) this.mode = 'idle';
    else if (this.mode === 'pinch' && this.pointers.size === 1) this.mode = 'done';
  }
}
