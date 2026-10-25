/* OPS 引擎回归测试：用 arknights-plan-console 的真实数据 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const OPS = require('./ops.js');

const SRC = 'C:/Users/25892/DoubaoWork/chats/2026-09-19/new-chat-2/arknights-plan-console/考研计划_10月11日-10月17日';
const inflateFn = (b) => new Uint8Array(zlib.inflateRawSync(Buffer.from(b)));

let fail = 0;
const ck = (n, c, x = '') => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n} ${x}`); if (!c) fail++; };

// 模拟浏览器解压路径
function parseFile(file) {
  const buf = new Uint8Array(fs.readFileSync(file));
  const entries = OPS.neededEntries(buf);
  const textMap = {};
  for (const it of entries) {
    const bytes = it.method === 0 ? it.data : new Uint8Array(zlib.inflateRawSync(Buffer.from(it.data)));
    textMap[it.name] = new TextDecoder('utf-8').decode(bytes);
  }
  const book = OPS.parseTexts(textMap);
  return OPS.parseWorkbook(book.sheets);
}

const files = fs.readdirSync(SRC).filter(f => f.endsWith('.xlsx')).sort();
console.log(`源文件 ${files.length} 个\n`);

let allWeeks = [], totalDays = 0, totalItems = 0;
for (const f of files) {
  const weeks = parseFile(path.join(SRC, f));
  const days = weeks.reduce((s, w) => s + w.days.length, 0);
  const items = weeks.reduce((s, w) => s + w.days.reduce((x, d) => x + d.items.length, 0), 0);
  allWeeks = allWeeks.concat(weeks);
  totalDays += days; totalItems += items;
  const w = weeks[0];
  console.log(`${f}`);
  console.log(`   周数=${weeks.length} 天=${days} 条目=${items} | ${w.title}`);
  console.log(`   区间=${w.startDate}~${w.endDate} | 目标=${w.scoreGoals.length} 各科目标=${w.weekGoals.length} 概览=${w.overview.length} 节点=${w.milestones.length}`);
  console.log(`   首日: ${w.days[0].date} ${OPS.weekdayOf(w.days[0].date)} | ${w.days[0].items.length} 项 | focus=${String(w.days[0].focus).slice(0, 50)}`);
}

console.log('');
ck('全部文件解析成功', allWeeks.length >= files.length, `${allWeeks.length} 周`);
ck('总天数 = 70（10 周 × 7 天）', totalDays === 70, `${totalDays}`);
ck('每文件恰好 1 周', allWeeks.length === files.length, `${allWeeks.length} 周 vs ${files.length} 文件`);
ck('每条都有内容', allWeeks.every(w => w.days.every(d => d.items.length > 0 && d.items.every(i => i.content || i.time))));
ck('周目标四科齐全', allWeeks.every(w => w.scoreGoals.length === 4), JSON.stringify(allWeeks[0].scoreGoals.map(g => g.subject)));
ck('每日一览 7 条', allWeeks.every(w => w.overview.length === 7), `${allWeeks[0].overview.length}`);
ck('关键节点非空', allWeeks.every(w => w.milestones.length > 0), `${allWeeks[0].milestones.length}`);
ck('材料建议非空', allWeeks.every(w => w.materials && w.materials.length > 20));
ck('week.id 唯一', new Set(allWeeks.map(w => w.id)).size === allWeeks.length);
ck('每组周内日期连续 7 天', allWeeks.every(w => {
  for (let i = 1; i < w.days.length; i++) {
    const a = new Date(w.days[i - 1].date), b = new Date(w.days[i].date);
    if ((b - a) / 86400000 !== 1) return false;
  }
  return true;
}), `起 ${allWeeks[0].startDate} 止 ${allWeeks[allWeeks.length - 1].endDate}`);
// 注：源数据本身在 10/31→11/1 缺一天（第7周止于10/31周日，第8周起于11/2周一），
// 这是原始计划的排期，解析器如实还原，不做填补
ck('周区间首尾与源数据一致', allWeeks[0].startDate === '2026-10-11' && allWeeks[allWeeks.length - 1].endDate === '2026-12-20',
  `${allWeeks[0].startDate} ~ ${allWeeks[allWeeks.length - 1].endDate}`);

/* ---- 合并测试：重合自动合并 ---- */
console.log('\n[合并测试]');
const state = { weeks: [] };
let rep = OPS.mergeIntoState(state, JSON.parse(JSON.stringify(allWeeks)), '全部.xlsx');
ck('首次导入：新增 10 周', rep.newWeeks === 10 && rep.mergedWeeks === 0, `新增${rep.newWeeks}`);
ck('合并后周数 = 10', state.weeks.length === 10);

