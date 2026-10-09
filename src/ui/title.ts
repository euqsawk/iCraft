// Menu principal : il s'ouvre à chaque lancement à froid du jeu.
// Continuer, trois parties sauvegardées, nouvelle partie, importer un code, mise à jour.
import { cleanLook, DEFAULT_LOOK } from '../data/look.ts';
import { droneSvg, robotSvg } from '../render/robotShapes.ts';
import { decodeSave, encodeSave } from '../save/code.ts';
import { deleteSlot, lastSlot, listSlots, saveSlot, SLOTS } from '../save/storage.ts';
import type { GameSave } from '../sim/game.ts';
import { checkForUpdate, copyText, screenToast } from './update.ts';

export type TitleChoice = { kind: 'load'; slot: number } | { kind: 'new'; slot: number; seed: string };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const fmt = (n: number) => Math.floor(n).toLocaleString('fr-FR').replace(/ | /g, ' ');

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

/** « il y a 3 h » */
export function ago(time: number): string {
  const s = Math.max(0, (Date.now() - time) / 1000);
  if (s < 90) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400 * 1.5) return `il y a ${Math.round(s / 3600)} h`;
  return `il y a ${Math.round(s / 86400)} j`;
}

export function playTime(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}

/** Résumé d'une sauvegarde : palier, pièces, temps de jeu. */
function summary(s: GameSave): string {
  const pal = s.v >= 4 ? s.palier ?? 1 : 1;
  return `Palier ${pal} · ${fmt(s.money)} pièces${s.played ? ` · ${playTime(s.played)} de jeu` : ''}`;
}

/** Fenêtre d'export : le code de la partie, à copier ou partager. */
export async function exportPanel(save: GameSave, onClose: () => void): Promise<HTMLElement> {
  const code = await encodeSave(save);
  const box = h('div', 'panel');
  const name = cleanLook(save.look).name;
  box.innerHTML = `<div class="panel-head"><div><h2>Exporter la partie</h2><p>Garde ce code ou envoie-le : « Importer un code » dans le menu du jeu recrée la partie de ${esc(name)}, sur ce téléphone ou un autre.</p></div></div>`;
  const area = h('textarea', 'code-area') as HTMLTextAreaElement;
  area.readOnly = true;
  area.value = code;
  area.rows = 5;
  area.onfocus = () => area.select();
  const size = h('p', 'muted', `${fmt(code.length)} caractères`);
  const row = h('div', 'row');
  const copy = h('button', 'btn primary', 'Copier le code');
  copy.onclick = async () => screenToast((await copyText(code, area)) ? 'Code copié' : 'Sélectionne le code pour le copier', 'good');
  row.append(copy);
  if (typeof navigator.share === 'function') {
    const share = h('button', 'btn', 'Partager');
    share.onclick = async () => { try { await navigator.share({ title: 'Usine fractale', text: code }); } catch { /* annulé */ } };
    row.append(share);
  }
  const close = h('button', 'btn', 'Fermer');
  close.onclick = onClose;
  box.append(area, size, row, close);
  return box;
}

