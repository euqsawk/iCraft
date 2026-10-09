// Point d'entrée : charge la partie, crée le rendu, l'interface et la boucle de jeu.
import { Application } from 'pixi.js';
// Sans « eval » : le jeu marche aussi sur les pages qui l'interdisent (lien de test hébergé).
import 'pixi.js/unsafe-eval';
import { PALETTE, RULES } from './config.ts';
import { Gestures } from './input/gestures.ts';
import { GameRenderer } from './render/renderer.ts';
import { loadSlot, requestPersistence, saveSlot, setLastSlot, SLOTS } from './save/storage.ts';
import { Game, type GameSave } from './sim/game.ts';
import { Hud } from './ui/hud.ts';
import { randomSeedCode } from './world/rng.ts';
import { showTitle, type TitleChoice } from './ui/title.ts';
import { showIntro } from './ui/intro.ts';

const STEP = 1 / 60;

async function waitForFont(): Promise<void> {
  try {
    await Promise.race([
      Promise.all([document.fonts.load('800 11px Nunito'), document.fonts.load('900 13px Nunito')]),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
  } catch { /* police de secours */ }
}

const bootStep = (t: string) => (window as unknown as { __bootStep?: (t: string) => void }).__bootStep?.(t);

const RESUME = 'uf-reprendre';

/** Le menu principal (ou la reprise directe après une mise à jour), puis la partie choisie. */
async function chooseGame(loading: HTMLElement): Promise<{ game: Game; slot: number; fresh: boolean; savedAt: number }> {
  let resume: number | null = null;
  try {
    const r = sessionStorage.getItem(RESUME);
    sessionStorage.removeItem(RESUME);
    if (r !== null) resume = Number(r);
  } catch { /* rien */ }
  for (;;) {
    let choice: TitleChoice;
    if (resume !== null && resume >= 0 && resume < SLOTS) {
      choice = { kind: 'load', slot: resume };
      resume = null;
    } else {
      loading.classList.add('hidden');
      choice = await showTitle();
      loading.classList.remove('hidden');
    }
    if (choice.kind === 'load') {
      const saved = await Promise.race([loadSlot(choice.slot), new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
      if (!saved) continue;
      return { game: new Game(saved.seed, saved as GameSave), slot: choice.slot, fresh: false, savedAt: saved.time };
    }
    loading.classList.add('hidden');
    const look = await showIntro();
    loading.classList.remove('hidden');
    const game = new Game(choice.seed || randomSeedCode());
    game.look = look;
    return { game, slot: choice.slot, fresh: true, savedAt: Date.now() };
  }
}

async function boot(): Promise<void> {
  bootStep('Jeu chargé, démarrage… (étape 3)');
  document.getElementById('boot-static')?.remove();
  const loading = document.createElement('div');
  loading.className = 'loading';
  loading.innerHTML = '<div class="cube"></div>Usine fractale';
  document.body.append(loading);

  await waitForFont();
  (window as unknown as { __gameStarted?: boolean }).__gameStarted = true;
  const { game, slot, fresh, savedAt } = await chooseGame(loading);
  loading.innerHTML = '<div class="cube"></div>Usine fractale<small style="font-weight:700;font-size:12px;color:#4A5868">Démarrage du rendu…</small>';
  await setLastSlot(slot);

  const app = new Application();
  await app.init({
    resizeTo: window,
    background: PALETTE.ground,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 3),
    autoDensity: true,
    preference: 'webgl',
  });
  const host = document.getElementById('game')!;
  host.append(app.canvas);

  const renderer = new GameRenderer(app, game);
  let leaving = false;
  const save = () => (leaving ? Promise.resolve() : saveSlot(slot, game.serialize()));
  const hud = new Hud(document.getElementById('hud')!, game, renderer, {
    async toTitle() {
      await save();
      leaving = true;
      location.reload();
    },
    async beforeReload() {
      await save();
      try { sessionStorage.setItem(RESUME, String(slot)); } catch { /* rien */ }
    },
  });
  new Gestures(app.canvas, renderer.camera, hud);

  let acc = 0, saveTimer = 0, frames = 0;
  app.ticker.add((ticker) => {
    frames++;
    const dt = Math.min(ticker.deltaMS / 1000, 0.25);
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < 12) { game.tick(STEP); acc -= STEP; steps++; }
    if (steps === 12) acc = 0;
    renderer.render(dt);
    hud.update(dt);
    saveTimer += dt;
    if (saveTimer > RULES.autosaveSeconds) { saveTimer = 0; save(); }
  });

  // Absence : l'usine a tourné au ralenti, on montre ce qu'elle a produit.
  let hiddenAt = 0;
  const comeBack = (awayMs: number) => {
    const report = game.catchUp(awayMs);
    if (report) { hud.showAway(report); save(); }
  };
  // Écran noir au retour : iOS a pu reprendre le contexte graphique pendant l'absence.
  // On sauvegarde et on relance directement la partie (sans passer par le menu).
  let reloading = false;
  const relaunch = async () => {
    if (reloading) return;
    reloading = true;
    await save();
    leaving = true;
    try { sessionStorage.setItem(RESUME, String(slot)); } catch { /* rien */ }
    location.reload();
  };
  const gl = (app.renderer as unknown as { gl?: WebGLRenderingContext }).gl;
  let contextLost = false;
  app.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); contextLost = true; save(); });
  app.canvas.addEventListener('webglcontextrestored', () => { relaunch(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); save(); return; }
    if (contextLost || gl?.isContextLost?.()) { relaunch(); return; }
    if (hiddenAt) { comeBack(Date.now() - hiddenAt); hiddenAt = 0; }
    // Si plus aucune image n'est dessinée après le retour, on relance aussi.
    const f0 = frames;
    setTimeout(() => { if (!document.hidden && frames === f0) relaunch(); }, 2500);
  });
  window.addEventListener('pagehide', () => { save(); });
  loading.remove();
  requestPersistence();

  if (__DEV__ || new URLSearchParams(location.search).has('debug')) {
    (window as unknown as Record<string, unknown>).__game = game;
    (window as unknown as Record<string, unknown>).__renderer = renderer;
    (window as unknown as Record<string, unknown>).__hud = hud;
  }
  if (fresh) {
    // Arrivée : vue de loin, plongée vers le robot, puis le brouillard se referme.
    hud.setIntro(true);
    renderer.playIntro(() => { hud.setIntro(false); hud.tips.start(); }, RULES.revealStart, { x: 2, y: 2 });
    await save();
  } else {
    hud.tips.start();
    comeBack(Date.now() - savedAt);
  }
}

// Hors ligne : pas sur une page intégrée dans un cadre (où Safari interdit même d'y toucher).
try {
  if (window.top === window.self && 'serviceWorker' in navigator && location.protocol === 'https:') {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) location.reload();
    });
  }
} catch { /* service worker indisponible */ }

boot().catch((e) => {
  // On garde la feuille de style : seul le message remplace le jeu.
  document.querySelectorAll('.loading, #game, #hud').forEach((el) => el.remove());
  const box = document.createElement('div');
  box.className = 'loading';
  box.innerHTML = `Oups, le jeu n'a pas pu démarrer.<small style="font-weight:700;max-width:280px;text-align:center"></small>`;
  box.querySelector('small')!.textContent = String(e?.message ?? e);
  document.body.append(box);
  console.error(e);
  (window as unknown as { __bootFailed?: (m: string) => void }).__bootFailed?.(String(e?.message ?? e));
});