// 打卡
const w0 = state.weeks[0];
w0.days[0].items[0].done = true;
w0.scoreGoals[0].done = true;
w0.overview[0].done = true;

// 重复导入同一批 → 应合并而非覆盖，且打卡保留
const itemsBefore = state.weeks[0].days[0].items.length;
const rep2 = OPS.mergeIntoState(state, JSON.parse(JSON.stringify(allWeeks)), '全部.xlsx');
ck('重复导入：合并 10 周而非新增', rep2.mergedWeeks === 10 && rep2.newWeeks === 0, `合并${rep2.mergedWeeks} 新增${rep2.newWeeks}`);
ck('重复导入：条目数不膨胀', state.weeks[0].days[0].items.length === itemsBefore, `${itemsBefore} -> ${state.weeks[0].days[0].items.length}`);
ck('重复导入：item 打卡保留', state.weeks[0].days[0].items[0].done === true);
ck('重复导入：scoreGoal 打卡保留', state.weeks[0].scoreGoals[0].done === true);
ck('重复导入：overview 打卡保留', state.weeks[0].overview[0].done === true);

// 冲突：同日同槽位内容不同 → 取更详细，且不丢打卡
const conflict = JSON.parse(JSON.stringify(allWeeks[0]));
conflict.days[0].items[0].content = '线代第6章 二次型：二次型与矩阵、标准形（修订版补充了配方法与正定判定的完整推导过程）';
const rep3 = OPS.mergeIntoState(state, [conflict], '修订.xlsx');
ck('冲突合并：同槽位内容取更详细', /完整推导过程/.test(state.weeks[0].days[0].items[0].content));
ck('冲突合并：打卡不被覆盖', state.weeks[0].days[0].items[0].done === true);

// 新增一个时段
const extra = JSON.parse(JSON.stringify(allWeeks[0]));
extra.days[0].items.push({ time: '23:00-23:30', subject: '复盘', content: '新增：睡前回忆今日公式', target: '', kind: 'study', done: false });
OPS.mergeIntoState(state, [extra], '新增.xlsx');
ck('冲突合并：新时段被追加', state.weeks[0].days[0].items.length === itemsBefore + 1, `${state.weeks[0].days[0].items.length}`);

/* ---- 导出测试：每天一个 sheet ---- */
console.log('\n[导出测试]');
const sheets = OPS.weekToSheets(state.weeks[0]);
ck('单周 sheet 数 = 1 总表 + 7 天 = 8', sheets.length === 8, `${sheets.length}`);
ck('总表名为「本周计划」', sheets[0].name === '本周计划');
const daySheet = sheets[1];
ck('每日 sheet 名为「MM-DD 周X」', /^\d{2}-\d{2} 周[一二三四五六日]$/.test(daySheet.name), daySheet.name);
const hdr = daySheet.rows[2];
ck('每日表头 5 列', hdr[0] === '时间段' && hdr[1] === '科目' && hdr[4] === '完成情况', JSON.stringify(hdr));

const allSheets = [];
state.weeks.forEach(w => OPS.weekToSheets(w).forEach(s => allSheets.push(s)));
ck('全部 sheet 数 = 10 总表 + 70 天 = 80', allSheets.length === 80, `${allSheets.length}`);

const out = OPS.buildXlsx(state.weeks);
fs.writeFileSync(path.join(__dirname, 'ops_export.xlsx'), Buffer.from(out));
ck('导出 xlsx 生成', out && out.length > 50000, `${(out.length / 1024).toFixed(0)} KB`);