/** Affiche le menu principal et attend le choix du joueur. */
export function showTitle(): Promise<TitleChoice> {
  return new Promise((resolve) => {
    const screen = h('div', 'screen title');
    document.body.append(screen);
    let slots: (GameSave | null)[] = [];
    let last: number | null = null;
    const finish = (c: TitleChoice) => {
      screen.classList.add('leaving');
      setTimeout(() => { screen.remove(); resolve(c); }, 260);
    };

    const panel = (build: (box: HTMLElement, close: () => void) => void | Promise<void>) => {
      const back = h('div', 'panel-back');
      const close = () => back.remove();
      back.onclick = (e) => { if (e.target === back) close(); };
      screen.append(back);
      const r = build(back, close);
      if (r) r.catch((e) => { close(); screenToast(String((e as Error).message ?? e), 'warn'); });
    };

    const firstFree = () => slots.findIndex((s) => !s);

    /** Choisit un emplacement : le premier libre, ou demande lequel remplacer. */
    const pickSlot = (title: string, then: (slot: number) => void) => {
      const free = firstFree();
      if (free >= 0) { then(free); return; }
      panel((back, close) => {
        const box = h('div', 'panel');
        box.innerHTML = `<div class="panel-head"><div><h2>${esc(title)}</h2><p>Les ${SLOTS} emplacements sont pris : laquelle remplacer ?</p></div></div>`;
        slots.forEach((s, i) => {
          if (!s) return;
          const look = cleanLook(s.look);
          const card = h('div', 'slot-card');
          card.innerHTML = `<span class="slot-robot">${robotSvg(look, { beam: false })}</span><div class="slot-info"><b>${esc(look.name)}</b><small>${esc(summary(s))}</small></div>`;
          const b = h('button', 'btn danger', 'Remplacer');
          let armed = false;
          b.onclick = () => {
            if (!armed) { armed = true; b.textContent = 'Sûr ?'; return; }
            close();
            then(i);
          };
          card.append(b);
          box.append(card);
        });
        const cancel = h('button', 'btn', 'Annuler');
        cancel.onclick = close;
        box.append(cancel);
        back.append(box);
      });
    };

    const newGame = () => pickSlot('Nouvelle partie', (slot) => {
      panel((back, close) => {
        const box = h('div', 'panel');
        box.innerHTML = `<div class="panel-head"><div><h2>Nouvelle partie</h2><p>Une carte au hasard, ou la graine d’une carte qu’on t’a partagée.</p></div></div>`;
        const input = h('input', 'field') as HTMLInputElement;
        input.placeholder = 'GRAINE (facultatif)';
        input.autocapitalize = 'characters';
        input.autocomplete = 'off';
        const go = h('button', 'btn primary big', 'Commencer');
        go.onclick = () => { close(); finish({ kind: 'new', slot, seed: input.value.trim().toUpperCase() }); };
        const cancel = h('button', 'btn', 'Annuler');
        cancel.onclick = close;
        box.append(input, go, cancel);
        back.append(box);
      });
    });

    const importCode = () => panel((back, close) => {
      const box = h('div', 'panel');
      box.innerHTML = `<div class="panel-head"><div><h2>Importer un code</h2><p>Colle le code d’une partie exportée (il commence par « UF1. »).</p></div></div>`;
      const area = h('textarea', 'code-area') as HTMLTextAreaElement;
      area.rows = 5;
      area.placeholder = 'UF1.…';
      area.autocapitalize = 'off';
      area.spellcheck = false;
      const err = h('p', 'error hidden');
      const row = h('div', 'row');
      const paste = h('button', 'btn', 'Coller');
      paste.onclick = async () => {
        try { area.value = await navigator.clipboard.readText(); } catch { area.focus(); screenToast('Appuie longuement dans le cadre puis « Coller »', 'info'); }
      };
      const go = h('button', 'btn primary', 'Importer');
      go.onclick = async () => {
        err.classList.add('hidden');
        go.disabled = true;
        try {
          const save = await decodeSave(area.value);
          close();
          pickSlot('Importer la partie', async (slot) => {
            save.time = Date.now();
            await saveSlot(slot, save);
            screenToast('Partie importée', 'good');
            finish({ kind: 'load', slot });
          });
        } catch (e) {
          err.textContent = (e as Error).message;
          err.classList.remove('hidden');
        } finally {
          go.disabled = false;
        }
      };
      row.append(paste, go);
      const cancel = h('button', 'btn', 'Annuler');
      cancel.onclick = close;
      box.append(area, err, row, cancel);
      back.append(box);
    });

    const savesPanel = () => panel((back, close) => {
      const box = h('div', 'panel');
      box.innerHTML = `<div class="panel-head"><div><h2>Parties</h2><p>${SLOTS} emplacements. Le jeu sauvegarde tout seul.</p></div></div>`;
      slots.forEach((s, i) => {
        const card = h('div', `slot-card${s ? '' : ' empty'}`);
        if (!s) {
          card.innerHTML = `<span class="slot-robot ghost"></span><div class="slot-info"><b>Emplacement ${i + 1}</b><small>Libre</small></div>`;
          const b = h('button', 'btn', 'Nouvelle');
          b.onclick = () => { close(); newGame(); };
          card.append(b);
          box.append(card);
          return;
        }
        const look = cleanLook(s.look);
        card.innerHTML = `<span class="slot-robot">${robotSvg(look, { beam: false })}</span><div class="slot-info"><b>${esc(look.name)}${i === last ? ' <em>dernière</em>' : ''}</b><small>${esc(summary(s))}</small><small>Graine ${esc(s.seed)} · ${ago(s.time)}</small></div>`;
        const acts = h('div', 'slot-acts');
        const play = h('button', 'btn primary', 'Jouer');
        play.onclick = () => { close(); finish({ kind: 'load', slot: i }); };
        const exp = h('button', 'btn', 'Exporter');
        exp.onclick = () => panel(async (b2, c2) => { b2.append(await exportPanel(s, c2)); });
        const del = h('button', 'btn danger', 'Supprimer');
        let armed = false;
        del.onclick = async () => {
          if (!armed) { armed = true; del.textContent = 'Toucher encore'; return; }
          await deleteSlot(i);
          await refresh();
          close();
          savesPanel();
        };
        acts.append(play, exp, del);
        card.append(acts);
        box.append(card);
      });
      const done = h('button', 'btn', 'Fermer');
      done.onclick = close;
      box.append(done);
      back.append(box);
    });

    const render = () => {
      const cont = last !== null ? slots[last] : null;
      const look = cleanLook(cont?.look ?? DEFAULT_LOOK);
      const count = slots.filter(Boolean).length;
      screen.innerHTML = `
        <div class="title-hero">
          <div class="title-logo"><span class="logo-cube"></span><h1>Usine<br>fractale</h1></div>
          <div class="title-stage">
            ${robotSvg(look, { spin: true, cls: 'robot-svg hero' })}
            <span class="orbit o1">${droneSvg(look)}</span>
            <span class="orbit o2">${droneSvg(look)}</span>
          </div>
        </div>
        <div class="title-menu"></div>
        <div class="title-foot"><span>Version ${esc(__VERSION__)}</span></div>`;
      const menu = screen.querySelector('.title-menu')!;
      if (cont && last !== null) {
        const b = h('button', 'tbtn primary', `<b>Continuer</b><small>${esc(look.name)} · ${esc(summary(cont))} · ${ago(cont.time)}</small>`);
        b.onclick = () => finish({ kind: 'load', slot: last! });
        menu.append(b);
      }
      const nb = h('button', `tbtn${cont ? '' : ' primary'}`, '<b>Nouvelle partie</b>');
      nb.onclick = newGame;
      const imp = h('button', 'tbtn', '<b>Importer un code</b>');
      imp.onclick = importCode;
      const sv = h('button', 'tbtn', `<b>Parties</b><small>${count} / ${SLOTS}</small>`);
      sv.onclick = savesPanel;
      menu.append(nb, sv, imp);
      const upd = h('button', 'link', 'Chercher une mise à jour');
      upd.onclick = () => checkForUpdate(upd, () => {}, screenToast);
      screen.querySelector('.title-foot')!.append(upd);
    };

    const refresh = async () => {
      slots = await listSlots();
      last = await lastSlot();
      if (last !== null && !slots[last]) last = null;
      if (last === null) {
        // Pas de dernière partie connue : la plus récente.
        let best = -1;
        slots.forEach((s, i) => { if (s && (best < 0 || s.time > slots[best]!.time)) best = i; });
        last = best >= 0 ? best : null;
      }
      render();
    };
    refresh().catch(() => render());
  });
}
