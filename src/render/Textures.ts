import * as THREE from 'three';

/**
 * 画像アセットを一切持たずに、Canvas で教室の質感を作る。
 * すべてキャッシュして使い回す（生成は1回だけ）。
 */
const cache = new Map<string, THREE.Texture>();

function make(key: string, size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void,
              repeat: [number, number] = [1, 1]): THREE.Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

function noise(ctx: CanvasRenderingContext2D, s: number, amount: number, alpha: number): void {
  for (let i = 0; i < amount; i++) {
    const x = Math.random() * s;
    const y = Math.random() * s;
    ctx.fillStyle = `rgba(0,0,0,${alpha * Math.random()})`;
    ctx.fillRect(x, y, 1 + Math.random() * 2, 1);
  }
}

/** 教室の床。縦方向に走る板目とつなぎ目。 */
export function floorTexture(repeat = 8): THREE.Texture {
  return make(`floor${repeat}`, 512, (ctx, s) => {
    ctx.fillStyle = '#c2a274';
    ctx.fillRect(0, 0, s, s);
    const planks = 8;
    const w = s / planks;
    for (let i = 0; i < planks; i++) {
      const shade = 0.86 + Math.random() * 0.22;
      ctx.fillStyle = `rgb(${Math.round(194 * shade)},${Math.round(162 * shade)},${Math.round(116 * shade)})`;
      ctx.fillRect(i * w, 0, w, s);
      // 木目
      ctx.strokeStyle = 'rgba(105, 78, 45, 0.22)';
      ctx.lineWidth = 1;
      for (let g = 0; g < 11; g++) {
        const x = i * w + 3 + Math.random() * (w - 6);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        for (let y = 0; y <= s; y += 24) ctx.lineTo(x + Math.sin(y * 0.03 + i) * 2.2, y);
        ctx.stroke();
      }
      // 板の継ぎ目
      ctx.fillStyle = 'rgba(60, 42, 22, 0.5)';
      ctx.fillRect(i * w, 0, 1.5, s);
      // 板の切れ目（横目地）
      const seam = Math.random() * s;
      ctx.fillRect(i * w, seam, w, 1.5);
    }
    noise(ctx, s, 2200, 0.10);
  }, [repeat, repeat]);
}

/** 黒板。緑地にチョークの拭き跡と、うっすら残った板書。 */
export function blackboardTexture(): THREE.Texture {
  return make('blackboard', 512, (ctx, s) => {
    ctx.fillStyle = '#28503b';
    ctx.fillRect(0, 0, s, s);
    // 拭き跡
    for (let i = 0; i < 60; i++) {
      ctx.strokeStyle = `rgba(220,235,225,${0.02 + Math.random() * 0.05})`;
      ctx.lineWidth = 6 + Math.random() * 22;
      ctx.beginPath();
      const y = Math.random() * s;
      ctx.moveTo(-20, y);
      ctx.bezierCurveTo(s * 0.3, y + 20, s * 0.6, y - 20, s + 20, y + 8);
      ctx.stroke();
    }
    // 残った板書っぽい線
    ctx.strokeStyle = 'rgba(235,245,240,0.30)';
    ctx.lineWidth = 2.5;
    for (let row = 0; row < 4; row++) {
      const y = 90 + row * 84;
      let x = 40 + Math.random() * 30;
      while (x < s - 60) {
        const w = 12 + Math.random() * 26;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + w, y + (Math.random() - 0.5) * 8);
        ctx.stroke();
        if (Math.random() < 0.4) {
          ctx.beginPath();
          ctx.moveTo(x + w * 0.4, y - 9);
          ctx.lineTo(x + w * 0.4, y + 9);
          ctx.stroke();
        }
        x += w + 10 + Math.random() * 14;
      }
    }
    noise(ctx, s, 900, 0.07);
  });
}

/** 壁。塗り壁の細かいムラ。 */
export function wallTexture(repeat = 4): THREE.Texture {
  return make(`wall${repeat}`, 256, (ctx, s) => {
    ctx.fillStyle = '#ded7c6';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 1400; i++) {
      const x = Math.random() * s;
      const y = Math.random() * s;
      const a = Math.random() * 0.05;
      ctx.fillStyle = Math.random() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
      ctx.fillRect(x, y, 2, 2);
    }
  }, [repeat, repeat]);
}

