/* 外观 / 皮肤专项测试：上传背景图 → 调不透明度 → 刷新持久化 → 发行版不含内置皮肤 */
import { chromium } from 'playwright';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const P = require('./paths.js');
import fs from 'fs';
import path from 'path';

let fail = 0;
const ck = (n, c, x = '') => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n} ${x}`); if (!c) fail++; };

const SKIN_JPG = path.join(P.BUILD, 'assets', 'skin', 'sunbringer.jpg');
const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

console.log('\n[本地版] 皮肤接口');
await page.goto(P.APP_URL_LOCAL);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(700);

ck('本地版内置了皮肤图', await page.evaluate(() => !!(window.FAIRY_SKIN_B64 || '').length));

// 抽屉能开能关
await page.click('#btnSkin');
await page.waitForTimeout(420);
ck('抽屉已打开', await page.evaluate(() => document.body.classList.contains('skin-open')));
ck('抽屉滑到位', await page.evaluate(() => {
  const r = document.getElementById('skinDrawer').getBoundingClientRect();
  return Math.abs(r.right - window.innerWidth) < 4;
}));
await page.click('#skinClose');
await page.waitForTimeout(420);
ck('抽屉已关闭', await page.evaluate(() => !document.body.classList.contains('skin-open')));

// 上传自定义背景图
await page.click('#btnSkin');
await page.waitForTimeout(300);
await page.locator('#skinInput').setInputFiles(SKIN_JPG);
await page.waitForTimeout(1200);
const skinImg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--skin-img'));
ck('自定义背景图已生效', /url\("data:image\/jpeg/.test(skinImg), skinImg.slice(0, 42));
ck('背景图已写入本地存储', await page.evaluate(() => {
  const o = JSON.parse(localStorage.getItem('fairy_skin_v1') || '{}');
  return typeof o.img === 'string' && o.img.length > 1000;
}));

// 卡片不透明度
await page.$eval('#rCard', el => { el.value = 55; el.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForTimeout(250);
const cardA = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--card-a'));
ck('卡片不透明度可调', Math.abs(parseFloat(cardA) - 0.55) < 0.02, cardA.trim());
const panelBg = await page.evaluate(() => getComputedStyle(document.querySelector('.panel')).backgroundColor);
ck('面板确实变半透明', /rgba?\(/.test(panelBg) && parseFloat((panelBg.match(/[\d.]+\)$/) || ['1'])[0]) < 1, panelBg);
// 等防抖落盘（flushSkin 300ms）再刷新
await page.waitForTimeout(600);

// 刷新后仍在
await page.reload();
await page.waitForTimeout(700);
const after = await page.evaluate(() => {
  const root = getComputedStyle(document.documentElement);
  return {
    img: root.getPropertyValue('--skin-img'),
    card: root.getPropertyValue('--card-a')
  };
});
ck('刷新后背景图仍在', /data:image\/jpeg/.test(after.img));
ck('刷新后不透明度仍在', Math.abs(parseFloat(after.card) - 0.55) < 0.02, after.card.trim());

// 清除
await page.click('#btnSkin');
await page.waitForTimeout(300);
await page.click('#skinClear');
await page.waitForTimeout(300);
const cleared = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--skin-img'));
ck('清除后不再有背景图', cleared.trim() === 'none', cleared.trim());
await page.click('#skinClose');

// 皮肤设置不能污染打卡数据
const main = await page.evaluate(() => {
  const raw = localStorage.getItem('arknights_kaoyan_ops_v2');
  return raw ? Object.keys(JSON.parse(raw)) : [];
});
ck('皮肤不写进主数据（打卡独立）', main.indexOf('skin') < 0, main.join(','));

console.log('\n[发行版] 不含内置皮肤');
const page2 = await ctx.newPage();
await page2.goto(P.APP_URL);
await page2.evaluate(() => localStorage.clear());
await page2.reload();
await page2.waitForTimeout(600);
ck('发行版未内置皮肤图', await page2.evaluate(() => (window.FAIRY_SKIN_B64 || '') === ''));
await page2.click('#btnSkin');
await page2.waitForTimeout(400);
ck('「内置皮肤」按钮已置灰', await page2.evaluate(() => {
  const b = document.getElementById('skinBuiltin');
  return b.disabled === true && /无内置皮肤/.test(b.textContent);
}));
ck('发行版仍可上传自定义背景图', await page2.locator('#skinInput').count() === 1);
ck('发行版有默认背景兜底', await page2.evaluate(() => (window.FAIRY_BG_DEFAULT || '').length > 1000));

await browser.close();
ck('无 JS 运行时错误', errs.length === 0, errs.slice(0, 2).join(' | '));
console.log(fail === 0 ? '\n皮肤测试全部通过 ✓' : `\n${fail} 项失败 ✗`);
process.exit(fail === 0 ? 0 : 1);
