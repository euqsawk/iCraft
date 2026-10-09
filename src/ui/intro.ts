// Présentation d'une nouvelle partie : le robot, son apparence, ses drones.
import { ACCESSORIES, cleanLook, DEFAULT_LOOK, ROBOT_COLORS, ROBOT_NAMES, type RobotLook } from '../data/look.ts';
import { droneSvg, robotSvg } from '../render/robotShapes.ts';
import { DRONE_PRIORITIES } from '../sim/game.ts';
import { PRIO_ICONS } from './prioIcons.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;


/** Montre la présentation et renvoie l'apparence choisie. */
export function showIntro(start: RobotLook = DEFAULT_LOOK): Promise<RobotLook> {
  return new Promise((resolve) => {
    const look: RobotLook = { ...cleanLook(start) };
    const screen = document.createElement('div');
    screen.className = 'screen intro';
    document.body.append(screen);
    let step = 0;
    const STEPS = 3;

    const finish = () => {
      screen.classList.add('leaving');
      setTimeout(() => { screen.remove(); resolve(cleanLook(look)); }, 300);
    };

    const render = () => {
      const dots = Array.from({ length: STEPS }, (_, i) => `<span class="${i === step ? 'on' : ''}"></span>`).join('');
      let body = '';
      if (step === 0) {
        body = `
          <div class="intro-stage boom">
            <div class="burst"></div>
            ${robotSvg(look, { spin: true, cls: 'robot-svg hero pop' })}
          </div>
          <h1 class="intro-title">Ça, c’est toi !</h1>
          <p class="intro-text">Un petit robot de chantier. Touche le sol pour l’envoyer quelque part : il construit tout ce que tu poses. À l’arrêt sur un filon, il mine tout seul.</p>
          <p class="intro-text small">Comme tes machines, il roule au charbon.</p>`;
      } else if (step === 1) {
        body = `
          <div class="intro-stage">${robotSvg(look, { spin: true, cls: 'robot-svg hero' })}</div>
          <h1 class="intro-title">À ton image</h1>
          <div class="custom">
            <p class="custom-label">Couleur</p>
            <div class="swatches">${ROBOT_COLORS.map((c) => `<button class="swatch${c.id === look.color ? ' on' : ''}" data-color="${c.id}" style="background:${hex(c.main)}" aria-label="${esc(c.label)}"></button>`).join('')}</div>
            <p class="custom-label">Accessoire</p>
            <div class="accs">${ACCESSORIES.map((a) => `<button class="acc${a.id === look.accessory ? ' on' : ''}" data-acc="${a.id}">${robotSvg({ ...look, accessory: a.id }, { beam: false, cls: 'robot-svg mini' })}<small>${esc(a.label)}</small></button>`).join('')}</div>
            <p class="custom-label">Nom</p>
            <div class="name-row"><input class="field name" maxlength="14" value="${esc(look.name)}" autocomplete="off" aria-label="Nom du robot"><button class="btn dice" aria-label="Un nom au hasard">🎲</button></div>
          </div>`;
      } else {
        body = `
          <div class="intro-stage drones">
            ${robotSvg(look, { spin: true, cls: 'robot-svg hero' })}
            <span class="orbit o1">${droneSvg(look)}</span>
            <span class="orbit o2">${droneSvg(look)}</span>
          </div>
          <h1 class="intro-title">Tes drones</h1>
          <p class="intro-text">Ils volent autour de ${esc(look.name)} : ils construisent avec lui, rechargent les machines en charbon et apportent au Noyau, au Laboratoire et au Comptoir ce qu’ils trouvent dans tes coffres. Tu commences avec un drone, et 10 charbons dans sa soute.</p>
          <div class="prio-demo">
            <p class="custom-label">Touche ${esc(look.name)}, puis un drone : range ses tâches de la plus importante à la moins importante. Il fait la première tâche utile de la liste.</p>
            <ol class="prio-list demo">${DRONE_PRIORITIES.map((p, i) => `<li class="prio-item${i === 0 ? ' first' : ''}"><span class="prio-n">${i + 1}</span><span class="prio-ico">${PRIO_ICONS[p.id] ?? ''}</span><b>${esc(p.label)}</b></li>`).join('')}</ol>
          </div>`;
      }
      screen.innerHTML = `
        <div class="intro-top"><div class="intro-dots">${dots}</div><button class="link skip">Passer</button></div>
        <div class="intro-body step${step}">${body}</div>
        <div class="intro-foot">
          ${step > 0 ? '<button class="btn back">Retour</button>' : ''}
          <button class="btn primary big next">${step === STEPS - 1 ? 'C’est parti !' : 'Suivant'}</button>
        </div>`;
      screen.querySelector<HTMLButtonElement>('.skip')!.onclick = finish;
      screen.querySelector<HTMLButtonElement>('.next')!.onclick = () => { if (step === STEPS - 1) finish(); else { step++; render(); } };
      const back = screen.querySelector<HTMLButtonElement>('.back');
      if (back) back.onclick = () => { step--; render(); };
      if (step === 1) {
        const refreshPreview = () => {
          screen.querySelector('.intro-stage')!.innerHTML = robotSvg(look, { spin: true, cls: 'robot-svg hero wiggle' });
        };
        screen.querySelectorAll<HTMLButtonElement>('[data-color]').forEach((b) => {
          b.onclick = () => {
            look.color = b.dataset.color!;
            screen.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('on', x === b));
            screen.querySelectorAll<HTMLButtonElement>('[data-acc]').forEach((x) => {
              x.innerHTML = `${robotSvg({ ...look, accessory: x.dataset.acc as RobotLook['accessory'] }, { beam: false, cls: 'robot-svg mini' })}<small>${esc(ACCESSORIES.find((a) => a.id === x.dataset.acc)!.label)}</small>`;
            });
            refreshPreview();
          };
        });
        screen.querySelectorAll<HTMLButtonElement>('[data-acc]').forEach((b) => {
          b.onclick = () => {
            look.accessory = b.dataset.acc as RobotLook['accessory'];
            screen.querySelectorAll('[data-acc]').forEach((x) => x.classList.toggle('on', x === b));
            refreshPreview();
          };
        });
        const name = screen.querySelector<HTMLInputElement>('.name')!;
        name.oninput = () => { look.name = name.value; };
        name.onkeydown = (e) => { if (e.key === 'Enter') name.blur(); };
        screen.querySelector<HTMLButtonElement>('.dice')!.onclick = () => {
          const others = ROBOT_NAMES.filter((n) => n !== look.name);
          look.name = others[Math.floor(Math.random() * others.length)];
          name.value = look.name;
        };
      }
      if (step === 2) {
        // Une tâche remonte en tête de liste, pour montrer qu'on les range.
        const list = screen.querySelector<HTMLElement>('.prio-list')!;
        const timer = setInterval(() => {
          if (!list.isConnected) { clearInterval(timer); return; }
          const items = [...list.children] as HTMLElement[];
          const last = items[items.length - 1];
          list.insertBefore(last, items[0]);
          [...list.children].forEach((li, k) => {
            li.classList.toggle('first', k === 0);
            li.querySelector('.prio-n')!.textContent = String(k + 1);
          });
          last.classList.remove('rise');
          void last.offsetWidth;
          last.classList.add('rise');
        }, 1600);
      }
    };
    render();
  });
}
