import type { Classroom } from '../meta/Classroom';
import type { Student } from '../meta/Student';
import type { Challenge } from '../meta/Challenge';
import { audio } from '../core/Audio';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** 席価値に応じた背景色（低い=沈んだ青、高い=金）。 */
function valueColor(v: number): string {
  const k = Math.max(0, Math.min(1, v / 100));
  const h = 210 - k * 175;
  const s = 22 + k * 46;
  const l = 16 + k * 22;
  return `hsl(${h} ${s}% ${l}%)`;
}

export type SeatingChoice =
  | { type: 'challenge'; target: Student }
  | { type: 'defend'; challenge: Challenge }
  | { type: 'skip' };

export interface SeatingContext {
  room: Classroom;
  turnsTotal: number;
  incoming: Challenge | null;
  canChallenge: boolean;
  log: string[];
  /** 相手候補の推定勝率 */
  winChance: (target: Student) => number;
  onHoverSeat?: (index: number | null) => void;
}

/** タイトル・席替え・結果・成績のフルスクリーン UI。 */
export class Screens {
  private layer: HTMLElement;

  constructor(parent: HTMLElement) {
    this.layer = el('div');
    parent.append(this.layer);
  }

  private mount(node: HTMLElement): void {
    this.layer.innerHTML = '';
    this.layer.append(node);
  }

  clear(): void {
    this.layer.innerHTML = '';
  }

  // ------------------------------------------------------------------ title

  title(): Promise<void> {
    return new Promise((resolve) => {
      const s = el('div', 'screen');
      s.append(
        el('p', 'title-sub', 'SCHOOL SEAT SHUFFLE — FPS'),
        el('h1', 'title-main', 'SEAT WARS'),
        el('p', 'title-lead',
          '席替えは運。だが席は実力で獲る。<br>'
          + '不満を溜め込んだ生徒は、良い席を引いた相手に <b>タイマン</b> を申し込む。<br>'
          + '挑戦側は攻め、受ける側は守り。<b>90秒</b>守り切れば防衛成功、'
          + '<b>座席権クリスタル</b>を割れば席を強奪できる。'),
      );
      const help = el('div', 'panel muted');
      help.innerHTML = `
        <b style="color:#cfe0f0">操作</b><br>
        <span class="kbd">W A S D</span> 移動　<span class="kbd">Space</span> ジャンプ　
        <span class="kbd">Shift</span> 歩き　<span class="kbd">Ctrl / C</span> しゃがみ<br>
        <span class="kbd">左クリック</span> 射撃　<span class="kbd">R</span> リロード　
        <span class="kbd">1 2 3</span> 武器　<span class="kbd">Q</span> 切替<br>
        <span class="kbd">Enter</span> 準備フェーズを早く終える　<span class="kbd">Esc</span> ポーズ<br>
        守り側の準備中は <span class="kbd">左</span> 机バリケード / <span class="kbd">右</span> 教科書シールド / <span class="kbd">T</span> 画鋲`;
      const btn = el('button', undefined, '登校する');
      btn.onclick = () => { audio.resume(); audio.play('ui'); resolve(); };
      const row = el('div', 'row');
      row.append(btn);
      s.append(help, row);
      this.mount(s);
    });
  }

  // ---------------------------------------------------------------- seating

