/* 组装 Fairy HTML + 冒烟检查 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const D = __dirname;
const tpl = fs.readFileSync(path.join(D, 'ops-page.html'), 'utf8');
const baseCss = fs.readFileSync(path.join(D, 'base_style.css'), 'utf8');
// 绝区零主题覆盖层（置于基础样式之后生效）
const zzzCss = fs.readFileSync(path.join(D, 'zzz-theme.css'), 'utf8');
// 只取 <style> 内、占位符之后的部分作为新增样式（排除 </style>）
const extraCss = (() => {
  const m = tpl.match(/<style>([\s\S]*?)<\/style>/);
  if (!m) return '';
  return m[1].replace('/*__CSS__*/', '').replace(/<\/style>/g, '').trim() + '\n';
})();
const ops = fs.readFileSync(path.join(D, 'ops.js'), 'utf8');
const app = fs.readFileSync(path.join(D, 'ops-app.js'), 'utf8');

function guard(name, js) {
  if (/<\/script/i.test(js)) throw new Error(`${name} 含 </script 会破坏 HTML`);
  return js;
}

// 注入顺序：基础样式 → 绝区零主题 → 页面内联新增样式
// （页面内联样式若含浅色底会覆盖主题，故主题必须在其之前，必要时由主题内的 !important 或更高特异性兜底）
const css = baseCss + '\n/* ===== 绝区零主题覆盖层 ===== */\n' + zzzCss + '\n/* ===== 改造新增样式 ===== */\n' + extraCss;
// 图标：以 base64 内联，保持单文件零外链
const iconB64 = (f) => 'data:image/png;base64,' + fs.readFileSync(path.join(D, 'assets', f)).toString('base64');
const faviconUri = iconB64('favicon-64.png');
const logoUri = iconB64('logo-96.png');

// 背景图（暮色）：压缩后约 100KB，内联保持单文件零外链。缺失时留空，CSS 会回退到纯黑底
const bgPath = path.join(D, 'assets', 'bg', 'dusk.jpg');
const bgUri = fs.existsSync(bgPath)
  ? 'data:image/jpeg;base64,' + fs.readFileSync(bgPath).toString('base64')
  : '';

/* 皮肤：分两个构建产物
 *   发行版（默认）      → 交付/Fairy.html          内置皮肤为空串，只保留接口
 *   本地版（--skin）    → 交付/Fairy_本地版.html   把官方素材内联进去，开箱即是该皮肤
 * 之所以分文件而不是运行时读盘：网页版是单文件、零外链，必须把图 base64 内联；
 * 而内联的第三方素材不能随发行版分发，只能单独出一份自用。 */
const withSkin = process.argv.includes('--skin');
const skinPath = path.join(D, 'assets', 'skin', 'sunbringer.jpg');
const skinUri = (withSkin && fs.existsSync(skinPath))
  ? 'data:image/jpeg;base64,' + fs.readFileSync(skinPath).toString('base64')
  : '';

