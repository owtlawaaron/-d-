#!/usr/bin/env node
/**
 * dist/ のビルド結果を1枚の自己完結 HTML にまとめる。
 *
 * 生成物は Claude Artifact としてそのまま公開できる形（<html>/<head>/<body> を含まない、
 * <title> + <style> + マークアップ + インライン <script> だけ）にする。
 *
 * usage:
 *   npm run build && node tools/build-artifact.mjs
 *   → dist/seat-wars.artifact.html
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const assets = join(dist, 'assets');

const files = readdirSync(assets);
const jsName = files.find((f) => f.endsWith('.js'));
const cssName = files.find((f) => f.endsWith('.css'));
if (!jsName) throw new Error('dist/assets に JS が見つかりません。先に npm run build を実行してください');

const js = readFileSync(join(assets, jsName), 'utf8');
const css = cssName ? readFileSync(join(assets, cssName), 'utf8') : '';

// インライン script の中で </script> が現れると HTML が壊れるので潰す
const safeJs = js.replace(/<\/script/gi, '<\\/script');

const html = `<title>SEAT WARS</title>
<style>
${css}
/* Artifact のホスト側に埋め込まれるときの保険 */
html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: #05070c; }
#app { position: fixed; inset: 0; }
</style>
<div id="app">
  <canvas id="scene"></canvas>
  <div id="ui"></div>
</div>
<script type="module">
${safeJs}
</script>
`;

const out = join(dist, 'seat-wars.artifact.html');
writeFileSync(out, html);
console.log(`wrote ${out}  (${(html.length / 1024).toFixed(0)} KB)`);