  seating(ctx: SeatingContext): Promise<SeatingChoice> {
    return new Promise((resolve) => {
      const room = ctx.room;
      const player = room.player;
      const screen = el('div', 'screen');
      const grid = el('div', 'seating');

      // --- 左: 教室ボード ---
      const boardWrap = el('div', 'board-wrap');
      boardWrap.append(el('div', 'board-head',
        `<span>ターン ${room.turn} / ${ctx.turnsTotal}</span><span>教室の席価値マップ</span>`));
      boardWrap.append(el('div', 'blackboard', '黒　板'));

      const seatGrid = el('div', 'seat-grid');
      seatGrid.style.gridTemplateColumns = `repeat(${room.calc.cols}, minmax(74px, 1fr))`;
      const throne = room.ranking()[0].seat.index;
      const cells: HTMLElement[] = [];

      for (const seat of room.calc.seats) {
        const occupant = room.studentAt(seat);
        const base = room.calc.baseValue(seat);
        const cell = el('div', 'seat');
        cell.style.background = valueColor(base);
        if (seat.index === throne) cell.classList.add('throne');
        if (occupant === player) cell.classList.add('player');
        cell.innerHTML =
          `<span class="val">${Math.round(base)}</span>`
          + `<span class="nm">${occupant ? esc(occupant.name) : '空席'}</span>`
          + `<span class="tag">${room.calc.tagLabels(seat)[0] ?? ''}</span>`;
        cell.title = `${room.calc.tagLabels(seat).join(' / ') || '特徴なし'}\n客観値 ${Math.round(base)}`;
        cells.push(cell);
        seatGrid.append(cell);
      }
      boardWrap.append(seatGrid);
      boardWrap.append(el('div', 'board-foot', '<span>出入口・廊下側</span><span>窓・エアコン側</span>'));

      // --- 右: 自分の状態と行動 ---
      const side = el('div', 'side');
      const myValue = room.perceivedValue(player, player.seat);
      const status = el('div', 'panel');
      status.innerHTML = `
        <div style="font-size:17px;font-weight:800">${esc(player.name)}<span class="muted" style="margin-left:8px">あなた</span></div>
        <div class="stat-line"><span>いまの席</span><b>${player.seat.col + 1}列 ${player.seat.row + 1}行目</b></div>
        <div class="stat-line"><span>体感の席価値</span><b>${Math.round(myValue)}</b></div>
        <div class="stat-line"><span>自己評価（期待値）</span><b>${Math.round(player.expectedSeat)}</b></div>
        <div class="stat-line"><span>戦績</span><b>${player.wins}勝 ${player.losses}敗</b></div>
        <div style="margin-top:10px" class="muted">不満度 ${Math.round(player.frustration)}</div>
        <div class="bar"><i style="width:${player.frustration}%"></i></div>
        <div style="margin-top:8px" class="muted">素行点 ${player.conduct} / 100（0で学級指導・ゲームオーバー）</div>
        <div class="bar warn"><i style="width:${player.conduct}%"></i></div>`;
      side.append(status);

      const action = el('div', 'panel');
      side.append(action);

      if (ctx.log.length) {
        const logPanel = el('div', 'panel');
        logPanel.innerHTML = '<div class="muted" style="margin-bottom:6px">前のターンの出来事</div>';
        const log = el('div', 'log');
        for (const line of ctx.log) log.append(el('div', undefined, line));
        logPanel.append(log);
        side.append(logPanel);
      }

      grid.append(boardWrap, side);
      screen.append(grid);
      this.mount(screen);

      // --- 行動の分岐 ---
      const finish = (choice: SeatingChoice) => {
        audio.play('ui');
        ctx.onHoverSeat?.(null);
        resolve(choice);
      };

      if (ctx.incoming) {
        const c = ctx.incoming;
        const chance = 1 - ctx.winChance(c.attacker);
        action.innerHTML = `
          <div style="color:#ff8a6a;font-weight:800;letter-spacing:.1em">挑戦を受けた</div>
          <div style="margin:8px 0;line-height:1.8">
            <b>${esc(c.attacker.name)}</b>（${c.attacker.seat.col + 1}列${c.attacker.seat.row + 1}行目）が
            あなたの席を狙っている。<br><span class="muted">理由: ${c.reason}</span>
          </div>
          <div class="stat-line"><span>あなたの推定防衛成功率</span><b>${Math.round(chance * 100)}%</b></div>
          <div class="muted" style="margin-top:8px">守り側は90秒守り切れば勝ち。準備フェーズで机を並べろ。</div>`;
        const btn = el('button', 'danger', '受けて立つ');
        btn.onclick = () => finish({ type: 'defend', challenge: c });
        const row = el('div', 'row');
        row.style.marginTop = '12px';
        row.append(btn);
        action.append(row);
        // 相手の席を光らせる
        cells[c.attacker.seat.index].classList.add('attacker-mark');
        return;
      }

      const targets = room.students
        .filter((s) => s !== player && room.perceivedValue(player, s.seat) > myValue + 2)
        .sort((a, b) => room.perceivedValue(player, b.seat) - room.perceivedValue(player, a.seat));

      const renderIdle = () => {
        action.innerHTML = `
          <div style="font-weight:800;letter-spacing:.1em">放課後</div>
          <div class="muted" style="margin:8px 0;line-height:1.8">
            挑戦できるのは1日1回。勝てば席を交換、負ければ2ターン挑戦できず素行点も減る。
          </div>`;
        const row = el('div', 'row');
        const challengeBtn = el('button', undefined, '挑戦する相手を選ぶ');
        challengeBtn.disabled = !ctx.canChallenge || targets.length === 0;
        if (!ctx.canChallenge) challengeBtn.title = 'クールダウン中、または素行点が足りない';
        challengeBtn.onclick = () => { audio.play('ui'); renderPicking(); };
        const skipBtn = el('button', 'ghost', '今日は我慢する');
        skipBtn.onclick = () => finish({ type: 'skip' });
        row.append(challengeBtn, skipBtn);
        action.append(row);
        cells.forEach((c) => c.classList.remove('targetable'));
        ctx.onHoverSeat?.(null);
      };

      const renderPicking = () => {
        action.innerHTML = `
          <div style="font-weight:800;letter-spacing:.1em;color:#ffb08a">挑戦相手を選べ</div>
          <div class="muted" style="margin:8px 0">自分より良い席の生徒をクリック。推定勝率も見ておけ。</div>`;
        const list = el('div', 'log');
        for (const t of targets) {
          const line = el('div');
          const win = Math.round(ctx.winChance(t) * 100);
          const value = Math.round(room.perceivedValue(player, t.seat));
          line.innerHTML = `<b>${esc(t.name)}</b> — 席価値 ${value} / 推定勝率 <b>${win}%</b>`;
          line.style.cursor = 'pointer';
          line.onmouseenter = () => ctx.onHoverSeat?.(t.seat.index);
          line.onclick = () => finish({ type: 'challenge', target: t });
          list.append(line);
        }
        action.append(list);
        const back = el('button', 'ghost', 'やめる');
        back.onclick = () => { audio.play('ui'); renderIdle(); };
        const row = el('div', 'row');
        row.style.marginTop = '10px';
        row.append(back);
        action.append(row);

        for (const t of targets) {
          const cell = cells[t.seat.index];
          cell.classList.add('targetable');
          cell.onmouseenter = () => ctx.onHoverSeat?.(t.seat.index);
          cell.onclick = () => finish({ type: 'challenge', target: t });
        }
      };

      renderIdle();
    });
  }

