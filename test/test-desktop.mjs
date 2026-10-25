import { _electron as electron } from 'playwright';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const P = require('./paths.js');
const EXE = P.DESKTOP_EXE;
// 终端环境预置了 ELECTRON_RUN_AS_NODE / NODE_OPTIONS，会让应用退化成 Node 进程；启动前清掉
const CLEAN_ENV = { ...process.env };
delete CLEAN_ENV.ELECTRON_RUN_AS_NODE;
delete CLEAN_ENV.NODE_OPTIONS;
// 每次用全新的配置目录，避免上一轮的数据影响断言（也避免污染真实用户数据）
const PROFILE = P.OUT_DIR + '/.tmpdesk-' + Date.now();
const app = await electron.launch({ executablePath: EXE, env: CLEAN_ENV, args: ['--user-data-dir=' + PROFILE], timeout: 90000 });
const page = await app.firstWindow({ timeout: 60000 });
const errs = [];
page.on('pageerror', e => errs.push(e.message));

let fail = 0;
const ck = (n, c, x = '') => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n} ${x}`); if (!c) fail++; };

await page.waitForTimeout(1500);
ck('窗口已打开', !!page);

const info0 = await app.evaluate(async ({ app }) => ({
  name: app.getName(),
  userData: app.getPath('userData')
}));
ck('窗口标题为 Fairy', (await page.title()).startsWith('Fairy'), await page.title());
ck('应用名 = Fairy（任务栏/用户目录）', info0.name === 'Fairy', info0.name);
ck('应用已渲染（有空状态引导）', await page.locator('#emptyState').count() > 0);
ck('无 JS 报错', errs.length === 0, errs.slice(0, 2).join('|'));

// 真实导入
await page.setInputFiles('#fileInput', P.DEMO_XLSX);
await page.waitForFunction(() => document.querySelectorAll('.tlg-blk').length > 0, { timeout: 30000 });
await page.waitForTimeout(800);
ck('导入后时间轴渲染', await page.locator('.tlg-blk').count() > 0, (await page.locator('.tlg-blk').count()) + ' 块');

// 示例里冲突放在 10/18，导入后默认停在「今天」，先切过去再断言布局
await page.evaluate(() => {
  const c = [...document.querySelectorAll('.ov-chip')].find(x => x.textContent.includes('10月18日'));
  if (c) c.click();
});
await page.waitForTimeout(700);
ck('切到 10/18 后时间轴有内容', await page.locator('.tlg-blk').count() > 0, (await page.locator('.tlg-blk').count()) + ' 块');
ck('叠行块存在（同时段合并）', await page.locator('.tlg-blk.stack').count() > 0);
ck('存在并排列（部分重叠分列）', await page.locator('.tlg-blk').evaluateAll(els => {
  const body = document.querySelector('.tlg-body');
  if (!body) return false;
  const W = body.getBoundingClientRect().width;
  return els.some(e => e.getBoundingClientRect().width < W * 0.6);
}));

// 打卡 + 持久化（关闭重开）
await page.locator('.tlb-row').first().click();
await page.waitForTimeout(500);
const doneBefore = await page.locator('.tlb-row.done').count();
ck('打卡生效', doneBefore > 0, String(doneBefore));

const info = await app.evaluate(async ({ app }) => ({
  userData: app.getPath('userData'),
  version: app.getVersion(),
  name: app.getName()
}));
ck('用户数据目录已建立', !!info.userData, info.userData);

await page.screenshot({ path: 'desktop_app.png' });
await app.close();

// 重新启动，确认数据还在（localStorage 持久化）
const app2 = await electron.launch({ executablePath: EXE, env: CLEAN_ENV, args: ['--user-data-dir=' + PROFILE], timeout: 90000 });
const page2 = await app2.firstWindow({ timeout: 60000 });
await page2.waitForTimeout(2000);
// 重开后默认停在「今天」，先切回打卡那天（10/18）再数
await page2.evaluate(() => {
  const c = [...document.querySelectorAll('.ov-chip')].find(x => x.textContent.includes('10月18日'));
  if (c) c.click();
});
await page2.waitForTimeout(700);
const persisted = await page2.locator('.tlb-row.done').count();
ck('重开应用后打卡仍在', persisted === doneBefore, `${persisted} vs ${doneBefore}`);
await app2.close();

console.log(fail === 0 ? '\n桌面版验证全部通过 ✓' : `\n${fail} 项失败 ✗`);
process.exit(fail === 0 ? 0 : 1);