// 回读
const book = OPS.parseTexts((() => {
  const buf = new Uint8Array(out);
  const entries = OPS.neededEntries(buf);
  const tm = {};
  for (const it of entries) {
    const bytes = it.method === 0 ? it.data : new Uint8Array(zlib.inflateRawSync(Buffer.from(it.data)));
    tm[it.name] = new TextDecoder('utf-8').decode(bytes);
  }
  return tm;
})());
ck('导出可回读且 sheet 数 = 80', book.sheets.length === 80, `${book.sheets.length}`);
const backDay = book.sheets.find(s => /^\d{2}-\d{2} /.test(s.name));
ck('回读：每日 sheet 内容正确', backDay && backDay.rows[2] && backDay.rows[2][0] === '时间段');
const marked = book.sheets.some(s => s.rows.some(r => r[4] === '√'));
ck('回读：√ 打卡标记已写回', marked);


/* ================= 需求1：时间轴布局 ================= */
console.log('\n--- 时间轴布局 ---');
{
  // 无冲突：占满整行
  const L1 = OPS.layoutDay([
    { time: '08:00-10:00', subject: '数学' },
    { time: '10:00-11:00', subject: '英语' }
  ]);
  ck('无冲突：每块独占 1 列', L1.blocks.every(b => b.lanes === 1), L1.blocks.map(b => b.lanes).join(','));
  ck('无冲突：宽度为整行', L1.blocks.every(b => b.lane === 0));
  ck('高度按时长：120 分钟块', L1.blocks[0].dur === 120 && L1.blocks[1].dur === 60);

  // 部分重叠（用户给的例子）
  const L2 = OPS.layoutDay([
    { time: '10:10-10:30', subject: '事件1' },
    { time: '10:20-10:30', subject: '事件2' }
  ]);
  ck('部分重叠：分成 2 列', L2.blocks.every(b => b.lanes === 2), L2.blocks.map(b => b.lanes).join(','));
  ck('部分重叠：两块不同列', L2.blocks[0].lane === 0 && L2.blocks[1].lane === 1);
  ck('部分重叠：宽度各占一半', L2.blocks[0].dur === 20 && L2.blocks[1].dur === 10);

  // 起止完全相同 → 合并成一块，块内叠 2 行
  const L3 = OPS.layoutDay([
    { time: '08:00-10:00', subject: '数学' },
    { time: '08:00-10:00', subject: '专业课' }
  ]);
  ck('同时段：合成 1 块', L3.blocks.length === 1, `${L3.blocks.length} 块`);
  ck('同时段：块内 2 行', L3.blocks[0].stack === 2);
  ck('同时段：不拆列（仍占整行）', L3.blocks[0].lanes === 1);
  ck('同时段：高度 = 完整时长', L3.blocks[0].dur === 120);

  // 四路并行
  const L4 = OPS.layoutDay([
    { time: '08:00-10:00', subject: 'A' },
    { time: '08:10-10:00', subject: 'B' },
    { time: '08:20-10:00', subject: 'C' },
    { time: '08:30-10:00', subject: 'D' }
  ]);
  ck('四路并行：4 列', L4.blocks.every(b => b.lanes === 4), L4.blocks.map(b => b.lanes).join(','));
  ck('四路并行：列号各不相同', new Set(L4.blocks.map(b => b.lane)).size === 4);

  // 五路并行：仍最多 4 列，多出来的标记 overflow 不丢数据
  const L5 = OPS.layoutDay([
    { time: '08:00-10:00', subject: 'A' },
    { time: '08:05-10:00', subject: 'B' },
    { time: '08:10-10:00', subject: 'C' },
    { time: '08:15-10:00', subject: 'D' },
    { time: '08:20-10:00', subject: 'E' }
  ]);
  ck('超过 4 路：列数仍为 4', L5.blocks.every(b => b.lanes === 4));
  ck('超过 4 路：多出的块被标 overflow', L5.blocks.some(b => b.overflow));
  ck('超过 4 路：数据不丢', L5.blocks.reduce((s, b) => s + b.stack, 0) === 5);

  // 时间窗与容错
  const L6 = OPS.layoutDay([
    { time: '07:00-07:30', subject: '生活' },
    { time: '随便写', subject: '英语' },
    { time: '10:00-09:00', subject: '数学' }
  ]);
  ck('时间窗取整到整点', L6.startHour === 7 && L6.endHour === 11, `${L6.startHour}-${L6.endHour}`);
  ck('无法解析时间的条目被单独收集', L6.unresolved.length === 1);
  ck('起止写反也能兜底', L6.blocks.some(b => b.dur === 30));
}

