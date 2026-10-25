/* 验证桌面版的置顶小窗：preload 桥、开窗、alwaysOnTop、跨窗同步 */
import { _electron as electron } from 'playwright';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const P = require('./paths.js');

const CLEAN_ENV = { ...process.env };
delete CLEAN_ENV.ELECTRON_RUN_AS_NODE;
delete CLEAN_ENV.NODE_OPTIONS;
const PROFILE = P.OUT_DIR + '/.tmpdesk-mini-' + Date.now();

let fail = 0;
const ck = (n, c, x = '') => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n} ${x}`); if (!c) fail++; };

const app = await electron.launch({
  executablePath: P.DESKTOP_EXE,
  env: CLEAN_ENV,
  args: ['--user-data-dir=' + PROFILE],
  timeout: 90000
});
const page = await app.firstWindow({ timeout: 60000 });
await page.waitForTimeout(2000);

// 1) preload 桥
ck('preload 暴露 fairyDesktop', await page.evaluate(() => !!(window.fairyDesktop && window.fairyDesktop.isDesktop)));

// 2) 开置顶小窗
const before = app.windows().length;
await page.evaluate(() => window.fairyDesktop.toggleMini(true));
await page.waitForTimeout(2200);
const after = app.windows().length;
ck('开小窗后多出一个窗口', after > before, `${before} → ${after}`);

// 3) 小窗确实是 alwaysOnTop 且加载的是 mini=1
const info = await app.evaluate(async ({ BrowserWindow }) => {
  return BrowserWindow.getAllWindows().map(w => ({
    url: w.webContents.getURL().split('/').pop(),
    onTop: w.isAlwaysOnTop(),
    frame: w.isResizable(),
    w: Math.round(w.getBounds().width)
  }));
});
console.log('  窗口信息:', JSON.stringify(info));
const mini = info.find(w => w.url.includes('mini=1'));
ck('存在 mini=1 窗口', !!mini);
ck('小窗 alwaysOnTop', !!mini && mini.onTop === true);

// 4) 小窗里只显示小组件
const miniPage = app.windows().find(p => p.url().includes('mini=1'));
if (miniPage) {
  await miniPage.waitForTimeout(800);
  const miniState = await miniPage.evaluate(() => ({
    miniMode: document.body.classList.contains('mini-mode'),
    layoutHidden: getComputedStyle(document.querySelector('.layout')).display === 'none',
    timerVisible: getComputedStyle(document.querySelector('#pomoMini')).display !== 'none',
    time: (document.querySelector('#miniTime') || {}).textContent
  }));
  console.log('  小窗内容:', JSON.stringify(miniState));
  ck('小窗进入 mini-mode', miniState.miniMode);
  ck('小窗隐藏主界面', miniState.layoutHidden);
  ck('小窗显示计时器', miniState.timerVisible);
}

// 5) 关窗
await page.evaluate(() => window.fairyDesktop.toggleMini(false));
await page.waitForTimeout(1200);
ck('关小窗后回到单窗口', app.windows().length === before, `${app.windows().length}`);

await app.close();
console.log(fail === 0 ? '\n置顶小窗验证全部通过 ✓' : `\n${fail} 项失败 ✗`);
process.exit(fail === 0 ? 0 : 1);
