/*
 * 生成项目文档用的界面截图（10 张，2x 高清）。
 * 覆盖：作战总览 → 作战日历（周历/月历）→ 时间轴 → 每日一览 → 目标 → 统计 → 计划管理 → 番茄钟 → 移动端
 *
 * 数据来自真实的 10 周计划文件，勾选也是真点出来的，不是伪造的进度条。
 */
import { chromium } from 'playwright';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const P = require('./paths.js');
const SRC = 'C:/Users/25892/DoubaoWork/chats/2026-09-19/new-chat-2/arknights-plan-console/考研计划_10月11日-10月17日';
const OUT = process.env.SHOT_OUT || path.join(P.CONTEST, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const files = fs.readdirSync(SRC).filter(f => f.endsWith('.xlsx')).map(f => path.join(SRC, f));

const b = await chromium.launch({ channel: 'msedge' });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();

await p.goto(P.APP_URL);
await p.waitForTimeout(500);
await p.setInputFiles('#fileInput', files);
await p.waitForFunction(() => document.querySelectorAll('#weekList .week-card').length >= 10, { timeout: 60000 });
await p.waitForTimeout(2500);

const btnToday = p.locator('#btnToday');
if (await btnToday.count()) { await btnToday.click(); await p.waitForTimeout(500); }

// 真勾几条今日任务，让完成率 / 统计有真实数据
const tlCount = await p.locator('#dayPanel .tlg-blk .tlb-row').count();
for (let i = 0; i < Math.min(6, tlCount); i += 2) {
  const el = p.locator('#dayPanel .tlg-blk .tlb-row').nth(i);
  if (await el.count()) { await el.click(); await p.waitForTimeout(120); }
}
const goal1 = p.locator('#goalPanel .goal-row').nth(0);
if (await goal1.count()) { await goal1.click(); await p.waitForTimeout(200); }
const score1 = p.locator('#scorePanel .score-row').nth(0);
if (await score1.count()) { await score1.click(); await p.waitForTimeout(200); }
if (await btnToday.count()) { await btnToday.click(); await p.waitForTimeout(500); }
await p.waitForTimeout(700);

const shot = async (name, locator) => {
  if (locator) {
    await locator.scrollIntoViewIfNeeded();
    await p.waitForTimeout(450);
    await locator.screenshot({ path: path.join(OUT, name) });
  } else {
    await p.waitForTimeout(450);
    await p.screenshot({ path: path.join(OUT, name) });
  }
  console.log('  ✓', name);
};

// 1 首页作战总览
await p.evaluate(() => window.scrollTo(0, 0));
await p.waitForTimeout(500);
await shot('01-首页作战总览.png');

// 2 作战日历 · 周历
await shot('02-作战日历-周历.png', p.locator('#calStrip'));

// 3 作战日历 · 月历
await p.click('#calStrip [data-act="cal-view"]');
await p.waitForTimeout(600);
await shot('03-作战日历-月历.png', p.locator('#calStrip'));
await p.click('#calStrip [data-act="cal-view"]');
await p.waitForTimeout(500);

// 4 每日时间轴
await shot('04-每日时间轴-可勾选.png', p.locator('#dayPanel'));

// 5 本周每日一览（官方邦布）
await shot('05-本周每日一览-官方邦布.png', p.locator('#overviewPanel'));

// 6 目标面板
await shot('06-四科冲分与本周目标.png', p.locator('.col-side'));

// 7 统计页
await p.click('.tab[data-tab="stats"]');
await p.waitForTimeout(900);
await p.evaluate(() => window.scrollTo(0, 0));
await p.waitForTimeout(400);
await shot('07-统计与完成率.png', p.locator('#statPanel'));

// 8 计划管理
await p.click('.tab[data-tab="plan"]');
await p.waitForTimeout(900);
await shot('08-计划管理.png', p.locator('#planPanel'));

// 9 番茄钟
await p.click('.tab[data-tab="pomo"]');
await p.waitForTimeout(900);
await shot('09-番茄钟.png', p.locator('#pomoPanel'));

// 10 移动端
await p.click('.tab[data-tab="today"]');
await p.waitForTimeout(700);
const mctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const mp = await mctx.newPage();
await mp.goto(P.APP_URL);
await mp.waitForTimeout(1500);
await mp.screenshot({ path: path.join(OUT, '10-移动端-底部导航.png') });
console.log('  ✓ 10-移动端-底部导航.png');

await b.close();
console.log('截图输出到', OUT);