// 计划表提示词原文：注入成 JS 字符串，供页面「复制提示词」按钮一键复制。
// 必须转义 </ 否则正文里若出现 </script> 会提前闭合脚本块。
const _P = require('./paths.js');
const promptJson = fs.existsSync(_P.PROMPT_MD)
  ? JSON.stringify(fs.readFileSync(_P.PROMPT_MD, 'utf8')).replace(/<\//g, '<\\/')
  : '""';

// 官方邦布：15 只一套（米哈游官方美术的邦布设定图），按 bb-00…bb-14 顺序注入。
// 「每日一览」的 7 个日期格各用一只，切周自动换一批。
// 素材由 make-bangboo.mjs 生成（playwright + canvas 去白底），这里是只读地把它们内联进去。
// --nobangboo 可以让发行版退回零第三方素材（只留矢量剪影），默认带上：
// 邦布是 UI 小图标不是背景皮肤，官方形象才是这个「绝区零味」的本体。
const noBangboo = process.argv.includes('--nobangboo');
const bbDir = path.join(D, 'assets', 'bangboo');
const bangboos = (!noBangboo && fs.existsSync(bbDir))
  ? fs.readdirSync(bbDir)
    .filter(f => /^bb-\d\d\.png$/.test(f))
    .sort()
    .map(f => 'data:image/png;base64,' + fs.readFileSync(path.join(bbDir, f)).toString('base64'))
  : [];

let html = tpl
  .replace('/*__CSS__*/', () => css)
  .replace('/*__OPS__*/', () => guard('ops.js', ops))
  .replace('/*__APP__*/', () => guard('ops-app.js', app))
  .replace('/*__FAVICON__*/', () => faviconUri)
  .replace('/*__LOGO__*/', () => logoUri)
  // 两个图片占位符现在都落在 JS 字符串里，必须用 JSON 形式注入（带引号）
  .replace(/__BG_DATA__/g, () => JSON.stringify(bgUri))
  .replace(/__SKIN_DATA__/g, () => JSON.stringify(skinUri))
  .replace(/__BANGBOO_DATA__/g, () => JSON.stringify(bangboos))
  .replace(/__PROMPT_JSON__/g, () => promptJson);

const P = require('./paths.js');
const outFile = withSkin ? P.APP_HTML_LOCAL : P.APP_HTML;
fs.writeFileSync(outFile, html, 'utf8');
console.log(`已生成 ${outFile}  (${(html.length / 1024).toFixed(1)} KB)${withSkin ? '  [本地版 · 含内置皮肤]' : '  [发行版 · 无皮肤图]'}`);

/* ---------- 冒烟检查 ---------- */
let fail = 0;
const ck = (n, c, x = '') => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n} ${x}`); if (!c) fail++; };

ck('无未替换占位符', !/__[A-Z]+__/.test(html));
ck('DOCTYPE 正确', html.startsWith('<!DOCTYPE html>'));
ck('闭合 </html>', html.trim().endsWith('</html>'));
ck('viewport 已设置', /name="viewport"/.test(html));

// 零外链
const ext = html.match(/(src|href)\s*=\s*["']https?:[^"']*["']/gi) || [];
ck('无外部 src/href 链接', ext.length === 0, ext.join(','));
ck('无 jsdelivr/CDN 关键词', !/jsdelivr|cdnjs|unpkg/i.test(html));
ck('无 ES import 外部依赖', !/\bimport\s+.*from\s+['"]/.test(html));
ck('图标为内联 SVG', (html.match(/<svg/g) || []).length >= 5, `${(html.match(/<svg/g) || []).length} 个`);
ck('无 emoji 图标', !/[\u{1F300}-\u{1FAFF}]/u.test(html));

// DOM 引用完整性：静态 body 的 id + JS 运行时动态生成的 id
const bodyOnly = html.replace(/<script[\s\S]*?<\/script>/g, '');
const foundIds = new Set([...bodyOnly.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
// 运行时动态创建的 id（写在 app.js 的 innerHTML 里）
for (const m of app.matchAll(/\bid="([^"]+)"/g)) foundIds.add(m[1]);
for (const m of app.matchAll(/id="([^"]+)"/g)) foundIds.add(m[1]);
const usedIds = new Set([...app.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]));
const missing = [...usedIds].filter(i => !foundIds.has(i));
ck('app.js 引用的 DOM id 全部存在', missing.length === 0, missing.join(','));
const dupIds = (() => {
  const all = [...bodyOnly.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  return all.filter((v, i) => all.indexOf(v) !== i);
})();
ck('页面无重复 id', dupIds.length === 0, dupIds.join(','));

// 未定义函数检测：先剥离注释与字符串再分析符号，从根上避免误报
const { findUndefinedCalls, findRenderCrossCalls, stripCommentsAndStrings, extractFnBody } = require('./static-check.js');
const undef = findUndefinedCalls([app, ops], ['OPS']);
ck('app.js 无未定义函数调用', undef.length === 0, undef.join(','));

// 渲染函数不互调（铁律9）
// 渲染函数互调检测（剥离注释后按函数体边界分析，不用字符串切割）
const strippedApp = stripCommentsAndStrings(app);
const renderFns = [...strippedApp.matchAll(/function\s+(render\w+)\s*\(/g)].map(m => m[1]);
const cycles = findRenderCrossCalls(app);
ck('渲染函数之间无互相调用', cycles.length === 0, cycles.join(';'));
ck('存在统一刷新入口 refreshAll', /function\s+refreshAll\s*\(/.test(strippedApp));

// 取 refreshAll 函数体（复用车花括号配对实现，避免切割歧义）
const rab = extractFnBody(strippedApp, 'refreshAll');
const called = renderFns.filter(f => new RegExp('(?<![.\\w$])' + f + '\\s*\\(').test(rab));
ck('refreshAll 调度全部渲染函数', called.length === renderFns.length, `${called.length}/${renderFns.length}`);

// 核心能力
ck('每天一个 sheet（导出）', /weekToSheets/.test(ops) && /每天一个 sheet/.test(html));
ck('一次导入整个文件（多周）', /parseWorkbook/.test(ops) && /weeks\.forEach|weeks\b/.test(ops));
ck('重合自动合并（按日期）', /mergeIntoState/.test(app) && /mergeDayInto/.test(ops));
ck('打卡只增不减', /oi\.done = !!\(oi\.done \|\| ni\.done\)/.test(ops));
ck('顶部作战日历就位', /id="calStrip"/.test(html) && /function renderCalStrip\(\)/.test(app));
ck('日历可收可展（周历 ⇄ 月历）', /calExpanded/.test(app) && /data-act="cal-view"/.test(app));
ck('日历点日期可切换', /data-cal/.test(app) && /setDate|S\.activeDate = iso/.test(app));
ck('周历与每日一览共用同一只邦布', /function bangbooForDate\(/.test(app) && /bangbooForDate\(iso/.test(app));
ck('逾期提示挪进日历', /function calOverdueMap\(/.test(app) && /cs-over/.test(app));
ck('底部不再单列日历页签', !/data-tab="calendar"/.test(html));
ck('逾期标红', /\.pn-card\.over/.test(css) && /#ff4b5c/i.test(css));
ck('逾期天数用红色徽标', /\.pn-card\.over\s+\.pn-date/.test(css));
ck('支持多文件选择', /multiple/.test(html));
ck('提供 JSON 备份导出', /btnExport/.test(html) && /exportJSON/.test(app));

// 外观 / 皮肤（发行版与本地版是同一份代码，差别只在有没有内联皮肤图）
ck('外观抽屉存在', /id="skinDrawer"/.test(html) && /function bindSkin\(\)/.test(app));
ck('可上传本地背景图', /id="skinPick"/.test(html) && /function pickSkinImage/.test(app));
ck('背景图先压缩再存', /function shrinkImage/.test(app) && /toDataURL\('image\/jpeg'/.test(app));
ck('卡片不透明度可调', /--card-a/.test(css) && /id="rCard"/.test(html));
ck('背景为独立图层（可单独做滤镜）', /class="bg-stage"/.test(html) && /--skin-img/.test(css));
ck('皮肤数据与打卡数据分开存', /SKIN_KEY = 'fairy_skin_v1'/.test(app));
ck('无皮肤时回落到默认背景', /FAIRY_BG_DEFAULT = "data:image\/jpeg/.test(html));
ck(withSkin ? '本地版已内联内置皮肤' : '发行版不含内置皮肤图片',
  withSkin ? /FAIRY_SKIN_B64 = "data:image\/jpeg/.test(html) : /FAIRY_SKIN_B64 = ""/.test(html));

// 官方邦布（每日一览每个格子一只，15 只一套轮换）
ck('邦布贴图已内联', /FAIRY_BANGBOOS = \[/.test(html) && /data:image\/png;base64/.test(html));
ck('邦布贴图数量够一周不重复', (html.match(/data:image\/png;base64/g) || []).length >= 7);
ck('每个格子用不同的邦布', /function bangbooAt\(/.test(app) && /function bangbooForDate\(/.test(app));
ck('无邦布图时回落矢量剪影', /BANGBOO_SVG/.test(app));
ck('邦布站在盘子里（贴底 + 描边提亮）', /\.ov-chip i img\{/.test(css) && /drop-shadow/.test(css));

// 计划管理
ck('有「计划管理」页', /id="planPanel"/.test(html) && /function renderPlanMgr\(\)/.test(app));
ck('计划块显示导入时间', /pm-at/.test(app) && /导入 /.test(app));
ck('可删除整份计划', /data-del-src/.test(app) && /function deletePlanSource/.test(app));
ck('可按周删除计划', /data-del-week/.test(app) && /function deleteWeekById/.test(app));
ck('周带批次标记（按导入分组）', /nw\.src = fileName/.test(ops));

// 番茄钟
ck('有「番茄钟」页', /id="pomoPanel"/.test(html) && /function renderPomo\(\)/.test(app));
ck('番茄默认 25 学习 / 5 休息', /\+p\.work \|\| 25/.test(app) && /\+p\.rest \|\| 5/.test(app));
ck('默认四科科目', /POMO_DEFAULT = \['数学', '专业课', '英语', '政治'\]/.test(app));
ck('有学习时长饼图', /function donutSvg/.test(app));
ck('番茄数据存本地', /pomo: S\.pomo/.test(app));
ck('小组件可开关/置顶/换尺寸', /pomoMiniOn/.test(html) && /pomoMiniPin/.test(html) && /data-act="mini-size"/.test(html));
ck('提供 JSON 恢复', /btnImpJson/.test(html) && /importJSON/.test(app));
ck('清空有二次确认', /confirm\(/.test(app));
ck('状态写入本地存储（含番茄数据）', /localStorage\.setItem\(LS_KEY/.test(app));
// 顶栏静态元素必须被脚本驱动，否则会永远显示初始值（曾出现 SANITY 恒为 0/0）
// 注：id 写在字符串里，需用「只剥注释」模式，否则字符串会被替换掉
const appNoComments = stripCommentsAndStrings(app, true);
const staticDriven = ['sanityFill', 'sanityTxt'];
const undriven = staticDriven.filter(id => !new RegExp("\\$\\('" + id + "'\\)").test(appNoComments));
ck('顶栏元素均被脚本驱动', undriven.length === 0, undriven.join(','));

// 移动端
ck('有移动端媒体查询', /@media\s*\(max-width:900px\)/.test(css));
ck('按钮最小40px以上', /min-height:\s*4[0-9]px/.test(css));
ck('含安全区内边距', /env\(safe-area-inset-bottom\)/.test(css) || /viewport-fit=cover/.test(html));

// CSS 完整性：style 块内不得出现 </style>，且大括号必须配平
const styleBlocks = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)];
ck('恰好一个 style 块', styleBlocks.length === 1, `${styleBlocks.length} 个`);
const cssBody = styleBlocks[0] ? styleBlocks[0][1] : '';
ck('style 块内无嵌套 </style>', !/<\/style/i.test(cssBody));
const openB = (cssBody.match(/{/g) || []).length;
const closeB = (cssBody.match(/}/g) || []).length;
ck('CSS 大括号配平', openB === closeB, `{ ${openB} vs } ${closeB}`);
ck('CSS 含 :root 变量定义', /:root\s*{/.test(cssBody));
// 裸输出的特征：变量声明出现在所有 :root 块之外（行首是 --xxx 但前面没有选择器）
const outsideRoot = cssBody.replace(/:root\s*\{[\s\S]*?\}/g, '');
const bareVar = /^\s*--[a-zA-Z]/m.test(outsideRoot);
ck('CSS 变量未脱离 :root 裸露输出', !bareVar);

// 结构完整性：CSS 绝不能变成页面上的可见文字
// 踩过的坑：替换 favicon 时正则被 SVG 里的 '>' 截断，<path> 残留在 head 里，
// 浏览器遇到未知标签会提前结束 head，整段 zzz-theme.css 就裸露成了 body 文本。
const htmlNoStyle = html.replace(/<style[\s\S]*?<\/style>/gi, '');
ck('CSS 未裸露到页面（:root 只出现在 style 块内）', !/:root\s*\{/.test(htmlNoStyle));
const headEnd = html.indexOf('</head>');
const bodyStart = html.indexOf('<body');
const headPart = headEnd > 0 ? html.slice(0, headEnd) : '';
ck('head 区无 SVG 残留标签', !/<(path|rect|circle)\b/i.test(headPart),
  (headPart.match(/<(path|rect|circle)\b/gi) || []).slice(0, 3).join(','));
ck('head 在 body 之前且都闭合', headEnd > 0 && bodyStart > headEnd);
ck('含 ZZZ 主色电光蓝', /#2b6be4/i.test(cssBody));
ck('含 ZZZ 强调明黄', /#ffe500/i.test(cssBody));
ck('含 ZZZ 纯黑底', /#0a0a0a/i.test(cssBody));
ck('顶栏 logo 为内联图片', /class="logo" src="data:image\/png;base64,/.test(html));
ck('favicon 为内联图片', /rel="icon" type="image\/png" href="data:image\/png;base64,/.test(html));
// 说明：深色主题的「浅色残留」不做文本模式扫描——base 样式里的旧浅色值会被主题层覆盖，
// 属合法中间态，文本扫描只会误报。改由 e2e 用 getComputedStyle 实测真实渲染色。

// 关键组件必须被主题定义（避免页面内联样式覆盖主题）
const needTheme = ['.pn-card', '.pn-strip', '.drop-zone', '.tlg-blk', '.week-card', '.ov-chip', '.score-row', '.btn', '.panel', '.tabbar', '.cal-c', '.pm-card', '.pm-week', '.pomo-chip', '.pomo-mini', '.pomo-ring-wrap', '.bg-stage', '.bg-img', '.bg-shade', '.skin-drawer', '.sd-range'];
const missingTheme = needTheme.filter(sel => !new RegExp(sel.replace('.', '\\.') + '\\s*[,{]').test(zzzCss));
ck('关键组件在主题中均有定义', missingTheme.length === 0, missingTheme.join(','));

// 语法
try {
  execSync(`node --check "${path.join(D, 'ops.js')}"`, { stdio: 'pipe' });
  execSync(`node --check "${path.join(D, 'ops-app.js')}"`, { stdio: 'pipe' });
  ck('JS 语法检查通过', true);
} catch (e) {
  ck('JS 语法检查通过', false, e.stderr.toString().slice(0, 300));
}

console.log(fail === 0 ? '\n构建 + 冒烟检查全部通过 ✓' : `\n${fail} 项失败 ✗`);
process.exit(fail === 0 ? 0 : 1);