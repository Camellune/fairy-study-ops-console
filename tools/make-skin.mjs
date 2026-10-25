/*
 * 皮肤图预处理：把任意官方素材裁成 16:9 并压到合适体积
 * 用法：node make-skin.mjs <源图> [输出jpg] [宽度=1440] [质量=82]
 *
 * 为什么要过浏览器：本机装不上 Pillow / sharp（pip 与 npm 源都拿不到），
 * 而 playwright + Edge 现成可用，canvas 的 drawImage + toDataURL 足够做裁切与重采样。
 * 产出的 jpg 由 build-ops.js --skin 内联进「本地版」HTML，不随发行版分发。
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const src = process.argv[2];
const dst = process.argv[3] || path.join('assets', 'skin', 'sunbringer.jpg');
const W = +(process.argv[4] || 1440);
const Q = +(process.argv[5] || 82);
if (!src) { console.error('用法: node make-skin.mjs <源图> [输出] [宽度] [质量]'); process.exit(1); }

const raw = fs.readFileSync(src);
const mime = /\.png$/i.test(src) ? 'image/png' : 'image/jpeg';
const dataUrl = `data:${mime};base64,` + raw.toString('base64');

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage();
await page.goto('about:blank');

const out = await page.evaluate(async ({ dataUrl, W, Q }) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('图片加载失败')); img.src = dataUrl; });
  const sw = img.width, sh = img.height;
  // 目标 16:9，横向撑满、纵向居中偏上（保留人物头部，切掉底部地面与文字）
  const ratio = 16 / 9;
  let cw = sw, ch = Math.round(sw / ratio);
  if (ch > sh) { ch = sh; cw = Math.round(sh * ratio); }
  const sx = Math.round((sw - cw) / 2);
  const sy = Math.round(Math.min(sh - ch, sh * 0.045));
  const tw = Math.min(W, cw), th = Math.round(tw / ratio);
  const c = document.createElement('canvas');
  c.width = tw; c.height = th;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, sx, sy, cw, ch, 0, 0, tw, th);
  return { url: c.toDataURL('image/jpeg', Q / 100), sw, sh, cw, ch, sx, sy, tw, th };
}, { dataUrl, W, Q });

await browser.close();

fs.mkdirSync(path.dirname(dst), { recursive: true });
const b64 = out.url.split(',')[1];
fs.writeFileSync(dst, Buffer.from(b64, 'base64'));
console.log(`源图 ${out.sw}x${out.sh} → 裁剪 ${out.cw}x${out.ch} @(${out.sx},${out.sy}) → 输出 ${out.tw}x${out.th}`);
console.log(`已写入 ${dst}  ${(fs.statSync(dst).size / 1024).toFixed(0)} KB`);
