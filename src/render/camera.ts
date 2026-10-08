// Caméra : centre (en unités du monde) et zoom.

export class Camera {
  x = 0;
  y = 0;
  zoom = 0.9;
  width = 390;
  height = 844;
  readonly minZoom = 0.35;
  readonly maxZoom = 2.6;

  setSize(w: number, h: number): void {
    this.width = w;
    this.height = h;
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.width / 2) / this.zoom + this.x, y: (sy - this.height / 2) / this.zoom + this.y };
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: (wx - this.x) * this.zoom + this.width / 2, y: (wy - this.y) * this.zoom + this.height / 2 };
  }

  /** Déplace la caméra d'un décalage à l'écran (glisser). */
  panBy(dsx: number, dsy: number): void {
    this.x -= dsx / this.zoom;
    this.y -= dsy / this.zoom;
  }

  /** Zoome autour d'un point de l'écran, qui reste fixe sous le doigt. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.screenToWorld(sx, sy);
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
    const after = this.screenToWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
  }

  /** Rectangle visible, en unités du monde, avec une marge. */
  bounds(margin = 0): { x0: number; y0: number; x1: number; y1: number } {
    const hw = this.width / 2 / this.zoom + margin, hh = this.height / 2 / this.zoom + margin;
    return { x0: this.x - hw, y0: this.y - hh, x1: this.x + hw, y1: this.y + hh };
  }
}
