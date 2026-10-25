/*
 * 生成「每日一览」卡片里的官方邦布贴图（一整套 15 只）。
 *
 * 来源：米哈游官方美术的邦布设定图（米游社官方 CDN）
 *   https://upload-bbs.mihoyo.com/upload/2022/08/11/277549521/2211081d60ca4e2518defaf265b2da02_1974662815705877667.jpg
 *   原图 1080×1710，3 列 × 5 行共 15 只邦布，白底，右下角署名 Mavin 2022-08-10 ZZZ。
 *
 * 15 只全部抠成透明 PNG，输出到 assets/bangboo/bb-00.png … bb-14.png，
 * 由构建脚本内联进 HTML；「每日一览」的 7 个日期格各用一只不同的。
 *
 * 本机没有 Pillow / sharp（pip 与 npm 源都不通），所以照样用 playwright + Edge 的
 * canvas 做裁切、去白底（转 alpha）、裁到内容、重采样，和 make-skin.mjs 同一套路。
 *
 * 用法：node make-bangboo.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const D = path.dirname(fileURLToPath(import.meta.url));
const SRC = 'https://upload-bbs.mihoyo.com/upload/2022/08/11/277549521/2211081d60ca4e2518defaf265b2da02_1974662815705877667.jpg';
const OUTDIR = path.join(D, 'assets', 'bangboo');

// 官方设定图里的版面：3 列 × 5 行，内容包围盒（左上角为参照）
const BOX = { minX: 79, minY: 67, maxX: 1046, maxY: 1703 };
const COLS = 3, ROWS = 5;
const OUT_H = 64;     // 输出高度（页面里实际显示约 30px，2 倍余量）

(async () => {
  const res = await fetch(SRC, { headers: { 'Referer': 'https://bbs.mihoyo.com/', 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error('下载官方设定图失败：HTTP ' + res.status);
  const b64 = Buffer.from(await res.arrayBuffer()).toString('base64');

  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage();
  await page.setContent('<body></body>');

  const pngs = await page.evaluate(async ({ b64, box, outH, cols, rows }) => {
    const img = new Image();
    img.src = 'data:image/jpeg;base64,' + b64;
    await img.decode();

    const bw = box.maxX - box.minX + 1, bh = box.maxY - box.minY + 1;
    const cw = bw / cols, ch = bh / rows;

    const cut = (pick) => {
      const r = Math.floor(pick / cols), c = pick % cols;
      // 只取每格上半部分，避开下一行邦布的溢出
      const pad = 22, vtrim = 0.80;
      const sw = cw - pad * 2, sh = (ch - pad * 2) * vtrim;
      const sx = box.minX + cw * c + pad, sy = box.minY + ch * r + pad;

      const t = document.createElement('canvas');
      t.width = Math.round(sw); t.height = Math.round(sh);
      const tx = t.getContext('2d');
      tx.drawImage(img, sx, sy, sw, sh, 0, 0, t.width, t.height);

      // 白底 → 透明
      const d = tx.getImageData(0, 0, t.width, t.height), dd = d.data;
      for (let i = 0; i < dd.length; i += 4) {
        const r0 = dd[i], g0 = dd[i + 1], b0 = dd[i + 2];
        const mx = Math.max(r0, g0, b0), mn = Math.min(r0, g0, b0);
        if (r0 > 240 && g0 > 240 && b0 > 240) dd[i + 3] = 0;
        else if (r0 > 222 && g0 > 222 && b0 > 222 && mx - mn < 16) dd[i + 3] = Math.round(dd[i + 3] * 0.3);
      }
      tx.putImageData(d, 0, 0);

      // 裁到内容
      let mnx = t.width, mny = t.height, mxx = 0, mxy = 0;
      const d2 = tx.getImageData(0, 0, t.width, t.height).data;
      for (let j = 0; j < t.height; j++) {
        for (let i = 0; i < t.width; i++) {
          const o = (j * t.width + i) * 4;
          if (d2[o + 3] > 20) {
            if (i < mnx) mnx = i; if (i > mxx) mxx = i;
            if (j < mny) mny = j; if (j > mxy) mxy = j;
          }
        }
      }
      if (mxx < mnx) return null;
      const cw2 = mxx - mnx + 1, ch2 = mxy - mny + 1;
      const o2 = document.createElement('canvas');
      o2.width = cw2; o2.height = ch2;
      o2.getContext('2d').drawImage(t, mnx, mny, cw2, ch2, 0, 0, cw2, ch2);

      // 等比缩放到目标高度
      const sc = outH / ch2;
      const o3 = document.createElement('canvas');
      o3.width = Math.max(1, Math.round(cw2 * sc));
      o3.height = outH;
      const x3 = o3.getContext('2d');
      x3.imageSmoothingQuality = 'high';
      x3.drawImage(o2, 0, 0, o3.width, o3.height);
      return o3.toDataURL('image/png');
    };

    const out = [];
    for (let k = 0; k < cols * rows; k++) out.push(cut(k));
    return out;
  }, { b64, box: BOX, outH: OUT_H, cols: COLS, rows: ROWS });

  await browser.close();

  fs.mkdirSync(OUTDIR, { recursive: true });
  let total = 0;
  pngs.forEach((d, i) => {
    if (!d) return;
    const buf = Buffer.from(d.split(',')[1], 'base64');
    fs.writeFileSync(path.join(OUTDIR, `bb-${String(i).padStart(2, '0')}.png`), buf);
    total += buf.length;
  });
  console.log(`已生成 ${COLS * ROWS} 只邦布 → ${OUTDIR}  合计 ${(total / 1024).toFixed(1)} KB`);

  // 顺手清掉早期 AI 生成的邦布图与旧中间产物，避免两套素材混在一起
  for (const f of fs.readdirSync(OUTDIR)) {
    if (!/^bb-\d\d\.png$/.test(f)) {
      fs.unlinkSync(path.join(OUTDIR, f));
      console.log(`已清理旧素材 ${f}`);
    }
  }
})();
