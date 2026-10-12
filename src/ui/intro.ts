// Présentation d'une nouvelle partie : le robot, son apparence, son usine.
import { cleanLook, DEFAULT_LOOK, ROBOT_COLORS, ROBOT_NAMES, type RobotLook } from '../data/look.ts';
import { robotSvg } from '../render/robotShapes.ts';

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
          <p class="intro-text">Un petit robot explorateur. Touche le sol pour l’envoyer quelque part : sa lampe dissipe le brouillard et révèle les filons.</p>`;
      } else if (step === 1) {
        body = `
          <div class="intro-stage">${robotSvg(look, { spin: true, cls: 'robot-svg hero' })}</div>
          <h1 class="intro-title">À ton image</h1>
          <div class="custom">
            <p class="custom-label">Couleur</p>
            <div class="swatches">${ROBOT_COLORS.map((c) => `<button class="swatch${c.id === look.color ? ' on' : ''}" data-color="${c.id}" style="background:${hex(c.main)}" aria-label="${esc(c.label)}"></button>`).join('')}</div>
            <p class="custom-label">Nom</p>
            <div class="name-row"><input class="field name" maxlength="14" value="${esc(look.name)}" autocomplete="off" aria-label="Nom du robot"><button class="btn dice" aria-label="Un nom au hasard">🎲</button></div>
            <p class="custom-note">D’autres skins se gagnent avec les succès : à choisir ensuite dans la fenêtre du robot.</p>
          </div>`;
      } else {
        body = `
          <div class="intro-stage">${robotSvg(look, { spin: true, cls: 'robot-svg hero' })}</div>
          <h1 class="intro-title">Ton usine</h1>
          <p class="intro-text">Pose des foreuses sur les filons et relie-les aux machines par des tapis : tout se construit d’un coup.</p>
          <p class="intro-text">Le charbon, les minerais et ce que tu fabriques voyagent sur les tapis, jusqu’au Noyau, au Laboratoire et au Comptoir.</p>`;
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
