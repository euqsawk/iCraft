// Feuilles du bas : tirées vers le bas quand leur contenu est déjà en haut, elles suivent le doigt et se ferment.

/** Un élément défilant (entre la cible et la feuille) qui peut encore remonter : le geste lui revient. */
function innerCanScrollUp(target: EventTarget | null, sheet: HTMLElement): boolean {
  for (let el = target as HTMLElement | null; el && el !== sheet; el = el.parentElement) {
    if (el.scrollTop > 0 && el.scrollHeight > el.clientHeight) return true;
  }
  return false;
}

export function swipeToClose(sheet: HTMLElement, backdrop: HTMLElement | null, close: () => void): void {
  let startX = 0, startY = 0, lastY = 0, grabY = 0, dy = 0, t0 = 0;
  let tracking = false, dragging = false;
  sheet.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    tracking = e.touches.length === 1 && !(e.target as HTMLElement).closest?.('input[type="range"], textarea');
    dragging = false;
    startX = t.clientX; startY = lastY = t.clientY; dy = 0;
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (!tracking) return;
    if (e.touches.length !== 1) { tracking = false; return; }
    const t = e.touches[0];
    if (!dragging) {
      const mx = Math.abs(t.clientX - startX), my = Math.abs(t.clientY - startY);
      // Un geste de côté (rangées qui défilent) n'est jamais une fermeture.
      if (mx > 10 && mx > my) { tracking = false; return; }
      const down = t.clientY > lastY;
      lastY = t.clientY;
      // On commence à tirer dès que le contenu est tout en haut et que le doigt descend (même au milieu d'un défilement).
      if (!down || sheet.scrollTop > 0 || innerCanScrollUp(e.target, sheet)) return;
      dragging = true;
      sheet.dataset.dragging = '1';
      grabY = t.clientY; t0 = performance.now();
      sheet.style.animation = 'none';
      sheet.style.transition = 'none';
    }
    dy = Math.max(0, t.clientY - grabY);
    sheet.style.transform = `translateY(${dy}px)`;
    if (backdrop) backdrop.style.opacity = String(Math.max(0.35, 1 - dy / (sheet.offsetHeight * 1.4)));
    if (e.cancelable) e.preventDefault();
  }, { passive: false });
  const end = () => {
    tracking = false;
    if (!dragging) return;
    dragging = false;
    delete sheet.dataset.dragging;
    const speed = dy / Math.max(1, performance.now() - t0);
    if (dy > Math.min(140, sheet.offsetHeight * 0.3) || (speed > 0.5 && dy > 40)) {
      sheet.style.transition = 'transform .18s ease-in';
      sheet.style.transform = `translateY(${sheet.offsetHeight + 30}px)`;
      if (backdrop) { backdrop.style.transition = 'opacity .18s'; backdrop.style.opacity = '0'; }
      setTimeout(close, 170);
    } else {
      sheet.style.transition = 'transform .22s cubic-bezier(.2, .9, .3, 1.1)';
      sheet.style.transform = '';
      if (backdrop) { backdrop.style.transition = 'opacity .22s'; backdrop.style.opacity = ''; }
    }
  };
  sheet.addEventListener('touchend', end);
  sheet.addEventListener('touchcancel', end);
}
