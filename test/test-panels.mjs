/* 计划管理 + 番茄钟 的端到端测试（真实 Edge） */
import { chromium } from 'playwright';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
const P = require('./paths.js');

const OUT = P.OUT_DIR;
fs.mkdirSync(OUT, { recursive: true });

let fail = 0;
const ck = (n, c, x = '') => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n} ${x}`); if (!c) fail++; };

const b = await chromium.launch({ channel: 'msedge' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
page.on('dialog', d => d.accept());     // 确认框一律同意

const clickTab = async (name) => {
  await page.evaluate(n => document.querySelector('.tab[data-tab="' + n + '"]').click(), name);
  await page.waitForTimeout(450);
};

await page.goto(P.APP_URL);
await page.waitForTimeout(500);
await page.setInputFiles('#fileInput', P.SAMPLE_XLSX);
await page.waitForFunction(() => document.querySelectorAll('.tlg-blk').length > 0, { timeout: 30000 });
await page.waitForTimeout(1000);

/* ---------------- 计划管理 ---------------- */
await clickTab('plan');
ck('计划管理：出现在计划块', await page.locator('.pm-card').count() === 1, (await page.locator('.pm-card').count()) + ' 块');

const cardText = await page.locator('.pm-card').first().innerText();
ck('块上显示计划时间', /10月18日\s*-\s*10月24日/.test(cardText), cardText.split('\n')[0]);
ck('块上显示天数', /1\s*周\s*·\s*7\s*天/.test(cardText.replace(/\n/g, ' ').replace(/\s+/g, ' ')));
ck('块上显示导入时间', /导入\s*\d{2}-\d{2}\s+\d{2}:\d{2}/.test(cardText));
ck('块右上角有删除按钮', await page.locator('.pm-card .pm-del').count() === 1);

await page.locator('.pm-card').first().click();
await page.waitForTimeout(400);
ck('点击块展开周列表', await page.locator('#planDetail .pm-week').count() === 1,
  (await page.locator('#planDetail .pm-week').count()) + ' 周');
const wkText = await page.locator('#planDetail .pm-week').first().innerText();
ck('周行显示日期范围', /10月18日\s*-\s*10月24日/.test(wkText.replace(/\n/g, ' ')));
ck('周行有「删除这周」', await page.locator('[data-del-week]').count() === 1);

// 返回主页
await page.locator('[data-act="home"]').click();
await page.waitForTimeout(400);
ck('返回主页回到作战视图', await page.evaluate(() => document.querySelector('.tab[data-tab="today"]').classList.contains('on')));

/* ---------------- 番茄钟：计时 / 暂停 ---------------- */
await clickTab('pomo');
ck('番茄页默认 25:00', (await page.locator('#pomoTime').textContent()).trim() === '25:00');
ck('默认四个科目', await page.locator('[data-pomo-subj]').count() === 4,
  (await page.locator('[data-pomo-subj]').allInnerTexts()).join('/'));

await page.locator('#pomoStart').click();
await page.waitForTimeout(2100);
const t1 = (await page.locator('#pomoTime').textContent()).trim();
ck('开始后倒计时在走', t1 !== '25:00', t1);
ck('按钮变成「暂停」', (await page.locator('#pomoStart').textContent()).trim() === '暂停');

await page.locator('#pomoStart').click();
await page.waitForTimeout(300);
const t2 = (await page.locator('#pomoTime').textContent()).trim();
await page.waitForTimeout(2500);
const t3 = (await page.locator('#pomoTime').textContent()).trim();
ck('暂停后时间停住', t2 === t3, `${t2} → ${t3}`);
ck('按钮变回「开始」', (await page.locator('#pomoStart').textContent()).trim() === '开始');

// 切科目
await page.locator('[data-pomo-subj="英语"]').click();
await page.waitForTimeout(300);
ck('切换科目生效', (await page.locator('#pomoSubjectTag').textContent()).trim() === '英语');

// 改时长
await page.locator('#pomoWorkMin').fill('30');
await page.locator('#pomoWorkMin').dispatchEvent('change');
await page.waitForTimeout(300);
ck('改学习时长后重置为 30:00', (await page.locator('#pomoTime').textContent()).trim() === '30:00',
  (await page.locator('#pomoTime').textContent()).trim());

/* ---------------- 小组件 ---------------- */
ck('默认不显示小组件', !(await page.locator('#pomoMini').isVisible()));
await page.locator('#pomoMiniOn').check();
await page.waitForTimeout(300);
ck('勾选后小组件出现', await page.locator('#pomoMini').isVisible());
ck('默认置顶（fixed 类）', !(await page.locator('#pomoMini').getAttribute('class')).includes('flow'),
  await page.locator('#pomoMini').getAttribute('class'));
await page.locator('#pomoMiniPin').uncheck();
await page.waitForTimeout(300);
ck('取消置顶变跟随滚动', (await page.locator('#pomoMini').getAttribute('class')).includes('flow'));
await page.locator('#pomoMiniPin').check();
await page.waitForTimeout(200);
await page.locator('[data-act="mini-size"][data-size="l"]').click();
await page.waitForTimeout(300);
ck('小组件可换尺寸', (await page.locator('#pomoMini').getAttribute('class')).includes('size-l'));

// 小组件里的开始/暂停与主计时器同步
await page.locator('#miniToggle').click();
await page.waitForTimeout(1600);
const m1 = (await page.locator('#miniTime').textContent()).trim();
ck('小组件能控制计时', m1 !== '30:00', m1);
await page.locator('#miniToggle').click();

/* ---------------- 计时自然走完：自动记录 + 饼图 ---------------- */
// 把计时器塞成「2 秒后结束」，重载后让它自己走完（不用真等 25 分钟）
await page.evaluate(() => {
  const k = 'arknights_kaoyan_ops_v2';
  const st = JSON.parse(localStorage.getItem(k));
  st.pomo = st.pomo || {};
  st.pomo.work = 1;
  st.pomo.phase = 'work';
  st.pomo.subject = '英语';
  st.pomo.left = 2;
  st.pomo.running = true;
  st.pomo.endAt = Date.now() + 2000;
  localStorage.setItem(k, JSON.stringify(st));
});
await page.reload();
await page.waitForTimeout(4500);
await clickTab('pomo');

const state1 = await page.evaluate(() => JSON.parse(localStorage.getItem('arknights_kaoyan_ops_v2')));
ck('学习记录已写入本地', Array.isArray(state1.pomo.log) && state1.pomo.log.length >= 1,
  JSON.stringify(state1.pomo.log || []));
ck('记录归属当前科目', state1.pomo.log[0].s === '英语', state1.pomo.log[0].s);
ck('阶段切到休息', state1.pomo.phase === 'rest', state1.pomo.phase);
ck('饼图已渲染', (await page.locator('#pomoChart svg').count()) === 1);

// 跳过：不足 1 分钟不应虚增统计
const logBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('arknights_kaoyan_ops_v2')).pomo.log.length);
await page.locator('#pomoReset').click();
await page.waitForTimeout(200);
await page.locator('#pomoStart').click();
await page.waitForTimeout(1200);
await page.locator('#pomoSkip').click();
await page.waitForTimeout(400);
const logAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('arknights_kaoyan_ops_v2')).pomo.log.length);
ck('跳过不足 1 分钟不虚增统计', logAfter === logBefore, `${logBefore} → ${logAfter}`);
const legend = await page.locator('#pomoLegend').innerText();
ck('图例显示累计时长', /累计/.test(legend), legend.replace(/\n/g, ' ').slice(0, 60));

/* ---------------- 刷新后番茄数据还在 ---------------- */
await page.reload();
await page.waitForTimeout(1200);
await clickTab('pomo');
const legend2 = await page.locator('#pomoLegend').innerText();
ck('刷新后统计仍在', /累计/.test(legend2) && !/0 分钟/.test(legend2.split('累计')[1] || ''), legend2.replace(/\n/g, ' ').slice(0, 40));
ck('刷新后小组件状态保留', await page.locator('#pomoMini').isVisible());

/* ---------------- 删除：整份 / 单周 ---------------- */
await clickTab('plan');
await page.locator('.pm-card').first().click();
await page.waitForTimeout(300);
await page.locator('[data-del-week]').first().click();     // 删掉唯一一周
await page.waitForTimeout(600);
ck('删除后没有计划块', (await page.locator('.pm-card').count()) === 0);
const st2 = await page.evaluate(() => JSON.parse(localStorage.getItem('arknights_kaoyan_ops_v2')));
ck('删除后周数据清空', Array.isArray(st2.weeks) && st2.weeks.length === 0, (st2.weeks || []).length + ' 周');
ck('番茄统计不随计划删除丢失', st2.pomo && st2.pomo.log.length >= 1);

// 没有计划时番茄页仍可进入
await clickTab('pomo');
ck('无计划时仍能进番茄页', await page.locator('#pomoPanel').isVisible());

console.log(errs.length ? '错误：' + errs.slice(0, 3).join(' || ') : '无 JS 错误');
ck('无 JS 运行时错误', errs.length === 0);

await page.screenshot({ path: path.join(OUT, 'panels_final.png') });
await b.close();

console.log(fail === 0 ? '\n新面板测试全部通过 ✓' : `\n${fail} 项失败 ✗`);
process.exit(fail === 0 ? 0 : 1);