  // ----------------------------------------------------------------- results

  turnResult(title: string, win: boolean | null, lines: string[], buttonLabel = '次のターンへ'): Promise<void> {
    return new Promise((resolve) => {
      const s = el('div', 'screen');
      const h = el('div', `result-title ${win === null ? '' : win ? 'win' : 'lose'}`, title);
      s.append(h);
      const panel = el('div', 'panel');
      panel.style.minWidth = '420px';
      const log = el('div', 'log');
      log.style.maxHeight = '320px';
      for (const line of lines) {
        const d = el('div', undefined, line);
        const won = line.includes('勝ち') || line.includes('奪った') || line.includes('守り切った');
        const lost = line.includes('敗北') || line.includes('奪われた');
        if (won && !lost) d.className = 'win';
        else if (lost) d.className = 'lose';
        log.append(d);
      }
      if (!lines.length) log.append(el('div', 'muted', '今日は何も起きなかった。'));
      panel.append(log);
      const btn = el('button', undefined, buttonLabel);
      btn.onclick = () => { audio.play('ui'); resolve(); };
      const row = el('div', 'row');
      row.append(btn);
      s.append(panel, row);
      this.mount(s);
    });
  }

  termEnd(room: Classroom, grade: string, comment: string): Promise<void> {
    return new Promise((resolve) => {
      const s = el('div', 'screen');
      s.append(el('p', 'title-sub', 'TERM RESULT — 学期末'));
      s.append(el('div', 'result-title win', grade));
      s.append(el('p', 'title-lead', comment));

      const panel = el('div', 'panel');
      const table = el('table', 'rank');
      table.innerHTML = '<tr><th>#</th><th>生徒</th><th>席</th><th>席価値</th><th>戦績</th></tr>';
      const ranked = [...room.students].sort(
        (a, b) => room.calc.baseValue(b.seat) - room.calc.baseValue(a.seat),
      );
      ranked.slice(0, 12).forEach((st, i) => {
        const tr = el('tr', st.isPlayer ? 'me' : undefined);
        tr.innerHTML = `<td>${i + 1}</td><td>${esc(st.name)}</td>`
          + `<td>${st.seat.col + 1}列${st.seat.row + 1}行目</td>`
          + `<td>${Math.round(room.calc.baseValue(st.seat))}</td>`
          + `<td>${st.wins}勝${st.losses}敗</td>`;
        table.append(tr);
      });
      panel.append(table);
      const btn = el('button', undefined, 'もう一度');
      btn.onclick = () => { audio.play('ui'); resolve(); };
      const row = el('div', 'row');
      row.append(btn);
      s.append(panel, row);
      this.mount(s);
    });
  }

  pause(onResume: () => void, onQuit?: () => void): void {
    const s = el('div', 'pause');
    s.append(el('div', 'result-title', 'PAUSE'));
    s.append(el('p', 'muted', '画面のどこかをクリックで戦闘に戻る'));
    const row = el('div', 'row');
    const resume = el('button', undefined, '再開する');
    resume.onclick = (e) => { e.stopPropagation(); audio.resume(); audio.play('ui'); onResume(); };
    row.append(resume);
    if (onQuit) {
      const quit = el('button', 'ghost', '降参する');
      quit.onclick = (e) => { e.stopPropagation(); audio.play('ui'); onQuit(); };
      row.append(quit);
    }
    // オーバーレイのどこを押しても再開できるようにする
    s.onclick = () => { audio.resume(); onResume(); };
    s.append(row);
    this.mount(s);
  }

  loading(text = 'LOADING'): void {
    this.mount(el('div', 'loader', text));
  }

  issues(list: { source: string; message: string }[]): void {
    if (!list.length) return;
    console.warn('[SEAT WARS] データの読み込みで問題:', list);
  }
}
