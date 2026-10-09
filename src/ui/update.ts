// « Chercher une mise à jour » : compare la version en ligne, vide le cache et recharge.

/** Avant de recharger : sauvegarde, et partie à reprendre directement (sans passer par le menu). */
export async function checkForUpdate(btn: HTMLButtonElement, before: () => Promise<void> | void, toast: (t: string, tone: 'info' | 'warn' | 'good') => void): Promise<void> {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Recherche…';
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const { v } = (await res.json()) as { v: string };
    if (v === __VERSION__) {
      btn.textContent = 'Tu as la dernière version';
      toast('Tu as déjà la dernière version', 'good');
      return;
    }
    btn.textContent = 'Mise à jour…';
    await before();
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      await reg?.update();
      if ('caches' in window) for (const k of await caches.keys()) await caches.delete(k);
    } catch { /* on recharge quand même */ }
    location.reload();
  } catch {
    btn.disabled = false;
    btn.textContent = label;
    toast('Impossible de joindre le serveur : vérifie ta connexion', 'warn');
  }
}

/** Petit message en bas de l'écran, hors du jeu (menu principal). */
export function screenToast(text: string, tone: 'info' | 'warn' | 'good' = 'info'): void {
  let box = document.querySelector<HTMLElement>('.screen-toasts');
  if (!box) {
    box = document.createElement('div');
    box.className = 'toasts screen-toasts';
    document.body.append(box);
  }
  const t = document.createElement('div');
  t.className = `toast ${tone}`;
  t.textContent = text;
  box.append(t);
  setTimeout(() => t.remove(), 2600);
}

/** Copie un texte ; renvoie vrai si c'est fait. */
export async function copyText(text: string, area?: HTMLTextAreaElement): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* repli */ }
  if (area) {
    area.focus();
    area.select();
    area.setSelectionRange(0, text.length);
    try { return document.execCommand('copy'); } catch { return false; }
  }
  return false;
}
