import type { Combatant } from '../battle/Combatant';
import type { Crystal } from '../battle/Crystal';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

/** 戦闘中の DOM オーバーレイ HUD（docs/03 §3.9）。 */
export class Hud {
  readonly root = el('div', 'hidden');
  private timer = el('div', 'hud-timer', '1:30');
  private role = el('div', 'hud-role', '');
  private crystalWrap = el('div', 'hud-crystal');
  private crystalBar = el('i');
  private crystalNum = el('div', 'lbl', 'CRYSTAL');
  private hp = el('div', 'hud-hp', '100');
  private hpBar = el('i');
  private respawn = el('div', 'hud-respawn', '');
  private ammo = el('div', 'hud-ammo', '');
  private wname = el('div', 'hud-wname', '');
  private wlist = el('div', 'hud-wlist', '');
  private reload = el('div', 'hud-reload', '');
  private msg = el('div', 'center-msg');
  private hitmarker = el('div', 'hitmarker', '<i style="left:9px;top:0;width:2px;height:20px"></i><i style="top:9px;left:0;height:2px;width:20px"></i>');
  private flash = el('div', 'dmg-flash');
  private feed = el('div', 'killfeed');
  private prep = el('div', 'prep-hint hidden');
  private msgTimer = 0;

  constructor(parent: HTMLElement) {
    this.root.id = 'hud';

    const top = el('div', 'hud-top');
    top.append(this.timer, this.role);

    this.crystalWrap.append(this.crystalNum);
    const cbar = el('div', 'bar');
    cbar.append(this.crystalBar);
    this.crystalWrap.append(cbar);

    const bottom = el('div', 'hud-bottom');
    const hbar = el('div', 'bar hud-hpbar');
    hbar.append(this.hpBar);
    bottom.append(this.hp, hbar, this.respawn);

    const weapon = el('div', 'hud-weapon');
    weapon.append(this.reload, this.ammo, this.wname, this.wlist);

    const cross = el('div', 'crosshair', '<i></i><i></i><i></i><i></i>');

    this.root.append(this.flash, cross, this.hitmarker, top, this.crystalWrap, bottom, weapon, this.msg, this.feed, this.prep);
    parent.append(this.root);
  }

  show(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }

  setRole(team: 'ATTACK' | 'DEFEND'): void {
    this.role.textContent = team === 'ATTACK' ? 'ATTACK — クリスタルを破壊せよ' : 'DEFEND — 90秒守り切れ';
    this.role.className = `hud-role ${team === 'ATTACK' ? 'attack' : 'defend'}`;
  }

  setTimer(seconds: number, urgent: boolean): void {
    const s = Math.max(0, Math.ceil(seconds));
    this.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.timer.classList.toggle('urgent', urgent);
  }

  setCrystal(c: Crystal): void {
    this.crystalBar.style.width = `${c.ratio * 100}%`;
    this.crystalNum.textContent = `CRYSTAL  ${Math.ceil(c.hp)}`;
    this.crystalWrap.classList.toggle('low', c.ratio < 0.35);
  }

  syncPlayer(p: Combatant): void {
    this.hp.textContent = String(Math.ceil(p.hp));
    this.hpBar.style.width = `${(p.hp / p.maxHp) * 100}%`;
    this.hpBar.parentElement?.classList.toggle('warn', p.hp / p.maxHp < 0.35);
    const dots = '●'.repeat(p.respawnsLeft) + '○'.repeat(Math.max(0, 3 - p.respawnsLeft));
    this.respawn.textContent = `RESPAWN ${dots}`;

    const w = p.weapon;
    this.wname.textContent = w.def.name;
    this.ammo.innerHTML = w.isMelee ? '∞' : `${w.ammo}<small> / ${w.def.magazine}</small>`;
    this.reload.textContent = w.reloading ? 'RELOADING…' : w.isCharge && w.charge > 0 ? `CHARGE ${Math.round(w.charge * 100)}%` : '';
    this.wlist.innerHTML = p.weapons
      .map((x, i) => (i === p.current ? `<b>[${i + 1}] ${x.def.name}</b>` : `[${i + 1}] ${x.def.name}`))
      .join('  ');
  }

  hit(): void {
    this.hitmarker.classList.remove('on');
    void this.hitmarker.offsetWidth;
    this.hitmarker.classList.add('on');
  }

  damaged(): void {
    this.flash.classList.add('on');
    window.setTimeout(() => this.flash.classList.remove('on'), 170);
  }

  message(text: string, sub = '', duration = 1.6): void {
    this.msg.innerHTML = sub ? `${text}<span class="center-sub">${sub}</span>` : text;
    this.msg.classList.add('on');
    this.msgTimer = duration;
  }

  log(text: string): void {
    const line = el('div', undefined, text);
    this.feed.prepend(line);
    while (this.feed.childElementCount > 5) this.feed.lastElementChild?.remove();
    window.setTimeout(() => line.remove(), 5000);
  }

  setPrepare(text: string | null): void {
    this.prep.classList.toggle('hidden', text === null);
    if (text) this.prep.innerHTML = text;
  }

  update(dt: number): void {
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) this.msg.classList.remove('on');
    }
  }

  clear(): void {
    this.feed.innerHTML = '';
    this.msg.classList.remove('on');
    this.prep.classList.add('hidden');
  }
}
