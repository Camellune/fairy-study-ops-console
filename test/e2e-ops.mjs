/* 真实浏览器端到端测试：导入多文件 → 合并 → 打卡 → 导出 → 持久化 */
import { chromium } from 'playwright';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const P = require('./paths.js');
import fs from 'fs';
import path from 'path';

const SRC = 'C:/Users/25892/DoubaoWork/chats/2026-09-19/new-chat-2/arknights-plan-console/考研计划_10月11日-10月17日';
const files = fs.readdirSync(SRC).filter(f => f.endsWith('.xlsx')).map(f => path.join(SRC, f));
const OUT = P.OUT_DIR;  // 测试产物统一放 开发/_build/out
fs.mkdirSync(OUT, { recursive: true });

let fail = 0;
const ck = (n, c, x = '') => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n} ${x}`); if (!c) fail++; };

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));

await page.goto(P.APP_URL);
await page.waitForTimeout(700);

console.log(`待导入 ${files.length} 个文件\n`);

// 空状态
ck('首屏显示空状态引导', await page.locator('#emptyState:not([hidden])').count() === 1);
ck('空状态有导入按钮', await page.locator('#emptyState [data-act="import"]').count() === 1);

// 导入全部 10 个文件
await page.setInputFiles('#fileInput', files);
await page.waitForFunction(() => {
  const t = document.getElementById('nsHint');
  return t && t.textContent.includes('作战计划');
}, { timeout: 60000 }).catch(() => { });
await page.waitForTimeout(2500);

const weekCards = await page.locator('#weekList .week-card').count();
ck('导入后周列表 = 10 周', weekCards === 10, `${weekCards} 周`);
const srcRows = await page.locator('#sourceList .src-row').count();
ck('来源列表 = 10 个文件', srcRows === 10, `${srcRows} 行`);

// 主区域渲染
ck('主控制台已显示', await page.locator('#console:not([hidden])').count() === 1);
ck('周横幅已渲染', (await page.locator('#weekBanner h2').textContent() || '').includes('周'));
ck('每日一览有 7 个 chip', await page.locator('#overviewPanel .ov-chip').count() === 7);
ck('四科冲分目标 4 行', await page.locator('#scorePanel .score-row').count() === 4);
ck('本周各科目标 4 行', await page.locator('#goalPanel .goal-row').count() === 4);
const tlN = await page.locator('#dayPanel .tlg-blk .tlb-row').count();
ck('今日时间轴有条目', tlN > 0, `${tlN} 条`);

// 顶部作战日历（周历收起态）
ck('顶部是作战日历而不是「今天要处理」', await page.locator('#calStrip').count() === 1 && await page.locator('#pendingPanel').count() === 0);
ck('周历有 7 个日期胶囊', await page.locator('#calStrip .cs-d').count() === 7);
ck('周历每个胶囊都有邦布', await page.locator('#calStrip .cs-bb img').count() === 7);
ck('每个胶囊带完成度条', await page.locator('#calStrip .cs-d .cs-bar').count() === 7);
ck('底部不再有日历页签', await page.locator('.tab[data-tab="calendar"]').count() === 0);

// 打卡交互
const beforeDone = await page.locator('#dayPanel .tlg-blk .tlb-row.done').count();
await page.locator('#dayPanel .tlg-blk .tlb-row').first().click();
await page.waitForTimeout(350);
const afterDone = await page.locator('#dayPanel .tlg-blk .tlb-row.done').count();
ck('点击时间轴条目切换完成', Math.abs(afterDone - beforeDone) === 1, `${beforeDone} -> ${afterDone}`);

// localStorage 持久化
const ls = await page.evaluate(() => {
  const p = JSON.parse(localStorage.getItem('arknights_kaoyan_ops_v2'));
  return { weeks: p.weeks.length, sources: p.sources.length, done: p.weeks.some(w => w.days.some(d => d.items.some(i => i.done))) };
});
ck('localStorage 持久化 10 周', ls.weeks === 10, `${ls.weeks} 周`);
ck('打卡已写入 localStorage', ls.done);

// 日历：展开成月历 → 点某天 → 切到那天
await page.click('#calStrip [data-act="cal-view"]');
await page.waitForTimeout(350);
ck('可展开成月历', await page.locator('#calStrip .cal-c').count() >= 28);
const calBefore = await page.locator('#dateNav .date-main').textContent();
await page.locator('#calStrip .cal-c:not(.empty)').nth(3).click();
await page.waitForTimeout(450);
const calAfter = await page.locator('#dateNav .date-main').textContent();
ck('点月历某天可切换日期', calBefore !== calAfter, `${calBefore.trim().slice(0, 8)} -> ${calAfter.trim().slice(0, 8)}`);
await page.click('#calStrip [data-act="cal-view"]');
await page.waitForTimeout(300);
ck('可收成周历', await page.locator('#calStrip .cs-d').count() === 7);

// 切换周
await page.locator('#weekList .week-card').nth(3).click();
await page.waitForTimeout(400);
ck('切换周生效', await page.locator('#weekList .week-card.active').count() === 1);

// 重复导入同一批 → 不应膨胀，且打卡保留
const daysBefore = await page.evaluate(() => {
  const p = JSON.parse(localStorage.getItem('arknights_kaoyan_ops_v2'));
  return p.weeks.reduce((s, w) => s + w.days.length, 0);
});
const itemsBefore = await page.evaluate(() => {
  const p = JSON.parse(localStorage.getItem('arknights_kaoyan_ops_v2'));
  return p.weeks.reduce((s, w) => s + w.days.reduce((x, d) => x + d.items.length, 0), 0);
});
await page.setInputFiles('#fileInput', files);
await page.waitForTimeout(3000);
const daysAfter = await page.evaluate(() => {
  const p = JSON.parse(localStorage.getItem('arknights_kaoyan_ops_v2'));
  return p.weeks.reduce((s, w) => s + w.days.length, 0);
});
const itemsAfter = await page.evaluate(() => {
  const p = JSON.parse(localStorage.getItem('arknights_kaoyan_ops_v2'));
  return p.weeks.reduce((s, w) => s + w.days.reduce((x, d) => x + d.items.length, 0), 0);
});
ck('重复导入天数不膨胀', daysBefore === daysAfter, `${daysBefore} -> ${daysAfter}`);
ck('重复导入条目不膨胀', itemsBefore === itemsAfter, `${itemsBefore} -> ${itemsAfter}`);
const stillDone = await page.evaluate(() => {
  const p = JSON.parse(localStorage.getItem('arknights_kaoyan_ops_v2'));
  return p.weeks.some(w => w.days.some(d => d.items.some(i => i.done)));
});
ck('重复导入后打卡仍保留', stillDone);

// 导出 xlsx（全部）——先挂监听再点击
const dlPromise = page.waitForEvent('download', { timeout: 30000 });
await page.locator('#btnExportXlsx').click();
const dl = await dlPromise;
const expPath = path.join(OUT, 'ops_browser_export.xlsx');
await dl.saveAs(expPath);
const size = fs.statSync(expPath).size;
ck('导出 xlsx 成功', size > 100000, `${(size / 1024).toFixed(0)} KB, ${dl.suggestedFilename()}`);

// 导出本周
const dl2Promise = page.waitForEvent('download', { timeout: 30000 });
await page.locator('#btnExportWeek').click();
const dl2 = await dl2Promise;
await dl2.saveAs(path.join(OUT, 'ops_week_export.xlsx'));
ck('导出本周 xlsx 成功', fs.statSync(path.join(OUT, 'ops_week_export.xlsx')).size > 20000);

// 导出 JSON 备份
const dl3Promise = page.waitForEvent('download', { timeout: 20000 });
await page.locator('#btnExport').click();
const dl3 = await dl3Promise;
await dl3.saveAs(path.join(OUT, 'ops_backup.json'));
const bk = JSON.parse(fs.readFileSync(path.join(OUT, 'ops_backup.json'), 'utf8'));
ck('导出 JSON 备份含 10 周', bk.weeks.length === 10, `${bk.weeks.length}`);

// 截图
await page.locator('#weekList .week-card').nth(5).click();
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(OUT, 'ops_desktop.png'), fullPage: false });

// 移动端：检查横向溢出
const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
await m.goto(P.APP_URL);
await m.waitForTimeout(600);
await m.setInputFiles('#fileInput', files);
await m.waitForTimeout(3500);
const overflow = await m.evaluate(() => {
  const de = document.documentElement;
  const wide = [];
  document.querySelectorAll('body *').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > window.innerWidth + 2) {
      const cs = getComputedStyle(el);
      if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') return;  // 允许横向滚动的容器
      // className 对 SVG 元素是 SVGAnimatedString 对象，需转成可读字符串
      const cn = typeof el.className === 'string' ? el.className : (el.className.baseVal || '');
      wide.push(cn || el.tagName.toLowerCase());
    }
  });
  return { scrollW: de.scrollWidth, clientW: de.clientWidth, wide: [...new Set(wide)].slice(0, 6) };
});
ck('移动端无横向溢出', overflow.scrollW <= overflow.clientW + 2, `scrollW=${overflow.scrollW} clientW=${overflow.clientW} 溢出元素=${overflow.wide.join(',')}`);

// 关键区块不得互相重叠（topbar 与实时条、实时条与主内容）
const overlap = await m.evaluate(() => {
  const rects = {};
  ['.topbar', '.now-strip', '.layout'].forEach(sel => {
    const el = document.querySelector(sel);
    if (el) { const r = el.getBoundingClientRect(); rects[sel] = { top: r.top, bottom: r.bottom, h: r.height }; }
  });
  const bad = [];
  const keys = Object.keys(rects);
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = rects[keys[i]], b = rects[keys[j]];
      if (a && b && a.bottom > b.top + 1 && a.top < b.bottom - 1) bad.push(`${keys[i]}∩${keys[j]}`);
    }
  }
  return { bad, rects };
});
ck('移动端区块无重叠', overlap.bad.length === 0, overlap.bad.join(',') + ' | ' + JSON.stringify(overlap.rects));

await m.screenshot({ path: path.join(OUT, 'ops_mobile.png') });
await m.close();
ck('截图完成', fs.statSync(path.join(OUT, 'ops_desktop.png')).size > 10000);

/* ---- 主题实际渲染验证：用 getComputedStyle 实测，替代脆弱的 CSS 文本扫描 ---- */
const theme = await page.evaluate(() => {
  // 正确解析颜色（含 alpha）
  const parseColor = s => {
    const m = String(s).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map(x => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  // 半透明层与下层合成
  const over = (top, bot) => ({
    r: top.r * top.a + bot.r * (1 - top.a),
    g: top.g * top.a + bot.g * (1 - top.a),
    b: top.b * top.a + bot.b * (1 - top.a),
    a: 1
  });
  // 从元素向上收集背景层，按 alpha 正确合成为最终可见色
  const resolveBg = el => {
    const stack = [];
    let p = el;
    while (p) {
      const c = parseColor(getComputedStyle(p).backgroundColor);
      if (c && c.a > 0) {
        stack.push(c);
        if (c.a >= 1) break;
      }
      p = p.parentElement;
    }
    let base = { r: 10, g: 10, b: 10, a: 1 }; // 页面根底色兜底
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  };
  const lum = c => c ? (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255 : null;
  const contrast = (a, b) => {
    const L = v => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    const l1 = 0.2126 * L(a.r) + 0.7152 * L(a.g) + 0.0722 * L(a.b);
    const l2 = 0.2126 * L(b.r) + 0.7152 * L(b.g) + 0.0722 * L(b.b);
    const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  };
  const probe = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const bg = resolveBg(el);
    const fg = parseColor(cs.color);
    return {
      sel,
      bgLum: lum(bg),
      txtLum: lum(fg),
      contrast: fg ? +contrast(fg, bg).toFixed(2) : null,
      bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
      radius: cs.borderRadius,
      weight: cs.fontWeight
    };
  };
  return {
    body: probe('body'),
    panel: probe('.panel'),
    calChip: probe('#calStrip .cs-d'),
    calText: probe('#calStrip .cs-d .cs-n'),
    tlItem: probe('.tlg-blk'),
    sTag: probe('.s-tag'),
    tab: probe('.tab'),
    drop: probe('.drop-zone')
  };
});

const darkEnough = k => theme[k] && theme[k].bgLum !== null && theme[k].bgLum < 0.28;
ck('body 为深色底', darkEnough('body'), `亮度=${theme.body?.bgLum?.toFixed(3)}`);
ck('面板为深色底', darkEnough('panel'), `亮度=${theme.panel?.bgLum?.toFixed(3)}`);
ck('日历胶囊为深色底', darkEnough('calChip'), `亮度=${theme.calChip?.bgLum?.toFixed(3)}`);
ck('时间轴条目为深色底', darkEnough('tlItem'), `亮度=${theme.tlItem?.bgLum?.toFixed(3)}`);
ck('导入区为深色底', darkEnough('drop'), `亮度=${theme.drop?.bgLum?.toFixed(3)}`);
// 文字必须亮（防白底白字）
const brightEnough = k => theme[k] && theme[k].txtLum !== null && theme[k].txtLum > 0.4;
ck('日历日号为亮色', brightEnough('calText'), `亮度=${theme.calText?.txtLum?.toFixed(3)}`);
// 关键：文字与背景对比度必须够（WCAG AA 正文 4.5:1）
ck('日历日号对比度充足', theme.calText?.contrast >= 4.5, `${theme.calText?.contrast}:1`);
ck('面板文字对比度充足', theme.panel?.contrast >= 4.5, `${theme.panel?.contrast}:1`);
// 字重要够重（ZZZ 观感：正文标题级 ≥700）
ck('日历日号字重够厚（≥700）', parseInt(theme.calText?.weight) >= 700, 'weight=' + theme.calText?.weight);
ck('Tab 导航已渲染', !!theme.tab, theme.tab ? `bg亮度=${theme.tab.bgLum?.toFixed(3)}` : '未找到');

ck('无 JS 运行时错误', errs.length === 0, errs.slice(0, 3).join(' | '));

await browser.close();
console.log(fail === 0 ? '\n端到端全部通过 ✓' : `\n${fail} 项失败 ✗`);
process.exit(fail === 0 ? 0 : 1);