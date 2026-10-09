// Conseils de début de partie : un à la fois, en haut de l'écran.
// Chacun se valide tout seul quand le joueur a fait ce qu'il dit (ou avec « Compris »).
import type { Game } from '../sim/game.ts';

export interface TipContext {
  /** Le joueur a ouvert la bulle du robot. */
  robotOpened: boolean;
}

interface Tip {
  id: string;
  title: string;
  text: (g: Game) => string;
  /** Le conseil peut-il s'afficher maintenant ? */
  when?: (g: Game) => boolean;
  /** Le joueur l'a-t-il appliqué ? */
  goal?: (g: Game, c: TipContext) => boolean;
}

const machines = (g: Game) => [...g.factory.machines.values()];
const has = (g: Game, type: string, built = false) => machines(g).some((m) => m.type === type && (!built || m.built));

export const TIPS: Tip[] = [
  {
    id: 'charbon', title: 'Tout marche au charbon',
    text: (g) => `Tes machines, ${g.look.name} et ses drones brûlent du charbon. Envoie ${g.look.name} sur le filon gris foncé : à l’arrêt, il mine tout seul.`,
    goal: (g) => g.robot.inv.count('charbon') > 0 || machines(g).some((m) => m.ore === 'charbon'),
  },
  {
    id: 'foreuse', title: 'Une foreuse sur le charbon',
    text: () => 'Outil Machine, puis Foreuse : pose-la sur le filon de charbon. Ton drone lui apporte les 10 charbons de sa soute pour la lancer.',
    goal: (g) => machines(g).some((m) => m.type === 'foreuse' && m.ore === 'charbon'),
  },
  {
    id: 'coffre', title: 'Un coffre à charbon',
    text: () => 'Pose un Coffre et relie-y la foreuse avec l’outil Tapis. Les drones y prennent le charbon pour les machines dont le voyant clignote.',
    goal: (g) => has(g, 'coffre'),
  },
  {
    id: 'fer', title: 'Du fer pour le Noyau',
    text: () => 'Une foreuse sur le fer (gris-bleu), un Four, puis un tapis du four jusqu’au Noyau. Touche le Noyau pour voir ce que demande sa mission.',
    goal: (g) => (g.palierDone.lingot_fer ?? 0) > 0 || g.palier > 1,
  },
  {
    id: 'comptoir', title: 'Gagner des pièces',
    text: () => 'Pose un Comptoir : ses commandes rapportent les pièces qui paient tes constructions. Touche-le pour en choisir une.',
    goal: (g) => has(g, 'comptoir'),
  },
  {
    id: 'labo', title: 'Débloquer la Presse',
    text: () => 'Pose un Laboratoire et apporte-lui 20 lingots de fer. Ensuite, touche ton palier en haut à gauche pour ouvrir l’arbre et débloquer la Presse.',
    goal: (g) => g.isUnlocked('presse'),
  },
  {
    id: 'drones', title: 'Le travail des drones',
    text: (g) => `Touche ${g.look.name} : tu vois son inventaire et son charbon. Touche un drone pour ranger ses tâches, de la plus importante à la moins importante.`,
    goal: (_g, c) => c.robotOpened,
  },
  {
    id: 'separateur', title: 'Séparer un tapis',
    text: () => 'Avec l’outil Tapis, glisse depuis le milieu d’un tapis : un objet sur deux part de côté.',
    when: (g) => g.isUnlocked('separateur'),
    goal: (g) => [...g.factory.belts.values()].some((b) => b.split !== undefined),
  },
  {
    id: 'palier2', title: 'Palier 2 !',
    text: () => 'Le Noyau a grandi : la suite de l’arbre est ouverte, et sa nouvelle mission demande des pièces plus travaillées. Un deuxième drone t’attend dans la branche Robot.',
    when: (g) => g.palier >= 2,
  },
];

export class Tips {
  private el: HTMLElement;
  private game: Game;
  private ctx: TipContext = { robotOpened: false };
  private current: Tip | null = null;
  private wait = 0;
  private timer = 0;
  private hidden = false;
  private started = false;

  constructor(root: HTMLElement, game: Game) {
    this.game = game;
    this.el = document.createElement('div');
    this.el.className = 'tip hidden';
    root.append(this.el);
  }

  /** Démarre les conseils (après l'animation d'arrivée). */
  start(): void {
    this.started = true;
    this.wait = 0.8;
  }

  note(what: keyof TipContext): void {
    this.ctx[what] = true;
  }

  /** Cache le conseil un moment (pendant un tracé, par exemple). */
  setHidden(h: boolean): void {
    if (h === this.hidden) return;
    this.hidden = h;
    this.el.classList.toggle('away', h);
  }

  get active(): boolean {
    return this.started && !this.game.tips.off;
  }

  private done(id: string): void {
    if (!this.game.tips.done.includes(id)) this.game.tips.done.push(id);
  }

  private next(): Tip | null {
    const t = this.game.tips;
    for (const tip of TIPS) {
      if (t.done.includes(tip.id)) continue;
      // Déjà fait avant même d'en parler : on le passe sans rien dire.
      if (tip.goal?.(this.game, this.ctx)) { this.done(tip.id); continue; }
      if (tip.when && !tip.when(this.game)) continue;
      return tip;
    }
    return null;
  }

  private show(tip: Tip): void {
    this.current = tip;
    const n = TIPS.indexOf(tip) + 1;
    this.el.className = `tip${this.hidden ? ' away' : ''}`;
    this.el.innerHTML = `<div class="tip-head"><span class="tip-badge">Conseil ${n}/${TIPS.length}</span><button class="tip-x" aria-label="Compris">Compris</button></div>
      <b>${tip.title}</b><p>${tip.text(this.game)}</p>
      <button class="tip-off">Plus de conseils sur cette partie</button>`;
    this.el.querySelector<HTMLButtonElement>('.tip-x')!.onclick = () => this.dismiss(false);
    this.el.querySelector<HTMLButtonElement>('.tip-off')!.onclick = () => {
      this.game.tips.off = true;
      this.hide();
    };
  }

  private hide(): void {
    this.current = null;
    this.el.classList.add('hidden');
  }

  /** Le conseil en cours est fait (bravo) ou fermé. */
  private dismiss(success: boolean): void {
    const tip = this.current;
    if (!tip) return;
    this.done(tip.id);
    if (success) {
      this.el.classList.add('success');
      this.el.querySelector('.tip-badge')!.textContent = 'Bien joué !';
      this.current = null;
      setTimeout(() => { if (!this.current) this.el.classList.add('hidden'); }, 1300);
      this.wait = 2.4;
    } else {
      this.hide();
      this.wait = 1.2;
    }
  }

  /** Les conseils ont été réactivés depuis le menu. */
  restart(): void {
    this.game.tips.off = false;
    this.wait = 0.3;
  }

  update(dt: number): void {
    if (!this.active) {
      if (this.current) this.hide();
      return;
    }
    this.timer += dt;
    if (this.timer < 0.25) return;
    const step = this.timer;
    this.timer = 0;
    if (this.current) {
      if (this.current.goal?.(this.game, this.ctx)) this.dismiss(true);
      return;
    }
    if (this.wait > 0) { this.wait -= step; return; }
    const tip = this.next();
    if (tip) this.show(tip);
  }
}
