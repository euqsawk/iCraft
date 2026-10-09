// Présentation d'une nouvelle partie : le robot, son apparence, ses drones.
import { ACCESSORIES, cleanLook, DEFAULT_LOOK, ROBOT_COLORS, ROBOT_NAMES, type RobotLook } from '../data/look.ts';
import { droneSvg, robotSvg } from '../render/robotShapes.ts';
import { DRONE_PRIORITIES } from '../sim/game.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

const PRIO_ICONS: Record<string, string> = {
  carburant: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 3 L11 2 L14 8 L10 14 L3 12 L2 6 Z" fill="#2E3A4B"/></svg>',
  chantiers: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="#2E3A4B" stroke-width="2" stroke-linecap="round"><path d="M3 13 L9 7 M8 3 L13 8 L11 10 L6 5 Z"/></svg>',
  noyau: '<svg viewBox="0 0 16 16" width="14" height="14"><rect x="2" y="2" width="12" height="12" rx="3" fill="#F47C64"/></svg>',
  laboratoire: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="#2E3A4B" stroke-width="1.8" stroke-linejoin="round"><path d="M6 2 H10 M7 2 V6 L3 13 H13 L9 6 V2"/></svg>',
  comptoir: '<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="6" fill="#FFC857" stroke="#2E3A4B" stroke-width="1.6"/></svg>',
  robot: '<svg viewBox="0 0 16 16" width="14" height="14"><rect x="3" y="3" width="10" height="9" rx="2.5" fill="#FFC857"/><circle cx="5" cy="13.5" r="1.6" fill="#2E3A4B"/><circle cx="11" cy="13.5" r="1.6" fill="#2E3A4B"/></svg>',
};

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
            <p class="custom-label">Touche ${esc(look.name)} pour donner une priorité à chaque drone : il fait ça d’abord, puis le reste.</p>
            <div class="prio-chips">${DRONE_PRIORITIES.map((p, i) => `<span class="pchip${i === 0 ? ' on' : ''}">${PRIO_ICONS[p.id] ?? ''}${esc(p.label)}</span>`).join('')}</div>
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
        // Les priorités défilent, pour montrer qu'on en choisit une par drone.
        const chips = [...screen.querySelectorAll('.pchip')];
        let i = 0;
        const timer = setInterval(() => {
          if (!chips[0]?.isConnected) { clearInterval(timer); return; }
          i = (i + 1) % chips.length;
          chips.forEach((c, j) => c.classList.toggle('on', j === i));
        }, 1100);
      }
    };
    render();
  });
}