/* ================= 需求2：一个文件多周 + 日期级合并 ================= */
console.log('\n--- 多周文件与日期级合并 ---');
{
  // 「第一周 / 周一…周日」这种命名（子表不带日期，靠总表 overview 反查）
  const mkWeek = (title, dates) => ([
    [title], ['阶段：测试'],
    ['一、本周主题'], ['主题'],
    ['二、四科冲分目标'], ['科目', '目标分', '得分构成', '完成情况'],
    ['数学', '120', '选填70', ''],
    ['三、本周各科目标'], ['科目', '本周目标'], ['数学', '推进', ''],
    ['四、本周每日一览'], ['日期', '星期', '今日重点'],
    ...dates.map(d => [d.label, d.wd, '重点', ''])
  ]);
  const mkDay = (label, wd, subj) => ([
    [label], ['今日重点'],
    ['时间段', '科目', '学习内容'], ['08:00-10:00', subj, '任务'], ['今日复盘：x']
  ]);

  const wd = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const d1 = wd.map((w, i) => ({ label: `10月${5 + i}日`, wd: w }));
  const d2 = wd.map((w, i) => ({ label: `10月${12 + i}日`, wd: w }));

  const sheets = [
    { name: '第一周', rows: mkWeek('第01周 测试', d1) },
    ...d1.map((d, i) => ({ name: wd[i], rows: mkDay(`${d.label}（${d.wd}）· 距初试 70 天`, d.wd, '数学') })),
    { name: '第二周', rows: mkWeek('第02周 测试', d2) },
    ...d2.map((d, i) => ({ name: wd[i], rows: mkDay(`${d.label}（${d.wd}）· 距初试 63 天`, d.wd, '英语') }))
  ];
  // sheet 名不能重名 —— 第二周的星期表加个前缀区分
  sheets.forEach((s, i) => { if (i > 8 && wd.includes(s.name)) s.name = '第2周' + s.name; });

  const diag = [];
  const ws = OPS.parseWorkbook(sheets, diag);
  ck('「第一周 + 周一…」能解析出 2 周', ws.length === 2, `${ws.length} 周 / 警告 ${diag.length}`);
  ck('每周 7 天', ws.every(w => w.days.length === 7), ws.map(w => w.days.length).join(','));
  ck('日期从总表 overview 反查正确', ws[0].days[0].date === '2026-10-05', ws[0].days[0].date);
  ck('第 2 周日期正确', ws[1].days[0].date === '2026-10-12', ws[1].days[0].date);

  // 日期级合并：10/5-10/11 与 10/8-10/14 → 合并后共 10 天，重叠 4 天不重复
  const A = OPS.parseWorkbook([
    { name: '第一周', rows: mkWeek('第01周', d1) },
    ...d1.map((d, i) => ({ name: wd[i], rows: mkDay(`${d.label}（${d.wd}）· 测试`, d.wd, '数学') }))
  ]);
  const overlap = wd.map((w, i) => ({ label: `10月${8 + i}日`, wd: w }));
  const B = OPS.parseWorkbook([
    { name: '第二周', rows: mkWeek('第02周', overlap) },
    ...overlap.map((d, i) => ({ name: 'B' + wd[i], rows: mkDay(`${d.label}（${d.wd}）· 测试`, d.wd, '英语') }))
  ]);

  const state = { weeks: [] };
  OPS.mergeIntoState(state, A, 'A.xlsx');
  const r2 = OPS.mergeIntoState(state, B, 'B.xlsx');
  const allDates = state.weeks.flatMap(w => w.days.map(d => d.date)).sort();
  ck('重叠区间：总天数 = 10（不重复）', allDates.length === 10, `${allDates.length} 天`);
  ck('重叠区间：日期无重复', new Set(allDates).size === allDates.length);
  ck('重叠区间：报告合并了重叠天数', r2.mergedDays === 4, `mergedDays=${r2.mergedDays}`);

  // 重叠那天的条目要合成一天（数学 + 英语 两条）
  const d808 = state.weeks.flatMap(w => w.days).find(d => d.date === '2026-10-08');
  ck('重叠当天的条目被合并到同一天', d808 && d808.items.length === 2,
    d808 ? d808.items.map(i => i.subject).join('+') : '未找到');
}

console.log(fail === 0 ? '\n全部测试通过 ✓' : `\n${fail} 项失败 ✗`);
process.exit(fail === 0 ? 0 : 1);