// Point d'entrée : charge la partie, crée le rendu, l'interface et la boucle de jeu.
import { Application } from 'pixi.js';
// Sans « eval » : le jeu marche aussi sur les pages qui l'interdisent (lien de test hébergé).
import 'pixi.js/unsafe-eval';
import { PALETTE, RULES } from './config.ts';
import { Gestures } from './input/gestures.ts';
import { GameRenderer } from './render/renderer.ts';
import { clearGame, loadGame, requestPersistence, saveGame } from './save/storage.ts';
import { Game, type GameSave } from './sim/game.ts';
import { Hud } from './ui/hud.ts';
import { randomSeedCode } from './world/rng.ts';

const STEP = 1 / 60;

async function waitForFont(): Promise<void> {
  try {
    await Promise.race([
      Promise.all([document.fonts.load('800 11px Nunito'), document.fonts.load('900 13px Nunito')]),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
  } catch { /* police de secours */ }
}

async function boot(): Promise<void> {
  const loading = document.createElement('div');
  loading.className = 'loading';
  loading.innerHTML = '<div class="cube"></div>Usine fractale';
  document.body.append(loading);

  await waitForFont();
  const saved = await loadGame();
  const game = saved ? new Game(saved.seed, saved as GameSave) : new Game(randomSeedCode());

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
  let resetting = false;
  const save = () => (resetting ? Promise.resolve() : saveGame(game.serialize()));
  const hud = new Hud(document.getElementById('hud')!, game, renderer, {
    async newGame(seed: string) {
      resetting = true;
      await clearGame();
      const fresh = new Game(seed || randomSeedCode());
      await saveGame(fresh.serialize());
      location.reload();
    },
    save,
  });
  new Gestures(app.canvas, renderer.camera, hud);

  let acc = 0, saveTimer = 0;
  app.ticker.add((ticker) => {
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
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); save(); }
    else if (hiddenAt) { comeBack(Date.now() - hiddenAt); hiddenAt = 0; }
  });
  window.addEventListener('pagehide', save);
  loading.remove();
  requestPersistence();

  if (__DEV__ || new URLSearchParams(location.search).has('debug')) {
    (window as unknown as Record<string, unknown>).__game = game;
    (window as unknown as Record<string, unknown>).__renderer = renderer;
    (window as unknown as Record<string, unknown>).__hud = hud;
  }
  if (!saved) {
    hud.toast('Envoie le robot sur le charbon : à l’arrêt, il mine tout seul', 'info');
    await save();
  } else {
    comeBack(Date.now() - saved.time);
  }
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) location.reload();
  });
}

boot().catch((e) => {
  // On garde la feuille de style : seul le message remplace le jeu.
  document.querySelectorAll('.loading, #game, #hud').forEach((el) => el.remove());
  const box = document.createElement('div');
  box.className = 'loading';
  box.innerHTML = `Oups, le jeu n'a pas pu démarrer.<small style="font-weight:700;max-width:280px;text-align:center"></small>`;
  box.querySelector('small')!.textContent = String(e?.message ?? e);
  document.body.append(box);
  console.error(e);
});