/** 机の天板。木目＋落書きと傷。 */
export function deskTopTexture(): THREE.Texture {
  return make('desktop', 256, (ctx, s) => {
    ctx.fillStyle = '#dcbb8c';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(120, 88, 50, 0.20)';
    ctx.lineWidth = 1;
    for (let g = 0; g < 26; g++) {
      const y = Math.random() * s;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= s; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.05 + g) * 2.5);
      ctx.stroke();
    }
    // 傷と落書き
    ctx.strokeStyle = 'rgba(70,60,50,0.28)';
    for (let i = 0; i < 7; i++) {
      ctx.lineWidth = 0.8 + Math.random();
      ctx.beginPath();
      const x = Math.random() * s;
      const y = Math.random() * s;
      ctx.moveTo(x, y);
      ctx.lineTo(x + (Math.random() - 0.5) * 60, y + (Math.random() - 0.5) * 40);
      ctx.stroke();
    }
    noise(ctx, s, 500, 0.06);
  });
}

/** ロッカーの扉（縦の並びとルーバー）。 */
export function lockerTexture(): THREE.Texture {
  return make('locker', 256, (ctx, s) => {
    ctx.fillStyle = '#98a3ad';
    ctx.fillRect(0, 0, s, s);
    const cols = 4;
    const rows = 3;
    const w = s / cols;
    const h = s / rows;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const x = c * w + 3;
        const y = r * h + 3;
        ctx.fillStyle = `rgb(${152 + Math.random() * 10 | 0},${163 + Math.random() * 10 | 0},${173 + Math.random() * 10 | 0})`;
        ctx.fillRect(x, y, w - 6, h - 6);
        ctx.strokeStyle = 'rgba(40,50,60,0.55)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w - 6, h - 6);
        // ルーバー
        ctx.strokeStyle = 'rgba(50,60,70,0.35)';
        ctx.lineWidth = 1.5;
        for (let l = 0; l < 4; l++) {
          const ly = y + 10 + l * 7;
          ctx.beginPath();
          ctx.moveTo(x + 8, ly);
          ctx.lineTo(x + w - 14, ly);
          ctx.stroke();
        }
        // 取っ手
        ctx.fillStyle = '#5b6672';
        ctx.fillRect(x + w - 22, y + h * 0.5, 8, 14);
      }
    }
  });
}

/** 窓の外。空のグラデーションと遠景の校舎・木。 */
export function skyTexture(): THREE.Texture {
  return make('sky', 512, (ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, '#5aa8e8');
    g.addColorStop(0.55, '#a7d6f2');
    g.addColorStop(0.72, '#dcecdc');
    g.addColorStop(1, '#8fae76');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    // 雲
    for (let i = 0; i < 14; i++) {
      const x = Math.random() * s;
      const y = 30 + Math.random() * 150;
      ctx.fillStyle = `rgba(255,255,255,${0.35 + Math.random() * 0.4})`;
      for (let b = 0; b < 5; b++) {
        ctx.beginPath();
        ctx.ellipse(x + b * 18 - 36, y + Math.sin(b) * 6, 26 + Math.random() * 16, 12 + Math.random() * 8, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // 遠景の校舎
    ctx.fillStyle = 'rgba(198, 200, 196, 0.9)';
    ctx.fillRect(40, 300, 150, 80);
    ctx.fillStyle = 'rgba(150, 170, 195, 0.9)';
    for (let r = 0; r < 3; r++) for (let c = 0; c < 7; c++) ctx.fillRect(50 + c * 20, 310 + r * 24, 12, 14);
    // 木
    for (let i = 0; i < 9; i++) {
      const x = 230 + i * 32 + Math.random() * 12;
      const y = 356 + Math.random() * 10;
      ctx.fillStyle = '#6b4b2c';
      ctx.fillRect(x - 2, y, 5, 22);
      ctx.fillStyle = `rgb(${60 + Math.random() * 30 | 0},${110 + Math.random() * 40 | 0},${55 + Math.random() * 25 | 0})`;
      ctx.beginPath();
      ctx.arc(x, y - 4, 14 + Math.random() * 7, 0, Math.PI * 2);
      ctx.fill();
    }
    // グラウンド
    ctx.fillStyle = '#c9a377';
    ctx.fillRect(0, 400, s, s - 400);
    noise(ctx, s, 1200, 0.05);
  });
}

/** 制服の布地（わずかな織り目）。 */
export function fabricTexture(): THREE.Texture {
  return make('fabric', 128, (ctx, s) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 2) {
      ctx.fillStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.03})`;
      ctx.fillRect(0, y, s, 1);
    }
    for (let x = 0; x < s; x += 3) {
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(x, 0, 1, s);
    }
  }, [3, 3]);
}

export function disposeTextures(): void {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}
