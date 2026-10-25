/* ============================================================
 * Fairy · 应用层
 * 继承原作战终端的数据模型与视觉，补齐：
 *   · 多文件批量导入（一次导入一个文件即导入其中全部周）
 *   · 重合自动合并（打卡只增不减）
 *   · xlsx 导出（每天一个 sheet）
 * 分层：state → calc → render，refreshAll() 为唯一调度入口
 * ============================================================ */
(function () {
  'use strict';

  // 存储键沿用历史名（arknights_...）：改名不影响已保存的打卡与番茄记录
  var LS_KEY = 'arknights_kaoyan_ops_v2';
  var EXAM_DATE = '2026-12-19';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function fmtMD(iso) {
    if (!iso) return '';
    var d = new Date(iso + 'T00:00:00');
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }
  function fmtCN(iso) {
    if (!iso) return '';
    var d = new Date(iso + 'T00:00:00');
    var wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
    return fmtMD(iso) + ' ' + wd;
  }
  function daysTo(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }
  function subjCls(s) {
    var map = [['数学', 'math'], ['英语', 'eng'], ['政治', 'pol'], ['专业课', 'maj'],
      ['881', 'maj'], ['生活', 'life'], ['休息', 'rest'], ['复盘', 'rev'],
      ['背诵', 'rev'], ['订正', 'rev'], ['考试', 'maj'], ['提醒', 'life']];
    for (var i = 0; i < map.length; i++) if (String(s).indexOf(map[i][0]) >= 0) return map[i][1];
    return 'life';
  }
  /* 科目主色（用于 SVG 图形着色） */
  var SUBJECT_COLORS = {
    '数学': '#5ec8ff', '英语': '#ff5c9d', '政治': '#ff9a3d', '专业课': '#b78cff',
    '881': '#b78cff', '生活': '#6a6a77', '休息': '#6a6a77', '复盘': '#2fd9d0',
    '背诵': '#2fd9d0', '订正': '#2fd9d0', '考试': '#b78cff', '提醒': '#6a6a77'
  };
  function subjStyle(name) {
    var k = String(name == null ? '' : name).trim();
    if (!k) return { c: '#6a6a77' };
    if (SUBJECT_COLORS[k]) return { c: SUBJECT_COLORS[k] };
    for (var n in SUBJECT_COLORS) if (k.indexOf(n) >= 0) return { c: SUBJECT_COLORS[n] };
    return { c: '#6a6a77' };
  }
  function addDays(iso, n) {
    var d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function cut(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }
  // 官方圆形图标按钮内嵌的白色符号
  var ICON_CAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M16 2.5v4M8 2.5v4M3 9.5h18"/><circle cx="8" cy="14" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="14" r="1.2" fill="currentColor" stroke="none"/><circle cx="16" cy="14" r="1.2" fill="currentColor" stroke="none"/></svg>';
  var ICON_WEEK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h2M14 14h2M8 18h2"/></svg>';
  function isoFromLabel(week, o) {
    var m = String(o.label).match(/(\d{1,2})月(\d{1,2})日/);
    if (!m) return null;
    var year = week.startDate ? week.startDate.slice(0, 4) : todayISO().slice(0, 4);
    return year + '-' + pad2(+m[1]) + '-' + pad2(+m[2]);
  }

  /* ========== 全局状态 ========== */
  /**
   * 邦布（绝区零吉祥物）——「每日一览」的每个日期格里蹲一只。
   *
   * 优先用官方邦布贴图：构建时把 15 只（米哈游官方美术的邦布设定图）内联进
   * window.FAIRY_BANGBOOS，每个位置用一只不同的，切到下一周自动换一批。
   * 没有任何内联图时退回矢量剪影，保证任何环境下都不开天窗。
   */
  var BANGBOO_SET = (typeof window !== 'undefined' && window.FAIRY_BANGBOOS && window.FAIRY_BANGBOOS.length)
    ? window.FAIRY_BANGBOOS : [];
  var BANGBOO_SVG = '<svg viewBox="0 0 30 24" aria-hidden="true">' +
    '<rect x="7" y="0" width="4.4" height="9" rx="2.2" fill="currentColor"/>' +
    '<rect x="18.6" y="0" width="4.4" height="9" rx="2.2" fill="currentColor"/>' +
    '<rect x="3.5" y="6.5" width="23" height="16.5" rx="8" fill="currentColor"/>' +
    '<rect x="7.5" y="10" width="15" height="9" rx="3" fill="#0a0a0a"/>' +
    '<circle cx="11.5" cy="14.5" r="1.4" fill="currentColor"/>' +
    '<circle cx="18.5" cy="14.5" r="1.4" fill="currentColor"/>' +
    '</svg>';
  /** 取第 n 只邦布（循环复用，保证 15 只够多时不会重复到同一只） */
  function bangbooAt(n) {
    if (!BANGBOO_SET.length) return BANGBOO_SVG;
    return '<img src="' + BANGBOO_SET[((n % BANGBOO_SET.length) + BANGBOO_SET.length) % BANGBOO_SET.length] +
      '" alt="" draggable="false">';
  }

  var S = {
    weeks: [],
    activeWeekId: null,
    activeDate: null,
    sources: [],      // 已导入文件记录（每份计划一个 id）
    pomo: null,       // 番茄钟（科目 / 记录 / 小组件设置）
    importing: false
  };
  var _lastNowIdx = -2;   // 实时条当前高亮的任务序号，用于避免每秒重绘

  /* ========== 存取层 ========== */
  function save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        weeks: S.weeks, activeWeekId: S.activeWeekId,
        activeDate: S.activeDate, sources: S.sources, pomo: S.pomo
      }));
    } catch (e) { toast('保存失败：浏览器存储空间不足', 'bad'); }
  }
  function load() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return false;
      var o = JSON.parse(raw);
      if (!o || (!Array.isArray(o.weeks) && !o.pomo)) return false;
      S.weeks = Array.isArray(o.weeks) ? o.weeks : [];
      S.activeWeekId = o.activeWeekId || null;
      S.activeDate = o.activeDate || null;
      S.sources = o.sources || [];
      S.pomo = o.pomo || null;
      // 老数据没有批次标记：只有一份来源时直接归给它
      if (S.weeks.length && S.sources.length === 1) {
        S.weeks.forEach(function (w) { if (!w.src) w.src = S.sources[0].id || ''; });
      }
      return S.weeks.length > 0 || !!S.pomo;
    } catch (e) { return false; }
  }

  /* ========== 计算层 ========== */
  function activeWeek() {
    for (var i = 0; i < S.weeks.length; i++) if (S.weeks[i].id === S.activeWeekId) return S.weeks[i];
    return S.weeks[0] || null;
  }
  function dayOf(week, iso) {
    if (!week || !week.days) return null;
    for (var i = 0; i < week.days.length; i++) if (week.days[i].date === iso) return week.days[i];
    return null;
  }
  function studyItems(day) {
    return (day ? (day.items || []) : []).filter(function (i) { return i.kind === 'study'; });
  }
  function dayStats(week, iso) {
    var items = studyItems(dayOf(week, iso));
    var done = items.filter(function (i) { return i.done; }).length;
    return { total: items.length, done: done, pct: items.length ? Math.round(done / items.length * 100) : 0 };
  }
  function weekStats(week) {
    var total = 0, done = 0;
    (week.scoreGoals || []).forEach(function (g) { total++; if (g.done) done++; });
    (week.weekGoals || []).forEach(function (g) { total++; if (g.done) done++; });
    (week.days || []).forEach(function (d) {
      studyItems(d).forEach(function (i) { total++; if (i.done) done++; });
    });
    var pct = total ? Math.round(done / total * 100) : 0;
    var status = 'run', t = todayISO();
    if (t < week.startDate) status = 'wait';
    else if (t > week.endDate) status = pct >= 100 ? 'done' : 'late';
    else status = pct >= 100 ? 'done' : 'run';
    return { total: total, done: done, pct: pct, status: status };
  }
  function weekTitle(week) {
    var m = String(week.title).match(/第\s*(\d+)\s*周/);
    return m ? '第' + m[1] + '周' : (week.startDate || '周计划');
  }
  function weekOfDate(iso) {
    for (var i = 0; i < S.weeks.length; i++) {
      var w = S.weeks[i];
      if (iso >= w.startDate && iso <= w.endDate) return w;
    }
    return null;
  }
  /** 全局统计：所有周的学习条目 */
  function globalStats() {
    var total = 0, done = 0, days = 0;
    S.weeks.forEach(function (w) {
      (w.days || []).forEach(function (d) {
        days++;
        studyItems(d).forEach(function (i) { total++; if (i.done) done++; });
      });
    });
    return { total: total, done: done, days: days, pct: total ? Math.round(done / total * 100) : 0 };
  }
  /** 今天要处理：今日 + 近 N 天逾期（更早的折叠） */
  function pendingTasks(backDays) {
    var today = todayISO();
    var floor = -1;
    var d0 = new Date(today);
    d0.setDate(d0.getDate() - (backDays || 3));
    floor = d0.getFullYear() + '-' + pad2(d0.getMonth() + 1) + '-' + pad2(d0.getDate());
    var out = [], backlog = 0;
    S.weeks.forEach(function (w) {
      (w.days || []).forEach(function (d) {
        if (d.date > today) return;
        var over = d.date < today;
        (d.items || []).forEach(function (it, idx) {
          if (it.done) return;
          if (over && d.date < floor) { backlog++; return; }
          out.push({ week: w, day: d, item: it, idx: idx, over: over });
        });
      });
    });
    out.sort(function (a, b) {
      if (a.over !== b.over) return a.over ? -1 : 1;
      return a.day.date < b.day.date ? -1 : 1;
    });
    out.backlog = backlog;
    return out;
  }

  /* ========== 渲染层 ========== */
  function renderWeekList() {
    var el = $('weekList');
    if (!S.weeks.length) {
      el.innerHTML = '<div style="color:var(--text3);font-size:12px;padding:8px 4px">暂无周计划，请导入文件</div>';
      return;
    }
    el.innerHTML = S.weeks.map(function (w) {
      var ws = weekStats(w);
      var active = w.id === S.activeWeekId;
      return '<div class="week-card ' + (active ? 'active ' : '') + ws.status + '" data-week="' + esc(w.id) + '">' +
        '<div class="wc-top"><span class="wc-name">' + esc(weekTitle(w)) + '</span>' +
        '<span class="st st-' + ws.status + '">' + ST_TXT[ws.status] + '</span></div>' +
        '<div class="wc-range">' + esc(fmtMD(w.startDate)) + ' - ' + esc(fmtMD(w.endDate)) + '</div>' +
        '<div class="wc-prog"><div class="bar"><i style="width:' + ws.pct + '%"></i></div><span>' + ws.pct + '%</span></div>' +
        '</div>';
    }).join('');
  }
  var ST_TXT = { run: '进行中', done: '已完成', late: '已逾期', wait: '未开始' };

  function renderBanner(week) {
    var el = $('weekBanner');
    var ws = weekStats(week);
    var miles = (week.milestones || []).map(function (m) { return '<div>' + esc(m) + '</div>'; }).join('');
    var no = (String(week.title || '').match(/第\s*(\d+)\s*周/) || [, '--'])[1];
    // 官方章节条：蓝渐变 + 左侧超大黑描边白数字 + 右侧圆形图标
    el.innerHTML =
      '<div class="wb-head">' +
      '<span class="wb-no">' + esc(no) + '</span>' +
      '<span class="wb-txt"><span class="micro">Week Ops</span><h2>' + esc(week.title) + '</h2></span>' +
      '<span class="wb-ic">' + ICON_WEEK + '</span>' +
      '</div>' +
      '<div class="wb-body">' +
      '<div class="phase">' + esc(week.phase || '') + '</div>' +
      (week.theme ? '<div class="theme"><b>本周主题</b>' + esc(week.theme) + '</div>' : '') +
      (miles ? '<div class="mile"><span>关键节点 / 提醒</span>' + miles + '</div>' : '') +
      '</div>';
  }

  function renderDateNav(week) {
    var el = $('dateNav');
    var iso = S.activeDate;
    var isToday = iso === todayISO();
    var hasDay = !!dayOf(week, iso);
    el.innerHTML =
      '<button class="nav-btn" id="prevDay" aria-label="前一天">‹</button>' +
      '<div class="date-core">' +
      '<span class="date-main">' + esc(fmtCN(iso)) + '<small>' + (hasDay ? '有作战计划' : '无作战计划') + '</small></span>' +
      '<input type="date" id="dateInput" value="' + iso + '">' +
      '<button class="btn btn-ghost" id="btnToday">回到今天</button>' +
      (isToday ? '<span class="today-tag">今日</span>' : '') +
      '</div>' +
      '<button class="nav-btn" id="nextDay" aria-label="后一天">›</button>';
    $('prevDay').onclick = function () { setDate(addDays(iso, -1)); };
    $('nextDay').onclick = function () { setDate(addDays(iso, 1)); };
    $('btnToday').onclick = function () { setDate(todayISO()); };
    $('dateInput').onchange = function (e) { setDate(e.target.value); };
  }

  function setDate(iso) {
    S.activeDate = iso || todayISO();
    var cur = activeWeek();
    if (cur && !dayOf(cur, S.activeDate)) {
      var target = weekOfDate(S.activeDate);
      if (target && target.id !== cur.id) S.activeWeekId = target.id;
    }
    save(); refreshAll();
  }

  function renderStats(week) {
    var el = $('statsRow');
    var ds = dayStats(week, S.activeDate);
    var ws = weekStats(week);
    var g = globalStats();
    var C = 2 * Math.PI * 52;
    var off = C * (1 - ds.pct / 100);
    var goalsDone = (week.scoreGoals || []).filter(function (x) { return x.done; }).length +
      (week.weekGoals || []).filter(function (x) { return x.done; }).length;
    var goalsTotal = (week.scoreGoals || []).length + (week.weekGoals || []).length;
    var left = daysTo(todayISO(), EXAM_DATE);
    el.innerHTML =
      '<div class="panel stat-cell ring-cell">' +
      '<svg class="ring" viewBox="0 0 120 120">' +
      '<circle class="ring-track" cx="60" cy="60" r="52"/>' +
      '<circle class="ring-fill" cx="60" cy="60" r="52" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '"/>' +
      '<text class="ring-txt" x="60" y="60" text-anchor="middle" dominant-baseline="central">' + ds.pct + '%</text>' +
      '</svg>' +
      '<div class="stat-meta"><b>今日完成率</b><span>' + ds.done + ' / ' + ds.total + ' 项学习任务</span></div>' +
      '</div>' +
      '<div class="panel stat-cell"><div class="stat-line">' +
      '<div class="lab"><b>本周完成率</b><span>' + ws.done + ' / ' + ws.total + ' · ' + ws.pct + '%</span></div>' +
      '<div class="bar"><i style="width:' + ws.pct + '%"></i></div>' +
      '<div class="note">含四科冲分目标、本周各科目标与每日学习任务</div>' +
      '</div></div>' +
      '<div class="panel stat-cell"><div class="stat-line">' +
      '<div class="lab"><b>全部已导入计划</b><span>' + g.done + ' / ' + g.total + ' · ' + g.pct + '%</span></div>' +
      '<div class="bar"><i style="width:' + g.pct + '%"></i></div>' +
      '<div class="note">共 ' + S.weeks.length + ' 周 / ' + g.days + ' 天 · 距初试 ' + (left > 0 ? left : 0) + ' 天</div>' +
      '</div></div>';

    // 顶栏 SANITY 进度条：反映今日完成率
    var fill = $('sanityFill'), txt = $('sanityTxt');
    if (fill) fill.style.width = ds.pct + '%';
    if (txt) txt.textContent = ds.done + '/' + ds.total;
  }

  function renderGoal(week) {
    var el = $('goalPanel');
    var rows = (week.weekGoals || []).map(function (g, i) {
      return '<div class="goal-row ' + (g.done ? 'row-done' : '') + '" data-wg="' + i + '">' +
        '<span class="s-tag s-' + subjCls(g.subject) + '">' + esc(g.subject) + '</span>' +
        '<span class="g-target">' + esc(g.target) + '</span>' +
        '<span class="chk">✓</span></div>';
    }).join('');
    el.innerHTML = '<div class="block-h"><div class="ttl">本周各科目标</div><div class="sub">点击行确认完成</div></div>' +
      '<div class="block-bd" style="padding:6px 6px">' + (rows || '<div class="day-empty">暂无数据</div>') + '</div>';
  }

  function renderScore(week) {
    var el = $('scorePanel');
    var rows = (week.scoreGoals || []).map(function (g, i) {
      return '<div class="score-row ' + (g.done ? 'row-done' : '') + '" data-sc="' + i + '">' +
        '<span class="s-tag s-' + subjCls(g.subject) + '">' + esc(g.subject) + '</span>' +
        '<span class="s-target">' + esc(g.target) + '</span>' +
        '<span class="s-points">' + esc(g.points) + '</span>' +
        '<span class="chk">✓</span></div>';
    }).join('');
    el.innerHTML = '<div class="block-h"><div class="ttl">四科冲分目标</div><div class="sub">点击行确认完成</div></div>' +
      '<div class="block-bd" style="padding:6px 6px">' + (rows || '<div class="day-empty">暂无数据</div>') + '</div>';
  }

  function renderOverview(week) {
    var el = $('overviewPanel');
    // 这一周在计划列表里的序号：用来给每个格子分配不同的一只邦布（切周自动换一批）
    var wi = 0;
    for (var q = 0; q < S.weeks.length; q++) { if (S.weeks[q] && S.weeks[q].id === week.id) { wi = q; break; } }
    var chips = (week.overview || []).map(function (o, oi) {
      var iso = isoFromLabel(week, o);
      var ds = iso ? dayStats(week, iso) : { done: 0, total: 0 };
      var allDone = ds.total > 0 && ds.done >= ds.total;
      var cur = iso === S.activeDate;
      return '<div class="ov-chip ' + (allDone ? 'done' : '') + ' ' + (cur ? 'cur' : '') + '" data-jump="' + (iso || '') + '">' +
        '<div class="ov-top"><b>' + esc(o.label) + '</b><span>' + esc(o.weekday) + ' · ' + ds.done + '/' + ds.total + '</span></div>' +
        '<i>' + (allDone ? '✓' : bangbooForDate(iso || (wi * 7 + oi))) + '</i></div>';
    }).join('');
    el.innerHTML = '<div class="block-h"><div class="ttl">本周每日一览</div><div class="sub">点击切换日期</div></div>' +
      '<div class="block-bd"><div class="ov-grid">' + (chips || '<div class="day-empty">暂无数据</div>') + '</div></div>';
  }

  /* ---------- 每日时间轴（需求1：纵轴时间 + 冲突分列 + 同时段叠行） ---------- */
  var _lastPpm = 0;
  // px/分钟。1.55 下两小时的块约 186px，够放三四行正文
  function tlPpm() { return (window.innerWidth < 640 ? 1.15 : 1.6); }

  function tlRow(m, tiny) {
    var it = m.item || {};
    var rest = it.kind === 'rest';
    var tip = [it.time, it.subject, it.content, (it.target && it.target !== '—' ? '（' + it.target + '）' : '')]
      .filter(Boolean).join(' · ');
    // 时间拆成起止两段：窄/高的块里由 CSS 竖排成「上面开始、下面结束」，单行块仍横排
    var tm = String(it.time || '');
    var mt = tm.match(/^(\d{1,2}:\d{2})\s*[-~—–]\s*(\d{1,2}:\d{2})$/);
    var tmHtml = mt
      ? '<span class="tlb-tm"><b>' + esc(mt[1]) + '</b><i>-</i><b>' + esc(mt[2]) + '</b></span>'
      : '<span class="tlb-tm"><b>' + esc(tm) + '</b></span>';
    return '<div class="tlb-row' + (it.done ? ' done' : '') + '" data-it="' + m.idx + '" data-time="' + esc(it.time) + '" title="' + esc(tip) + '">' +
      tmHtml +
      '<span class="s-tag s-' + subjCls(it.subject) + '">' + esc(it.subject) + '</span>' +
      '<span class="tlb-ct">' + esc(it.content || '—') + '</span>' +
      (it.target && it.target !== '—' ? '<span class="tlb-tg">' + esc(it.target) + '</span>' : '') +
      (rest ? '<span class="tlb-rest">不计</span>' : '<span class="tlb-chk">✓</span>') +
      '</div>';
  }

  function buildTimeline(day) {
    var L = OPS.layoutDay(day.items || []);
    var ppm = tlPpm();
    _lastPpm = ppm;
    var H = (L.endMin - L.startMin) * ppm;

    var axis = '', lines = '';
    for (var hh = L.startHour; hh <= L.endHour; hh++) {
      var t = (hh * 60 - L.startMin) * ppm;
      axis += '<div class="tlg-h" style="top:' + t + 'px"><span>' + pad2(hh % 24) + ':00</span></div>';
      lines += '<div class="tlg-line" style="top:' + t + 'px"></div>';
    }

    var blocks = L.blocks.map(function (b) {
      var first = (b.members[0] && b.members[0].item) || {};
      var bh = Math.max(b.dur * ppm, 13);
      var w = 100 / b.lanes;
      var tiny = bh < 34;
      // 能放几行 = 可用高度 / 行高。
      // 踩过的坑：早先直接拿块总高判断，没扣 padding，30 分钟的块算成 2 行、
      // 实际只放得下 1 行半，第二行被 overflow 裁掉，看着像"只显示了一行"。
      var PAD_Y = 8;        // .tlg-blk 上下 padding 合计
      var LINE_H = 19.6;    // 14.5px × 1.35
      var per = (bh - PAD_Y) / Math.max(1, b.stack);
      var lines = Math.max(1, Math.min(6, Math.floor(per / LINE_H)));
      var tall = lines >= 2;   // 多行块：时间竖排
      var allDone = b.members.every(function (m) { return m.item && m.item.done; });
      var cls = 'tlg-blk s-' + subjCls(first.subject) +
        (b.overflow ? ' ovf' : '') + (b.stack > 1 ? ' stack' : '') +
        (tiny ? ' tiny' : '') + (tall ? ' tall' : '') + (allDone ? ' alldone' : '');
      var rows = b.members.slice(0, OPS.MAX_LANES).map(function (m) { return tlRow(m, tiny); }).join('');
      var more = b.stack > OPS.MAX_LANES ? '<span class="tlb-more">+' + (b.stack - OPS.MAX_LANES) + '</span>' : '';
      return '<div class="' + cls + '" style="top:' + (b.top * ppm) + 'px;height:' + bh + 'px;' +
        '--lines:' + lines + ';' +
        'left:' + (b.lane * w) + '%;width:calc(' + w + '% - 3px)" ' +
        'data-time="' + esc(first.time || '') + '" data-stack="' + b.stack + '">' +
        rows + more + '</div>';
    }).join('');

    var notes = L.unresolved.length
      ? '<div class="tlg-note"><b>时间待确认</b>' + L.unresolved.map(function (u) {
        return '<span class="tlg-note-i" data-it="' + u.idx + '">' +
          esc((u.item && (u.item.subject || u.item.time)) || '') + ' · ' + esc((u.item && u.item.content) || '') + '</span>';
      }).join('') + '</div>'
      : '';

    return '<div class="tlg">' +
      '<div class="tlg-axis" style="height:' + H + 'px">' + axis + '</div>' +
      '<div class="tlg-body" style="height:' + H + 'px" data-start="' + L.startMin + '" data-ppm="' + ppm + '">' +
      lines +
      '<div class="tlg-now" id="tlgNow" style="display:none"></div>' + blocks +
      '</div></div>' + notes;
  }

  function renderDay(week) {
    var el = $('dayPanel');
    var iso = S.activeDate;
    var day = dayOf(week, iso);
    if (!day) {
      el.innerHTML = '<div class="block-h"><div class="ttl">每日作战计划</div><div class="sub">' + esc(fmtCN(iso)) + '</div></div>' +
        '<div class="day-empty"><b>该日期暂无作战计划</b>请通过顶部日期栏选择其他日期，或导入包含该日期的计划文件</div>';
      return;
    }
    var ds = dayStats(week, iso);
    el.innerHTML =
      '<div class="block-h"><div class="ttl">每日作战计划</div><div class="sub">' + esc(day.label || fmtCN(iso)) + ' · ' + ds.done + '/' + ds.total + '</div></div>' +
      '<div class="day-focus"><b>今日重点</b>' + esc(String(day.focus || '').replace(/^阶段：[^｜|]*[｜|]\s*今日重点：/, '')) + '</div>' +
      buildTimeline(day) +
      (day.review ? '<div class="review-bd">' + esc(day.review) + '</div>' : '');
  }

  function renderInfo(week) {
    var el = $('infoPanel');
    if (!(week.materials || week.usage)) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="block-h"><div class="ttl">材料与说明</div><div class="sub">Materials</div></div>' +
      '<div class="block-bd"><details class="meta"><summary>材料建议与使用说明</summary><div class="meta-bd">' +
      (week.materials ? '<div><h4>材料建议</h4><p>' + esc(week.materials) + '</p></div>' : '') +
      (week.usage ? '<div><h4>使用说明</h4><p>' + esc(week.usage) + '</p></div>' : '') +
      '</div></details></div>';
  }

  /* ========== 作战日历（顶部：收起=周历，展开=月历） ========== */
  // 原来这一块是「今天要处理」。现在换成日历：
  //   收起时是一行七天的周历胶囊（带官方小邦布 + 完成度 + 逾期标记）
  //   点「展开月历」变成整月网格，可翻月，点任意一天切换当前作战日期
  // 日历、首页、每日一览三者共用同一份「当前日期」状态，点哪儿都同步。
  var calExpanded = false;   // 是否展开成月历
  var calShift = 0;         // 周历翻周 / 月历翻月的偏移

  /** 把 'YYYY-MM-DD' 解析成本地时区的 Date（不能用 new Date(iso)，那是 UTC） */
  function parseISODate(iso) {
    var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return new Date();
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }
  /** 全局按日期索引计划日 */
  function calDayIndex() {
    var idx = {};
    S.weeks.forEach(function (wk) {
      (wk.days || []).forEach(function (dd) { idx[dd.date] = dd; });
    });
    return idx;
  }
  /** 每个日期还欠多少条（逾期未完成）——「今天要处理」被去掉后，逾期信息挪到这里 */
  function calOverdueMap() {
    var today = todayISO(), over = {};
    S.weeks.forEach(function (wk) {
      (wk.days || []).forEach(function (d) {
        if (d.date >= today) return;
        var n = 0;
        (d.items || []).forEach(function (it) { if (!it.done) n++; });
        if (n) over[d.date] = (over[d.date] || 0) + n;
      });
    });
    return over;
  }
  /** 某个日期该配哪只邦布 —— 和「本周每日一览」用的是同一只，两处长得一样 */
  function bangbooForDate(iso) {
    for (var w = 0; w < S.weeks.length; w++) {
      var days = S.weeks[w].days || [];
      for (var i = 0; i < days.length; i++) {
        if (days[i].date === iso) return bangbooAt(w * 7 + i);
      }
    }
    return bangbooAt(0);
  }
  /** 周历要显示的日期：优先用「当前周计划」的实际日期（和每日一览完全一致），
   *  没有计划时退回自然周（周一→周日）。calShift 用来翻到上/下一周。 */
  function calWeekDates() {
    var wi = -1, wk = activeWeek();
    if (wk) { for (var i = 0; i < S.weeks.length; i++) if (S.weeks[i].id === wk.id) { wi = i; break; } }
    if (wi >= 0) {
      var tw = S.weeks[wi + calShift];
      if (tw && (tw.days || []).length) {
        return tw.days.map(function (d) { return d.date; });
      }
    }
    var d = parseISODate(S.activeDate || todayISO());
    var dow = (d.getDay() + 6) % 7;            // 周一 = 0
    d.setDate(d.getDate() - dow + calShift * 7);
    var out = [];
    for (var k = 0; k < 7; k++) {
      out.push(d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()));
      d.setDate(d.getDate() + 1);
    }
    return out;
  }
  /** 月历要显示的月份（独立于当前查看日期，翻月时写回 S.calMonth） */
  function calMonthBase() {
    if (S.calMonth) {
      var m0 = String(S.calMonth).match(/^(\d{4})-(\d{2})/);
      if (m0) return new Date(+m0[1], +m0[2] - 1, 1);
    }
    var d = parseISODate(S.activeDate || todayISO());
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  /** 顶部作战日历 */
  function renderCalStrip() {
    var el = $('calStrip');
    if (!el) return;
    var idx = calDayIndex();
    var over = calOverdueMap();
    var today = todayISO();
    var unit = calExpanded ? '月' : '周';
    var head = '<div class="cs-head">' +
      '<span class="cs-ic">' + ICON_CAL + '</span>' +
      '<span class="cs-txt"><span class="micro">Calendar</span><h2>作战日历</h2></span>' +
      '<span class="cs-ops">' +
      '<button class="cs-btn" data-act="cal-prev" title="上一' + unit + '">‹</button>' +
      '<button class="cs-btn cs-view" data-act="cal-view" title="在周历与月历之间切换">' +
      (calExpanded ? '收起' : '展开') + '</button>' +
      '<button class="cs-btn" data-act="cal-next" title="下一' + unit + '">›</button>' +
      '</span></div>';

    if (!calExpanded) {
      /* —— 周历：一行七天的胶囊 —— */
      var dates = calWeekDates();
      var wd = ['日', '一', '二', '三', '四', '五', '六'];
      var html = head + '<div class="cs-week">';
      dates.forEach(function (date) {
        var day = idx[date];
        var tot = day ? (day.items || []).length : 0;
        var dn = day ? (day.items || []).filter(function (x) { return x.done; }).length : 0;
        var pct = tot ? Math.round(dn / tot * 100) : 0;
        var cls = 'cs-d';
        if (date === today) cls += ' today';
        if (date === S.activeDate) cls += ' sel';
        if (!day) cls += ' none';
        html += '<button class="' + cls + '" data-cal="' + date + '">' +
          '<span class="cs-w">' + wd[parseISODate(date).getDay()] + '</span>' +
          '<span class="cs-n">' + (+date.split('-')[2]) + '</span>' +
          '<span class="cs-bb">' + (day ? bangbooForDate(date) : '') + '</span>' +
          '<span class="cs-bar"><i style="width:' + pct + '%"></i></span>' +
          (over[date] ? '<span class="cs-over">' + over[date] + '</span>' : '') +
          '</button>';
      });
      html += '</div>';
      html += '<div class="cs-foot">' + esc(fmtMD(dates[0])) + ' – ' + esc(fmtMD(dates[dates.length - 1])) +
        '　<span>点日期切换当天作战</span></div>';
      el.innerHTML = html;
      return;
    }

    /* —— 月历：整月网格 —— */
    var base = calMonthBase();
    var y = base.getFullYear(), m = base.getMonth();
    var first = new Date(y, m, 1);
    var cells = [];
    for (var i = 0; i < first.getDay(); i++) cells.push(null);
    var d2 = new Date(y, m, 1);
    while (d2.getMonth() === m) {
      var key = d2.getFullYear() + '-' + pad2(d2.getMonth() + 1) + '-' + pad2(d2.getDate());
      cells.push({ date: key, day: idx[key] || null });
      d2.setDate(d2.getDate() + 1);
    }
    while (cells.length % 7 !== 0) cells.push(null);
    var wd2 = ['日', '一', '二', '三', '四', '五', '六'];
    var html2 = head + '<div class="cs-month"><div class="cal-row">';
    for (var w2 = 0; w2 < 7; w2++) html2 += '<span class="cal-wd">' + wd2[w2] + '</span>';
    html2 += '</div><div class="cal-grid">';
    for (var c = 0; c < cells.length; c++) {
      var cell = cells[c];
      if (!cell) { html2 += '<span class="cal-c empty"></span>'; continue; }
      var cls = 'cal-c';
      var rate = 0;
      if (cell.day) {
        var tot2 = cell.day.items.length;
        var dn2 = cell.day.items.filter(function (x) { return x.done; }).length;
        rate = tot2 ? dn2 / tot2 : 0;
        if (rate >= 0.999) cls += ' full';
        else if (rate > 0) cls += ' part';
        else cls += ' has';
      }
      if (cell.date === today) cls += ' today';
      if (cell.date === S.activeDate) cls += ' sel';
      html2 += '<button class="' + cls + '" data-cal="' + cell.date + '">' + (+cell.date.split('-')[2]) +
        (rate > 0 && rate < 0.999 ? '<i>' + Math.round(rate * 100) + '</i>' : '') +
        (over[cell.date] ? '<u>' + over[cell.date] + '</u>' : '') +
        '</button>';
    }
    html2 += '</div>';
    var mDays = 0, mDone = 0;
    S.weeks.forEach(function (w3) {
      (w3.days || []).forEach(function (dd) {
        if (dd.date.slice(0, 7) === y + '-' + pad2(m + 1)) {
          mDays++;
          dd.items.forEach(function (x) { if (x.done) mDone++; });
        }
      });
    });
    html2 += '<div class="cal-sum">' + y + ' 年 ' + (m + 1) + ' 月　本月 <b>' + mDays +
      '</b> 天计划 · 条目完成 <b>' + mDone + '</b> 项</div></div>';
    el.innerHTML = html2;
  }

  /** 导入来源列表 */
  function renderSources() {
    var el = $('sourceList');
    if (!el) return;
    if (!S.sources.length) {
      el.innerHTML = '<div class="day-empty" style="padding:12px">尚未导入计划文件</div>';
      return;
    }
    el.innerHTML = S.sources.map(function (s) {
      return '<div class="src-row"><span class="src-name">' + esc(s.name) + '</span>' +
        '<span class="src-meta">' + esc(s.weeks) + ' 周 · ' + esc(s.days) + ' 天' +
        (s.at ? ' · ' + esc(s.at) : '') + '</span></div>';
    }).join('');
  }

  /* ========== 实时任务条（原作战终端核心特色） ========== */
  function curTimeText() {
    var d = new Date();
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }
  function renderNowStrip() {
    var inner = $('nowStripInner');
    if (!inner) return;
    var week = activeWeek();
    var clock = '<div class="ns-clock" id="nsClock">' + curTimeText() + '</div>';
    if (!week || !week.days || !week.days.length) {
      inner.innerHTML = clock + '<div class="ns-hint">暂无作战计划，导入计划文件后自动显示实时任务</div>';
      return;
    }
    if (S.activeDate !== todayISO()) {
      inner.innerHTML = clock + '<div class="ns-hint">当前查看 ' + esc(fmtCN(S.activeDate)) + '，实时任务仅对今日生效</div>';
      return;
    }
    var day = dayOf(week, todayISO());
    if (!day || !day.items || !day.items.length) {
      inner.innerHTML = clock + '<div class="ns-hint">今日暂无作战计划</div>';
      return;
    }
    var cur = nowHM();
    var nowIdx = -1;
    day.items.forEach(function (it, i) {
      var r = parseTimeRange(it.time);
      if (r && cur >= r[0] && cur <= r[1]) nowIdx = i;
    });
    function itemHtml(it) {
      if (!it) return '<span class="ct">—</span>';
      return '<span class="tm">' + esc(it.time) + '</span>' +
        '<span class="s-tag s-' + subjCls(it.subject) + '">' + esc(it.subject) + '</span>' +
        '<span class="ct">' + esc(cut(it.content, 30)) + '</span>';
    }
    var middle;
    if (nowIdx >= 0) {
      var it = day.items[nowIdx];
      middle = '<div class="ns-now"><span class="tag">正在执行</span>' + itemHtml(it) + '</div>';
    } else {
      middle = '<div class="ns-idle">当前时段无计划 · 休息 / 间隙</div>';
    }
    var prev = nowIdx > 0 ? day.items[nowIdx - 1] : null;
    var next = (nowIdx >= 0 && nowIdx < day.items.length - 1) ? day.items[nowIdx + 1] : null;
    inner.innerHTML = clock + middle +
      '<div class="ns-adj">' +
      '<span class="a"><span class="tm">‹ 前一件</span>' + (prev ? itemHtml(prev) : '<span class="ct">—</span>') + '</span>' +
      '<span class="sep">|</span>' +
      '<span class="a"><span class="tm">后一件 ›</span>' + (next ? itemHtml(next) : '<span class="ct">—</span>') + '</span>' +
      '</div>';
  }

  /* ========== 底部 Tab 切换 ========== */
  var TABS = ['today', 'calendar', 'goals', 'stats', 'plan', 'pomo'];
  var curTab = 'today';

  // 桌面版的置顶小窗用 index.html?mini=1 打开同一份页面，只渲染计时小组件
  var MINI_ONLY = /[?&]mini=1/.test(location.search);
  if (MINI_ONLY) document.body.classList.add('mini-mode');

  function applyTab() {
    // 切到哪个 Tab 就显示哪些区块
    var showBanner = curTab === 'today' || curTab === 'calendar';
    var showDateNav = curTab === 'today' || curTab === 'calendar';
    var showStats = curTab === 'today' || curTab === 'stats';
    var showCols = curTab === 'today' || curTab === 'goals';
    var showGoal = curTab === 'today' || curTab === 'goals';
    var showScore = curTab === 'today' || curTab === 'goals';
    var showOverview = curTab === 'today' || curTab === 'calendar';
    var showInfo = curTab === 'today';

    $('calStrip').hidden = !(curTab === 'today' || curTab === 'goals' || curTab === 'stats');
    $('statPanel').hidden = curTab !== 'stats';
    $('planPanel').hidden = curTab !== 'plan';
    $('pomoPanel').hidden = curTab !== 'pomo';
    $('weekBanner').hidden = !showBanner;
    $('dateNav').hidden = !showDateNav;
    $('statsRow').hidden = !showStats;
    $('goalPanel').hidden = !showGoal;
    $('scorePanel').hidden = !showScore;
    $('overviewPanel').hidden = !showOverview;
    $('infoPanel').hidden = !showInfo;
    // 双列容器：goals 视图只显示目标面板，today 全部显示
    var cols = document.querySelector('.cols');
    var colMain = document.querySelector('.col-main');
    var colSide = document.querySelector('.col-side');
    if (cols) cols.hidden = !(curTab === 'today' || curTab === 'goals');
    if (colMain) colMain.hidden = curTab !== 'today';
    if (colSide) colSide.hidden = curTab !== 'today' && curTab !== 'goals';

    // Tab 高亮
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].className = 'tab' + (tabs[i].getAttribute('data-tab') === curTab ? ' on' : '');
    }
  }

  /** 供页面里的其它入口（如右侧番茄悬浮按钮）切换视图 */
  function switchTab(name) {
    curTab = name;
    applyTab();
    refreshAll();
    window.scrollTo(0, 0);
  }

  function bindTabs() {
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      (function (t) {
        t.onclick = function () {
          curTab = t.getAttribute('data-tab');
          applyTab();
          refreshAll();
          window.scrollTo(0, 0);
        };
      })(tabs[i]);
    }
  }

  /** 底部 Tab 的统计视图 */
  function renderStatsPanel() {
    var el = $('statPanel');
    if (!el) return;
    // 各科完成率
    var byS = {};
    var weeks = S.weeks;
    weeks.forEach(function (w) {
      (w.days || []).forEach(function (d) {
        (d.items || []).forEach(function (it) {
          var k = (it.subject || '其他').trim() || '其他';
          if (!byS[k]) byS[k] = { total: 0, done: 0 };
          byS[k].total++;
          if (it.done) byS[k].done++;
        });
      });
    });
    var keys = Object.keys(byS).sort(function (a, b) { return byS[b].total - byS[a].total; });
    var maxT = 0;
    keys.forEach(function (k) { maxT = Math.max(maxT, byS[k].total); });

    var html = '<div class="block-h"><div class="ttl">科目完成分布</div><div class="sub">By Subject</div></div><div class="block-bd">';
    if (!keys.length) html += '<div class="day-empty">暂无数据</div>';
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], v = byS[k];
      var pct = v.total ? Math.round(v.done / v.total * 100) : 0;
      var st = subjStyle(k);
      html += '<div class="sb-row">' +
        '<span class="s-tag s-' + subjCls(k) + '">' + esc(k) + '</span>' +
        '<span class="sb-bar"><i style="width:' + (v.total ? Math.round(v.done / maxT * 100) : 0) + '%;background:' + st.c + '"></i>' +
        '<u style="width:' + Math.round(v.total / maxT * 100) + '%"></u></span>' +
        '<span class="sb-num">' + v.done + '/' + v.total + '</span>' +
        '<span class="sb-pct">' + pct + '%</span></div>';
    }
    // 每日完成率折线（内联 SVG）
    var dates = [];
    weeks.forEach(function (w) { (w.days || []).forEach(function (d) { dates.push(d); }); });
    dates.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    if (dates.length) {
      var W = 620, H = 120, pad = 22;
      var pts = dates.map(function (d, i) {
        var t = d.items.length;
        var dn = d.items.filter(function (x) { return x.done; }).length;
        var r = t ? dn / t : 0;
        var x = pad + (dates.length === 1 ? (W - pad * 2) / 2 : i * (W - pad * 2) / (dates.length - 1));
        var y = H - pad - r * (H - pad * 2);
        return { x: x, y: y, r: r, date: d.date };
      });
      var path = pts.map(function (p, i) { return (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1); }).join(' ');
      var area = path + ' L' + pts[pts.length - 1].x.toFixed(1) + ' ' + (H - pad) + ' L' + pts[0].x.toFixed(1) + ' ' + (H - pad) + ' Z';
      html += '<div class="sb-chart"><svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" preserveAspectRatio="none">';
      html += '<defs><linearGradient id="sbGrad" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="#ffe500" stop-opacity=".34"/><stop offset="1" stop-color="#ffe500" stop-opacity="0"/></linearGradient></defs>';
      html += '<path d="' + area + '" fill="url(#sbGrad)"/>';
      html += '<path d="' + path + '" fill="none" stroke="#ffe500" stroke-width="2" stroke-linejoin="round"/>';
      for (var j = 0; j < pts.length; j++) {
        html += '<circle cx="' + pts[j].x.toFixed(1) + '" cy="' + pts[j].y.toFixed(1) + '" r="2.6" fill="#ffe500"/>';
      }
      html += '</svg></div>';
      html += '<div class="sb-legend">每日完成率走势（' + dates[0].date + ' ~ ' + dates[dates.length - 1].date + '）</div>';
    }
    html += '</div>';
    el.innerHTML = html;
  }

  /* ========== 统一刷新入口 ========== */
  /* ============================================================
     计划管理（按导入批次分块，四行两列）
     ============================================================ */
  var PLAN_PER_PAGE = 8;          // 4 行 × 2 列
  var planPage = 0;
  var planSel = null;

  /** 把 weeks 按导入批次分组，按导入时间升序 */
  function planGroups() {
    var byId = {}, unknown = null;
    (S.sources || []).forEach(function (s, i) {
      var id = s.id || ('src_' + (i + 1));
      s.id = id;
      byId[id] = { id: id, name: s.name || '未命名', at: s.at || '', weeks: [] };
    });
    S.weeks.forEach(function (w) {
      var id = w.src || '';
      if (id && byId[id]) { byId[id].weeks.push(w); return; }
      if (!unknown) {
        unknown = { id: 'src_unknown', name: '未标记来源', at: '', weeks: [] };
        byId['src_unknown'] = unknown;
      }
      if (!w.src) w.src = 'src_unknown';
      unknown.weeks.push(w);
    });
    var list = [];
    Object.keys(byId).forEach(function (k) {
      if (byId[k].weeks.length) list.push(byId[k]);
    });
    list.sort(function (a, b) {
      if (a.at && b.at) return a.at < b.at ? -1 : 1;
      if (a.at) return -1;
      if (b.at) return 1;
      return a.name < b.name ? -1 : 1;
    });
    return list;
  }

  function groupRange(g) {
    var lo = '', hi = '';
    g.weeks.forEach(function (w) {
      (w.days || []).forEach(function (d) {
        if (!lo || d.date < lo) lo = d.date;
        if (!hi || d.date > hi) hi = d.date;
      });
    });
    return { lo: lo, hi: hi, days: g.weeks.reduce(function (s, w) { return s + (w.days || []).length; }, 0) };
  }

  /** 2026-10-18 → 10月18日 */
  function mdText(iso) {
    if (!iso) return '—';
    return (+iso.slice(5, 7)) + '月' + (+iso.slice(8, 10)) + '日';
  }
  function rangeText(lo, hi) {
    if (!lo) return '无日期';
    return lo === hi ? mdText(lo) : (mdText(lo) + ' - ' + mdText(hi));
  }

  function renderPlanMgr() {
    var grid = $('planGrid');
    var detail = $('planDetail');
    var empty = $('planEmpty');
    var pager = $('planPager');
    var cnt = $('planCount');
    if (!grid) return;

    var groups = planGroups();
    if (cnt) cnt.textContent = groups.length ? ('共 ' + groups.length + ' 份 · ' + S.weeks.length + ' 周') : '';
    if (empty) empty.hidden = groups.length > 0;

    if (planSel && !groups.some(function (g) { return g.id === planSel; })) planSel = null;

    var pages = Math.max(1, Math.ceil(groups.length / PLAN_PER_PAGE));
    if (planPage > pages - 1) planPage = pages - 1;
    if (planPage < 0) planPage = 0;
    var slice = groups.slice(planPage * PLAN_PER_PAGE, planPage * PLAN_PER_PAGE + PLAN_PER_PAGE);

    grid.innerHTML = slice.map(function (g) {
      var r = groupRange(g);
      return '<div class="pm-card' + (planSel === g.id ? ' on' : '') + '" data-src="' + esc(g.id) + '">' +
        '<button class="pm-del" data-del-src="' + esc(g.id) + '" title="删除整份计划">×</button>' +
        '<div class="pm-range">' + esc(rangeText(r.lo, r.hi)) + '</div>' +
        '<div class="pm-scope">' + g.weeks.length + ' 周 · ' + r.days + ' 天</div>' +
        '<div class="pm-at">导入 ' + esc(g.at || '—') + '</div>' +
        '</div>';
    }).join('');

    if (pager) {
      if (pages > 1) {
        pager.hidden = false;
        pager.innerHTML = '<button data-plan-page="' + (planPage - 1) + '"' + (planPage === 0 ? ' disabled' : '') + '>‹</button>' +
          '<span class="pm-scope">' + (planPage + 1) + ' / ' + pages + '</span>' +
          '<button data-plan-page="' + (planPage + 1) + '"' + (planPage === pages - 1 ? ' disabled' : '') + '>›</button>';
      } else {
        pager.hidden = true;
        pager.innerHTML = '';
      }
    }

    if (!detail) return;
    if (!planSel) { detail.hidden = true; detail.innerHTML = ''; return; }
    var g = groups.filter(function (x) { return x.id === planSel; })[0];
    if (!g) { detail.hidden = true; detail.innerHTML = ''; return; }
    detail.hidden = false;
    detail.innerHTML =
      '<div class="pm-detail-h"><b>' + esc(g.name) + '</b>' +
      '<span class="pm-detail-n">' + g.weeks.length + ' 周 · 导入 ' + esc(g.at || '—') + '</span></div>' +
      g.weeks.map(function (w) {
        var ds = (w.days || []).length;
        var lo = ds ? w.days[0].date : '', hi = ds ? w.days[ds - 1].date : '';
        return '<div class="pm-week' + (w.id === S.activeWeekId ? ' is-active' : '') + '">' +
          '<div class="pm-week-main"><b>' + esc(w.title || '未命名周') + '</b>' +
          '<span>' + esc(rangeText(lo, hi)) + ' · ' + ds + ' 天</span></div>' +
          '<div class="pm-week-ops">' +
          '<button class="pm-mini-btn" data-open-week="' + esc(w.id) + '">查看</button>' +
          '<button class="pm-mini-btn danger" data-del-week="' + esc(w.id) + '">删除这周</button>' +
          '</div></div>';
      }).join('');
  }

  function deletePlanSource(id) {
    var g = planGroups().filter(function (x) { return x.id === id; })[0];
    if (!g) return;
    var r = groupRange(g);
    var msg = '删除「' + g.name + '」这份计划？\n\n它带来 ' + g.weeks.length + ' 周、' + r.days +
      ' 天（' + rangeText(r.lo, r.hi) + '），这些天的计划和已打的卡会一起移除，且不可撤销。';
    if (!confirm(msg)) return;
    var ids = {};
    g.weeks.forEach(function (w) { ids[w.id] = 1; });
    S.weeks = S.weeks.filter(function (w) { return !ids[w.id]; });
    S.sources = (S.sources || []).filter(function (s) { return s.id !== id; });
    if (ids[S.activeWeekId] || !S.weeks.length) {
      S.activeWeekId = S.weeks.length ? S.weeks[0].id : null;
      S.activeDate = null;
    }
    if (planSel === id) planSel = null;
    save();
    refreshAll();
    toast('已删除该计划');
  }

  function deleteWeekById(wid) {
    var w = S.weeks.filter(function (x) { return x.id === wid; })[0];
    if (!w) return;
    if (!confirm('删除「' + (w.title || '这一周') + '」？\n\n' + (w.days || []).length + ' 天的计划和打卡会一起移除。')) return;
    S.weeks = S.weeks.filter(function (x) { return x.id !== wid; });
    if (S.activeWeekId === wid) {
      S.activeWeekId = S.weeks.length ? S.weeks[0].id : null;
      S.activeDate = null;
    }
    save();
    refreshAll();
    toast('已删除这一周');
  }

  function openWeekById(wid) {
    var w = S.weeks.filter(function (x) { return x.id === wid; })[0];
    if (!w) return;
    S.activeWeekId = wid;
    S.activeDate = (w.days && w.days.length) ? w.days[0].date : todayISO();
    curTab = 'today';
    save();
    applyTab();
    refreshAll();
    window.scrollTo(0, 0);
  }

  /* ============================================================
     番茄钟
     ============================================================ */
  var POMO_COLORS = ['#5ec8ff', '#b78cff', '#ff5c9d', '#ff9a3d', '#2fd9d0', '#ffe500'];
  var POMO_DEFAULT = ['数学', '专业课', '英语', '政治'];
  var pomoEditing = false;


  function ensurePomo() {
    if (!S.pomo || typeof S.pomo !== 'object') S.pomo = {};
    var p = S.pomo;
    if (!Array.isArray(p.subjects) || !p.subjects.length) {
      p.subjects = POMO_DEFAULT.map(function (n, i) { return { name: n, color: POMO_COLORS[i % POMO_COLORS.length] }; });
    }
    if (!Array.isArray(p.log)) p.log = [];
    p.work = Math.max(1, Math.min(180, +p.work || 25));
    p.rest = Math.max(1, Math.min(60, +p.rest || 5));
    if (!p.subject || !p.subjects.some(function (s) { return s.name === p.subject; })) p.subject = p.subjects[0].name;
    if (p.phase !== 'rest') p.phase = 'work';
    if (typeof p.left !== 'number' || p.left < 0) p.left = (p.phase === 'rest' ? p.rest : p.work) * 60;
    p.running = !!p.running;
    if (!p.mini) p.mini = { on: false, pin: true, size: 'm' };
    if (!p.mini.size) p.mini.size = 'm';
    if (p.running && !p.endAt) p.running = false;
    return p;
  }

  function pomoPhaseSecs(p) { return (p.phase === 'rest' ? p.rest : p.work) * 60; }
  function pomoRemain(p) {
    if (p.running && p.endAt) return Math.max(0, Math.round((p.endAt - Date.now()) / 1000));
    return Math.max(0, Math.round(p.left));
  }
  function fmtClock(sec) {
    sec = Math.max(0, Math.round(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return pad2(m) + ':' + pad2(s);
  }
  function humanMin(min) {
    min = Math.round(min);
    if (min < 60) return min + ' 分钟';
    var h = Math.floor(min / 60), m = min % 60;
    return h + ' 小时' + (m ? ' ' + m + ' 分' : '');
  }

  function beep() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      var ctx = beep._ctx || (beep._ctx = new AC());
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.65);
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.7);
    } catch (e) { /* 没有声音不影响计时 */ }
  }

  /** 结束当前阶段：natural=true 表示自然走完，false 表示手动跳过 */
  /**
   * 倒计时结束的视觉提醒：柔和闪烁 5 次（约 4.5 秒）。
   * 暂不发声，先把看得见的提醒做出来；音频以后接 WebAudio 或音频文件。
   */
  function flashPomo() {
    var targets = [
      document.getElementById('pomoMini'),
      document.getElementById('pomoFab'),
      document.querySelector('.pomo-ring'),
      document.querySelector('.pomo-time')
    ];
    targets.forEach(function (el) {
      if (!el) return;
      el.classList.remove('flashing');
      void el.offsetWidth;          // 强制重排，保证连续两次触发也能重播
      el.classList.add('flashing');
      setTimeout(function () { el.classList.remove('flashing'); }, 4800);
    });
  }

  function pomoFinish(natural) {
    var p = ensurePomo();
    var now = Date.now();
    var phaseSecs = pomoPhaseSecs(p);
    var spentSec = Math.max(0, phaseSecs - pomoRemain(p));

    if (p.phase === 'work') {
      var mins = natural ? p.work : Math.round(spentSec / 60);
      if (mins > 0) {
        p.log.push({ d: todayISO(), s: p.subject, m: mins, at: now });
      }
      p.phase = 'rest';
      p.left = p.rest * 60;
      p.endAt = natural ? (now + p.left * 1000) : 0;
      p.running = !!natural;
      if (natural) { beep(); toast('这一轮完成 · ' + p.subject + ' ' + p.work + ' 分钟，开始休息'); }
    } else {
      p.phase = 'work';
      p.left = p.work * 60;
      p.endAt = 0;
      p.running = false;
      if (natural) { beep(); toast('休息结束，可以开始下一轮了'); }
    }
    save();
    refreshAll();
    // 必须放在 refreshAll 之后：renderPomoMini 会重写 className，
    // 先加 flashing 会被冲掉，看起来就是"结束时没闪"
    if (natural) flashPomo();
  }

  function pomoStartPause() {
    var p = ensurePomo();
    if (p.running) {
      p.left = pomoRemain(p);
      p.running = false;
      p.endAt = 0;
    } else {
      if (p.left <= 0) p.left = pomoPhaseSecs(p);
      p.endAt = Date.now() + p.left * 1000;
      p.running = true;
    }
    save();
    refreshAll();
  }

  function pomoReset() {
    var p = ensurePomo();
    p.phase = 'work';
    p.left = p.work * 60;
    p.running = false;
    p.endAt = 0;
    save();
    refreshAll();
  }

  function pomoStatsData() {
    var p = ensurePomo();
    var all = {}, today = {}, rounds = 0, todayRounds = 0;
    p.subjects.forEach(function (s) { all[s.name] = 0; today[s.name] = 0; });
    p.log.forEach(function (l) {
      if (!l || !l.s) return;
      all[l.s] = (all[l.s] || 0) + (+l.m || 0);
      if (l.d === todayISO()) {
        today[l.s] = (today[l.s] || 0) + (+l.m || 0);
        todayRounds++;
      }
      rounds++;
    });
    var items = p.subjects.map(function (s) { return { name: s.name, color: s.color, min: all[s.name] || 0 }; });
    var total = items.reduce(function (a, b) { return a + b.min; }, 0);
    var todayTotal = 0;
    Object.keys(today).forEach(function (k) { todayTotal += today[k]; });
    return { items: items, total: total, today: today, todayTotal: todayTotal, rounds: rounds, todayRounds: todayRounds };
  }

  function donutSvg(items, total) {
    var R = 84, r = 56, cx = 100, cy = 100;
    var nonZero = items.filter(function (x) { return x.min > 0; });
    if (!total || !nonZero.length) {
      return '<svg viewBox="0 0 200 200" role="img" aria-label="暂无记录">' +
        '<circle cx="100" cy="100" r="70" fill="none" stroke="rgba(255,255,255,.09)" stroke-width="28"/>' +
        '<text x="100" y="105" text-anchor="middle" fill="#6a6a77" font-size="13" font-weight="700">暂无记录</text></svg>';
    }
    if (nonZero.length === 1) {
      return '<svg viewBox="0 0 200 200" role="img">' +
        '<circle cx="100" cy="100" r="70" fill="none" stroke="' + nonZero[0].color + '" stroke-width="28"/></svg>';
    }
    var ang = -Math.PI / 2, out = '';
    nonZero.forEach(function (it) {
      var a2 = ang + (it.min / total) * Math.PI * 2;
      var large = (a2 - ang) > Math.PI ? 1 : 0;
      var x1 = cx + R * Math.cos(ang), y1 = cy + R * Math.sin(ang);
      var x2 = cx + R * Math.cos(a2), y2 = cy + R * Math.sin(a2);
      var x3 = cx + r * Math.cos(a2), y3 = cy + r * Math.sin(a2);
      var x4 = cx + r * Math.cos(ang), y4 = cy + r * Math.sin(ang);
      out += '<path d="M' + x1.toFixed(2) + ' ' + y1.toFixed(2) +
        'A' + R + ' ' + R + ' 0 ' + large + ' 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2) +
        'L' + x3.toFixed(2) + ' ' + y3.toFixed(2) +
        'A' + r + ' ' + r + ' 0 ' + large + ' 0 ' + x4.toFixed(2) + ' ' + y4.toFixed(2) + 'Z" fill="' + it.color + '"/>';
      ang = a2;
    });
    return '<svg viewBox="0 0 200 200" role="img" aria-label="各科学习时长占比">' + out + '</svg>';
  }

  function renderPomo() {
    var p = ensurePomo();
    var subjects = $('pomoSubjects');
    if (subjects) {
      subjects.innerHTML = p.subjects.map(function (s) {
        if (pomoEditing) {
          return '<span class="pomo-chip"><i style="background:' + s.color + '"></i>' +
            '<input data-rename="' + esc(s.name) + '" value="' + esc(s.name) + '" maxlength="10"></span>';
        }
        return '<button class="pomo-chip' + (s.name === p.subject ? ' on' : '') + '" data-pomo-subj="' + esc(s.name) + '">' +
          '<i style="background:' + s.color + '"></i>' + esc(s.name) + '</button>';
      }).join('') +
        '<button class="pomo-rename" data-act="pomo-rename">' + (pomoEditing ? '完成' : '改名') + '</button>';
    }

    var st = pomoStatsData();
    var chart = $('pomoChart');
    if (chart) chart.innerHTML = donutSvg(st.items, st.total);

    var legend = $('pomoLegend');
    if (legend) {
      var rows = st.items.map(function (it) {
        var pct = st.total ? Math.round(it.min / st.total * 100) : 0;
        var todayMin = st.today[it.name] || 0;
        return '<div class="pomo-legend-row"><i style="background:' + it.color + '"></i>' +
          '<b>' + esc(it.name) + '</b>' +
          '<span class="pm-scope">' + humanMin(it.min) + '</span>' +
          (todayMin ? '<span class="pm-scope">今日 ' + humanMin(todayMin) + '</span>' : '') +
          '<span class="pm-pct">' + pct + '%</span></div>';
      }).join('');
      legend.innerHTML = rows +
        '<div class="pomo-total">累计 <b>' + humanMin(st.total) + '</b>' +
        '<span>共 ' + st.rounds + ' 轮</span>' +
        '<span>今日 <b>' + humanMin(st.todayTotal) + '</b> · ' + st.todayRounds + ' 轮</span></div>';
    }

    var wIn = $('pomoWorkMin'), rIn = $('pomoRestMin');
    if (wIn && document.activeElement !== wIn) wIn.value = p.work;
    if (rIn && document.activeElement !== rIn) rIn.value = p.rest;

    var on = $('pomoMiniOn'), pin = $('pomoMiniPin');
    if (on) on.checked = !!p.mini.on;
    if (pin) pin.checked = !!p.mini.pin;
    var sizeBtns = document.querySelectorAll('[data-act="mini-size"]');
    for (var i = 0; i < sizeBtns.length; i++) {
      sizeBtns[i].className = (sizeBtns[i].getAttribute('data-size') === p.mini.size) ? 'on' : '';
    }

    paintPomoTick();
  }

  /** 每秒刷新：只改文字和环，不重建结构 */
  function paintPomoTick() {
    var p = ensurePomo();
    // 右侧悬浮按钮跟着计时状态亮起外圈脉冲
    var fabEl = $('pomoFab');
    if (fabEl) fabEl.classList.toggle('running', !!p.running);
    var left = pomoRemain(p);
    var total = pomoPhaseSecs(p);
    var timeText = fmtClock(left);

    var t = $('pomoTime');
    if (t) t.textContent = timeText;
    var ph = $('pomoPhase');
    if (ph) {
      ph.textContent = p.phase === 'rest' ? '休息' : '学习';
      ph.className = 'pomo-phase' + (p.phase === 'rest' ? ' rest' : '');
    }
    var tag = $('pomoSubjectTag');
    if (tag) tag.textContent = p.subject;
    var arc = $('pomoArc');
    if (arc) {
      var C = 2 * Math.PI * 88;
      var ratio = total > 0 ? Math.min(1, Math.max(0, left / total)) : 0;
      arc.setAttribute('stroke-dasharray', C.toFixed(1));
      arc.setAttribute('stroke-dashoffset', (C * (1 - ratio)).toFixed(1));
      arc.setAttribute('stroke', p.phase === 'rest' ? '#2fd9d0' : '#ffe500');
    }
    var startBtn = $('pomoStart');
    if (startBtn) startBtn.textContent = p.running ? '暂停' : '开始';

    var mt = $('miniTime');
    if (mt) mt.textContent = timeText;
    var mp = $('miniPhase');
    if (mp) {
      mp.textContent = p.phase === 'rest' ? '休息' : '学习';
      mp.className = 'mini-phase' + (p.phase === 'rest' ? ' rest' : '');
    }
    var ms = $('miniSubj');
    if (ms) ms.textContent = p.subject;
    var mtg = $('miniToggle');
    if (mtg) {
      mtg.innerHTML = p.running
        ? '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="5" width="4" height="14" rx="1"/><rect x="13" y="5" width="4" height="14" rx="1"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
      mtg.title = p.running ? '暂停' : '开始';
    }
  }

  function renderPomoMini() {
    var el = $('pomoMini');
    if (!el) return;
    var p = ensurePomo();
    el.hidden = !p.mini.on;
    if (!p.mini.on) return;
    // 桌面版开启系统置顶窗时，页面内这份就藏起来，避免同屏出现两个计时器
    if (window.fairyDesktop && p.mini.pin) { el.hidden = true; }
    el.className = 'pomo-mini size-' + (p.mini.size || 'm') + (p.mini.pin ? '' : ' flow');
    // 拖动过就用绝对位置，否则用默认角
    if (typeof p.mini.x === 'number' && typeof p.mini.y === 'number') {
      el.style.left = p.mini.x + 'px';
      el.style.top = p.mini.y + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    } else {
      el.style.left = '';
      el.style.top = '';
      el.style.right = '';
      el.style.bottom = '';
    }
    paintPomoTick();
  }

  /** 小组件拖动（只拖顶部小横条，避免误触按钮） */
  function bindMiniDrag() {
    var el = $('pomoMini'), grab = $('miniGrab');
    if (!el || !grab) return;
    var dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;

    function start(e) {
      if (!el || el.hidden) return;
      var pt = e.touches ? e.touches[0] : e;
      var r = el.getBoundingClientRect();
      dragging = true;
      sx = pt.clientX; sy = pt.clientY; ox = r.left; oy = r.top;
      el.classList.add('dragging');
      e.preventDefault();
    }
    function move(e) {
      if (!dragging) return;
      var pt = e.touches ? e.touches[0] : e;
      var w = el.offsetWidth, h = el.offsetHeight;
      var x = Math.min(Math.max(0, ox + pt.clientX - sx), window.innerWidth - w - 4);
      var y = Math.min(Math.max(0, oy + pt.clientY - sy), window.innerHeight - h - 4);
      el.style.left = x + 'px'; el.style.top = y + 'px';
      el.style.right = 'auto'; el.style.bottom = 'auto';
    }
    function end() {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('dragging');
      var p = ensurePomo();
      p.mini.x = parseFloat(el.style.left) || 0;
      p.mini.y = parseFloat(el.style.top) || 0;
      save();
    }

    grab.addEventListener('mousedown', start);
    grab.addEventListener('touchstart', start, { passive: false });
    document.addEventListener('mousemove', move);
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('mouseup', end);
    document.addEventListener('touchend', end);
  }

  /* ========== 外观 / 皮肤 ==========
   * 第一原则：皮肤数据单独存一个 localStorage key。
   * 背景图动辄几百 KB，如果塞进主数据，一旦超出配额，整份 save() 会抛错，
   * 连带把打卡记录一起丢掉——所以这里完全独立，存不下只影响外观。
   *
   * 图片优先级：用户上传的图 > 内置皮肤（仅本地版有） > 默认暮色背景 > 纯黑
   * 「清除」不是回到默认背景，而是明确地什么都不要（cleared=true）。
   */
  var SKIN_KEY = 'fairy_skin_v1';
  var SKIN_DEF = { img: '', useBuiltin: false, cleared: false, bright: .95, veil: .55, blur: 0, cardA: .9 };
  var skin = null;
  var skinSaveTimer = null;

  function builtinSkin() { return String(window.FAIRY_SKIN_B64 || ''); }
  function defaultBg() { return String(window.FAIRY_BG_DEFAULT || ''); }
  function clampNum(v, lo, hi, dft) {
    var n = parseFloat(v);
    if (!isFinite(n)) return dft;
    return Math.min(hi, Math.max(lo, n));
  }

  function loadSkin() {
    var o = null;
    try { o = JSON.parse(localStorage.getItem(SKIN_KEY) || 'null'); } catch (e) { o = null; }
    skin = {
      img: '', useBuiltin: false, cleared: false,
      bright: SKIN_DEF.bright, veil: SKIN_DEF.veil, blur: SKIN_DEF.blur, cardA: SKIN_DEF.cardA
    };
    if (o && typeof o === 'object') {
      skin.img = typeof o.img === 'string' ? o.img : '';
      skin.useBuiltin = !!o.useBuiltin;
      skin.cleared = !!o.cleared;
      skin.bright = clampNum(o.bright, .2, 1.4, SKIN_DEF.bright);
      skin.veil = clampNum(o.veil, 0, .95, SKIN_DEF.veil);
      skin.blur = clampNum(o.blur, 0, 24, SKIN_DEF.blur);
      skin.cardA = clampNum(o.cardA, .3, 1, SKIN_DEF.cardA);
    } else if (builtinSkin()) {
      // 本地版首次打开：直接把内置皮肤套上，省得用户先找设置
      skin.useBuiltin = true;
    }
  }

  /** 立刻落盘（拖动结束 / 页面隐藏时调用） */
  function flushSkin() {
    if (skinSaveTimer) { clearTimeout(skinSaveTimer); skinSaveTimer = null; }
    try {
      localStorage.setItem(SKIN_KEY, JSON.stringify(skin));
    } catch (e) {
      // 配额不足：退回内置皮肤（或纯黑），至少让界面还能用
      if (skin.img) {
        skin.img = '';
        skin.useBuiltin = !!builtinSkin();
        skin.cleared = !skin.useBuiltin;
        applySkin();
        toast('这张图太大，存不进本机，已退回内置皮肤', 'bad');
      }
    }
  }

  function saveSkin() {
    if (skinSaveTimer) clearTimeout(skinSaveTimer);
    skinSaveTimer = setTimeout(flushSkin, 300);
  }

  /** 当前实际生效的背景图 dataURL（可能为空串） */
  function skinImage() {
    if (skin.img) return skin.img;
    if (skin.useBuiltin) return builtinSkin();
    if (!skin.cleared) return defaultBg();
    return '';
  }

  /** 只写 CSS 变量：拖动滑块时高频调用，不碰任何控件 */
  function applySkinVars() {
    var root = document.documentElement;
    var img = skinImage();
    root.style.setProperty('--skin-img', img ? 'url("' + img + '")' : 'none');
    root.style.setProperty('--skin-bright', String(skin.bright));
    root.style.setProperty('--skin-veil', String(skin.veil));
    root.style.setProperty('--skin-blur', skin.blur + 'px');
    root.style.setProperty('--card-a', String(skin.cardA));
  }

  function setRangeFill(el) {
    if (!el) return;
    var lo = +el.min || 0, hi = +el.max || 100;
    var p = hi > lo ? (el.value - lo) / (hi - lo) * 100 : 0;
    el.style.setProperty('--fill', p + '%');
  }

  /** 把状态写回抽屉里的控件（打开抽屉 / 重置时调用） */
  function paintSkinUI() {
    var img = skinImage();
    var thumb = $('skinThumb');
    if (thumb) {
      thumb.style.backgroundImage = img ? 'url("' + img + '")' : '';
      thumb.setAttribute('data-empty', img ? '0' : '1');
    }
    var pairs = [
      ['rBright', 'vBright', Math.round(skin.bright * 100) + '%'],
      ['rVeil', 'vVeil', Math.round(skin.veil * 100) + '%'],
      ['rBlur', 'vBlur', Math.round(skin.blur) + 'px'],
      ['rCard', 'vCard', Math.round(skin.cardA * 100) + '%']
    ];
    pairs.forEach(function (p) {
      var el = $(p[0]), lab = $(p[1]);
      if (el) {
        // 直接用状态值回填，避免 1 / 100% 这类单位换算散落在各处
        if (p[0] === 'rBright') el.value = Math.round(skin.bright * 100);
        else if (p[0] === 'rVeil') el.value = Math.round(skin.veil * 100);
        else if (p[0] === 'rBlur') el.value = Math.round(skin.blur);
        else if (p[0] === 'rCard') el.value = Math.round(skin.cardA * 100);
        setRangeFill(el);
      }
      if (lab) lab.textContent = p[2];
    });
    var hasBuiltin = !!builtinSkin();
    var bb = $('skinBuiltin');
    if (bb) {
      bb.disabled = !hasBuiltin;
      bb.style.opacity = hasBuiltin ? '' : '.38';
      bb.style.cursor = hasBuiltin ? '' : 'not-allowed';
      bb.textContent = hasBuiltin ? '内置皮肤' : '无内置皮肤';
    }
    var trig = $('btnSkin');
    if (trig) trig.classList.toggle('has-skin', !!(skin.img || skin.useBuiltin));
    var foot = $('skinFoot');
    if (foot) {
      foot.innerHTML = hasBuiltin
        ? '本地皮肤：<b>《绝区零》官方素材</b>，版权归米哈游所有，仅本机个人使用，<b>不随发行版分发</b>。'
        : '此版本<b>不内置任何第三方图片</b>，皮肤接口对所有人开放：换成自己的图即可。';
    }
    var tip = $('skinTip');
    if (tip) {
      tip.textContent = skin.img
        ? '已使用自定义图片。图片只保存在本机浏览器里，不会上传。'
        : (skin.useBuiltin && hasBuiltin
          ? '正在使用内置皮肤。可以换成任意本地图片，或点「清除」改成纯黑底。'
          : '未设置背景图。选择一张横版（16:9）图片效果最好。');
    }
  }

  /** 变量 + 控件一起刷新（结构性变化时用） */
  function applySkin() { applySkinVars(); paintSkinUI(); }

  /** 等比缩到 maxPx 以内并转 jpeg —— 直接存原图会撑爆 localStorage */
  function shrinkImage(im, maxPx, quality) {
    var w = im.naturalWidth || im.width || 1;
    var h = im.naturalHeight || im.height || 1;
    var sc = Math.min(1, maxPx / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * sc));
    c.height = Math.max(1, Math.round(h * sc));
    var g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(im, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  }

  function pickSkinImage(file) {
    if (!file) return;
    if (!/^image\//.test(file.type || '')) { toast('请选择图片文件', 'bad'); return; }
    if (file.size > 24 * 1024 * 1024) { toast('图片太大了（限 24MB）', 'bad'); return; }
    var fr = new FileReader();
    fr.onload = function () {
      var im = new Image();
      im.onload = function () {
        var url = shrinkImage(im, 1920, .84);
        var tries = [[1600, .76], [1280, .7], [1024, .62]];
        for (var i = 0; i < tries.length && url.length > 3.4e6; i++) {
          url = shrinkImage(im, tries[i][0], tries[i][1]);
        }
        skin.img = url;
        skin.useBuiltin = false;
        skin.cleared = false;
        saveSkin();
        applySkin();
        toast('背景已更新');
      };
      im.onerror = function () { toast('这张图片读不出来，换一张试试', 'bad'); };
      im.src = String(fr.result || '');
    };
    fr.onerror = function () { toast('读取文件失败', 'bad'); };
    fr.readAsDataURL(file);
  }

  function openSkinDrawer(open) {
    var on = open !== false;
    document.body.classList.toggle('skin-open', on);
    var d = $('skinDrawer');
    if (d) d.setAttribute('aria-hidden', on ? 'false' : 'true');
    if (on) paintSkinUI();
  }

  function bindSkin() {
    loadSkin();
    applySkin();

    // 页面被隐藏或关闭前立刻落盘，避免防抖窗口内刷新导致外观设置丢失
    window.addEventListener('pagehide', flushSkin);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushSkin();
    });

    var trig = $('btnSkin');
    if (trig) trig.addEventListener('click', function () { openSkinDrawer(true); });
    var mask = $('skinMask');
    if (mask) mask.addEventListener('click', function () { openSkinDrawer(false); });
    var cls = $('skinClose');
    if (cls) cls.addEventListener('click', function () { openSkinDrawer(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.body.classList.contains('skin-open')) openSkinDrawer(false);
    });

    var pick = $('skinPick');
    var input = $('skinInput');
    if (pick && input) {
      pick.addEventListener('click', function () { input.value = ''; input.click(); });
      input.addEventListener('change', function () {
        if (input.files && input.files[0]) pickSkinImage(input.files[0]);
      });
    }

    var bb = $('skinBuiltin');
    if (bb) bb.addEventListener('click', function () {
      if (!builtinSkin()) { toast('这个版本没有内置皮肤，可以自己选一张图', 'bad'); return; }
      skin.img = '';
      skin.useBuiltin = true;
      skin.cleared = false;
      saveSkin(); applySkin();
      toast('已切换为内置皮肤');
    });

    var cl = $('skinClear');
    if (cl) cl.addEventListener('click', function () {
      skin.img = '';
      skin.useBuiltin = false;
      skin.cleared = true;
      saveSkin(); applySkin();
      toast('已清除背景图');
    });

    var rst = $('skinReset');
    if (rst) rst.addEventListener('click', function () {
      skin = { img: '', useBuiltin: !!builtinSkin(), cleared: false, bright: SKIN_DEF.bright, veil: SKIN_DEF.veil, blur: 0, cardA: SKIN_DEF.cardA };
      saveSkin(); applySkin();
      toast('外观已恢复默认');
    });

    // 滑块：拖动时只改变量与数值文本，不重设控件（否则拖到一半会被回填打断）
    var sliders = [
      ['rBright', 'vBright', function (v) { skin.bright = v / 100; return Math.round(skin.bright * 100) + '%'; }],
      ['rVeil', 'vVeil', function (v) { skin.veil = v / 100; return Math.round(skin.veil * 100) + '%'; }],
      ['rBlur', 'vBlur', function (v) { skin.blur = v; return Math.round(skin.blur) + 'px'; }],
      ['rCard', 'vCard', function (v) { skin.cardA = v / 100; return Math.round(skin.cardA * 100) + '%'; }]
    ];
    sliders.forEach(function (s) {
      var el = $(s[0]);
      if (!el) return;
      el.addEventListener('input', function () {
        var txt = s[2](+el.value);
        var lab = $(s[1]);
        if (lab) lab.textContent = txt;
        setRangeFill(el);
        applySkinVars();
        saveSkin();
      });
    });
  }

  /* ========== 新面板的事件绑定（一次性） ========== */
  function bindNewPanels() {
    bindMiniDrag();
    document.addEventListener('click', function (e) {
      var t = e.target;

      var delSrc = t.closest && t.closest('[data-del-src]');
      if (delSrc) { e.stopPropagation(); deletePlanSource(delSrc.getAttribute('data-del-src')); return; }

      var card = t.closest && t.closest('[data-src]');
      if (card) {
        var id = card.getAttribute('data-src');
        planSel = (planSel === id) ? null : id;
        refreshAll();
        return;
      }

      var pg = t.closest && t.closest('[data-plan-page]');
      if (pg && !pg.disabled) {
        planPage = +pg.getAttribute('data-plan-page');
        if (planPage < 0) planPage = 0;
        refreshAll();
        return;
      }

      var ow = t.closest && t.closest('[data-open-week]');
      if (ow) { openWeekById(ow.getAttribute('data-open-week')); return; }

      var dw = t.closest && t.closest('[data-del-week]');
      if (dw) { deleteWeekById(dw.getAttribute('data-del-week')); return; }

      var subj = t.closest && t.closest('[data-pomo-subj]');
      if (subj) {
        var p1 = ensurePomo();
        p1.subject = subj.getAttribute('data-pomo-subj');
        save(); refreshAll(); return;
      }

      var act = t.closest && t.closest('[data-act]');
      if (!act) return;
      var a = act.getAttribute('data-act');
      if (a === 'home') {
        curTab = 'today'; applyTab(); refreshAll(); window.scrollTo(0, 0); return;
      }
      if (a === 'pomo-start') { pomoStartPause(); return; }
      if (a === 'pomo-reset') { pomoReset(); return; }
      if (a === 'pomo-skip') { pomoFinish(false); return; }
      if (a === 'mini-toggle') { pomoStartPause(); return; }
      if (a === 'mini-close') {
        var p2 = ensurePomo(); p2.mini.on = false; save(); refreshAll(); return;
      }
      if (a === 'mini-size') {
        var p3 = ensurePomo(); p3.mini.size = act.getAttribute('data-size') || 'm'; save(); refreshAll(); return;
      }
      if (a === 'pomo-rename') {
        var p4 = ensurePomo();
        if (pomoEditing) {
          pomoEditing = false;
          // 读回输入框里改过的名字
          var inputs = document.querySelectorAll('[data-rename]');
          for (var k = 0; k < inputs.length; k++) {
            var oldName = inputs[k].getAttribute('data-rename');
            var newName = String(inputs[k].value || '').trim();
            if (newName && newName !== oldName) {
              p4.subjects.forEach(function (s) { if (s.name === oldName) s.name = newName; });
              if (p4.subject === oldName) p4.subject = newName;
              p4.log.forEach(function (l) { if (l.s === oldName) l.s = newName; });
            }
          }
        } else {
          pomoEditing = true;
        }
        save(); refreshAll(); return;
      }
    });

    // 时长设置 / 小组件开关
    document.addEventListener('change', function (e) {
      var t = e.target;
      var p = ensurePomo();
      if (t.id === 'pomoWorkMin') {
        p.work = Math.max(1, Math.min(180, +t.value || 25));
        if (!p.running && p.phase === 'work') p.left = p.work * 60;
        save(); refreshAll(); return;
      }
      if (t.id === 'pomoRestMin') {
        p.rest = Math.max(1, Math.min(60, +t.value || 5));
        if (!p.running && p.phase === 'rest') p.left = p.rest * 60;
        save(); refreshAll(); return;
      }
      if (t.id === 'pomoMiniOn') { p.mini.on = t.checked; save(); refreshAll(); return; }
      if (t.id === 'pomoMiniPin') {
        p.mini.pin = t.checked;
        save();
        // 桌面版：真正浮在所有窗口之上，只能开原生置顶小窗（浏览器做不到）
        if (window.fairyDesktop && window.fairyDesktop.toggleMini) {
          window.fairyDesktop.toggleMini(t.checked).catch(function () {});
        }
        refreshAll();
        return;
      }
    });
  }

  function refreshAll() {
    var week = activeWeek();
    var consoleEl = $('console');
    var emptyEl = $('emptyState');
    var noDataTab = (curTab === 'plan' || curTab === 'pomo');
    if (!week) {
      // 没有计划时，计划和番茄页仍然可用（不然删完计划就进不去番茄钟了）
      consoleEl.hidden = !noDataTab;
      emptyEl.hidden = noDataTab;
      // 空状态时把导入卡浮到右下角，省得滚到侧栏底部去找；
      // 同时收起整个侧栏（它这时候只有「暂无周计划」和一份重复的导入面板）
      var fi = $('floatImport');
      if (fi) fi.hidden = noDataTab;
      document.body.classList.toggle('empty-mode', !noDataTab);
      renderWeekList();
      renderCalStrip();
      renderSources();
      renderPlanMgr();
      renderPomo();
      renderPomoMini();
      return;
    }
    if (!S.activeDate) S.activeDate = week.days.length ? week.days[0].date : todayISO();
    consoleEl.hidden = false; emptyEl.hidden = true;
    var fi2 = $('floatImport');
    if (fi2) fi2.hidden = true;
    document.body.classList.remove('empty-mode');
    renderWeekList();
    renderBanner(week);
    renderDateNav(week);
    renderStats(week);
    renderScore(week);
    renderGoal(week);
    renderOverview(week);
    renderDay(week);
    renderInfo(week);
    renderCalStrip();
    renderSources();
    renderStatsPanel();
    renderPlanMgr();
    renderPomo();
    renderPomoMini();
    applyNow();
    renderNowStrip();
  }

  /* ========== 实时高亮 ========== */
  function nowHM() {
    var d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }
  function parseTimeRange(str) {
    var m = String(str).match(/(\d{1,2}):(\d{2})\s*[-~]\s*(\d{1,2}):(\d{2})/);
    if (!m) return null;
    return [(+m[1]) * 60 + (+m[2]), (+m[3]) * 60 + (+m[4])];
  }
  function applyNow() {
    var prev = document.querySelectorAll('.tlb-row.now, .tlg-blk.now');
    for (var i = 0; i < prev.length; i++) prev[i].classList.remove('now');
    var line = $('tlgNow');
    if (line) line.style.display = 'none';
    if (S.activeDate !== todayISO()) return;
    var cur = nowHM();

    var rows = document.querySelectorAll('.tlb-row[data-time]');
    for (var j = 0; j < rows.length; j++) {
      var r = OPS.parseRange(rows[j].getAttribute('data-time'));
      if (r && cur >= r[0] && cur < r[1]) {
        rows[j].classList.add('now');
        var blk = rows[j].parentNode;
        if (blk && blk.className && String(blk.className).indexOf('tlg-blk') >= 0) blk.classList.add('now');
      }
    }

    var body = document.querySelector('.tlg-body');
    if (line && body) {
      var start = +body.getAttribute('data-start');
      var ppm = +body.getAttribute('data-ppm');
      var h = parseFloat(body.style.height) || 0;
      var off = (cur - start) * ppm;
      if (off >= 0 && off <= h) {
        line.style.top = off + 'px';
        line.style.display = 'block';
      }
    }
  }

  /* ========== 导入 ========== */
  function inflateAsync(bytes) {
    var ds = new DecompressionStream('deflate-raw');
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  /** 解析单个 xlsx → weeks[]（文件内所有周） */
  function parseFileAsync(buf, diag) {
    var list = OPS.neededEntries(buf);
    var textMap = {};
    var chain = Promise.resolve();
    list.forEach(function (it) {
      chain = chain.then(function () {
        if (it.method === 0) { textMap[it.name] = new TextDecoder('utf-8').decode(it.data); return null; }
        return inflateAsync(it.data).then(function (d) {
          textMap[it.name] = new TextDecoder('utf-8').decode(d);
        });
      });
    });
    return chain.then(function () {
      var book = OPS.parseTexts(textMap);
      return OPS.parseWorkbook(book.sheets, diag);
    });
  }

  function handleFiles(files) {
    var list = Array.prototype.slice.call(files).filter(function (f) {
      return /\.xlsx?$/i.test(f.name) && !/^~\$/.test(f.name);
    });
    if (!list.length) { toast('请选择 .xlsx 格式的计划文件', 'bad'); return; }
    if (S.importing) { toast('正在导入，请稍候', 'bad'); return; }
    S.importing = true;
    toast('正在解析 ' + list.length + ' 个文件…');
    var chain = Promise.resolve();
    var agg = { files: 0, newWeeks: 0, mergedWeeks: 0, added: 0, days: 0, mergedDays: 0, errs: [], warns: [] };
    var perFile = [];

    // 每个文件一个批次 id：名字相同视为同一份计划（重新导入仍归到同一块）
    function sourceIdFor(name) {
      for (var i = 0; i < S.sources.length; i++) {
        if (S.sources[i].name === name) {
          if (!S.sources[i].id) S.sources[i].id = 'src_' + Date.now().toString(36) + '_' + i;
          return S.sources[i].id;
        }
      }
      return 'src_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1000);
    }

    list.forEach(function (f) {
      var srcId = sourceIdFor(f.name);
      chain = chain.then(function () {
        return f.arrayBuffer().then(function (ab) {
          var diag = [];
          return parseFileAsync(new Uint8Array(ab), diag).then(function (weeks) {
            diag.forEach(function (w) { agg.warns.push(f.name + '：' + w); });
            var rep = OPS.mergeIntoState(S, weeks, srcId);
            agg.files++;
            agg.newWeeks += rep.newWeeks;
            agg.mergedWeeks += rep.mergedWeeks;
            agg.mergedDays += (rep.mergedDays || 0);
            agg.days += rep.days;
            perFile.push({ id: srcId, name: f.name, weeks: weeks.length, days: rep.days });
            save();
          });
        }).catch(function (e) {
          agg.errs.push(f.name + '：' + e.message);
        });
      });
    });

    chain.then(function () {
      S.importing = false;
      // 记录来源
      perFile.forEach(function (p) {
        var ex = null;
        for (var i = 0; i < S.sources.length; i++) if (S.sources[i].name === p.name) ex = S.sources[i];
        if (ex) {
          ex.id = ex.id || p.id; ex.weeks = p.weeks; ex.days = p.days;
          ex.at = nowStamp(); ex.times = (ex.times || 1) + 1;
        } else {
          S.sources.push({ id: p.id, name: p.name, weeks: p.weeks, days: p.days, at: nowStamp(), times: 1 });
        }
      });
      // 定位到今天所在的周
      var w = weekOfDate(todayISO());
      if (w) { S.activeWeekId = w.id; S.activeDate = todayISO(); }
      else if (S.weeks.length) {
        S.activeWeekId = S.weeks[0].id;
        S.activeDate = S.weeks[0].days.length ? S.weeks[0].days[0].date : todayISO();
      }
      save();
      refreshAll();
      var msg = '导入完成：' + agg.files + ' 个文件，共 ' + agg.days + ' 天';
      if (agg.newWeeks) msg += '，新增 ' + agg.newWeeks + ' 周';
      if (agg.mergedDays) msg += '，重合 ' + agg.mergedDays + ' 天已自动合并（打卡保留）';
      else if (agg.mergedWeeks) msg += '，合并 ' + agg.mergedWeeks + ' 周';
      if (agg.errs.length) msg += '；' + agg.errs.length + ' 个文件失败';
      toast(msg, agg.errs.length && !agg.files ? 'bad' : 'ok');
      if (agg.warns.length) setTimeout(function () { toast('有 ' + agg.warns.length + ' 张子表无法确定日期：' + agg.warns.slice(0, 2).join('；'), 'bad'); }, 2600);
    });
  }
  function nowStamp() {
    var d = new Date();
    return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  /* ========== 导出 ========== */
  function exportXlsx(weeks) {
    var list = weeks && weeks.length ? weeks : S.weeks;
    if (!list.length) { toast('没有可导出的计划', 'bad'); return; }
    var out = OPS.buildXlsx(list);
    if (!out) { toast('导出失败', 'bad'); return; }
    var blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'Fairy_计划导出_' + todayISO().replace(/-/g, '') + '.xlsx';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
    var days = 0;
    list.forEach(function (w) { days += (w.days || []).length; });
    toast('已导出 ' + list.length + ' 周 / ' + days + ' 天（每天一个 sheet）', 'ok');
  }
  function exportJSON() {
    var blob = new Blob([JSON.stringify({ weeks: S.weeks, sources: S.sources }, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '考研计划备份_' + todayISO() + '.json';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
    toast('已导出本地备份 JSON', 'ok');
  }
  function importJSON(file) {
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var o = JSON.parse(fr.result);
        if (!o || !Array.isArray(o.weeks)) throw new Error('格式不正确');
        OPS.mergeIntoState(S, o.weeks, 'src_json_' + Date.now().toString(36));
        if (o.sources) o.sources.forEach(function (s) { S.sources.push(s); });
        var w = weekOfDate(todayISO());
        if (w) { S.activeWeekId = w.id; S.activeDate = todayISO(); }
        save(); refreshAll();
        toast('备份已恢复（与现有计划自动合并）', 'ok');
      } catch (e) { toast('恢复失败：' + e.message, 'bad'); }
    };
    fr.readAsText(file);
  }

  /* ========== 提示 ========== */
  var toastTimer = null;
  function toast(msg, kind) {
    var el = $('toast');
    el.textContent = msg;
    el.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, 2800);
  }

  /* ========== 初始化 ========== */
  function init() {
    // 导入
    $('btnImport').addEventListener('click', function () { $('fileInput').click(); });
    var emptyBtn = document.querySelector('#emptyState [data-act="import"]');
    if (emptyBtn) emptyBtn.addEventListener('click', function () { $('fileInput').click(); });
    $('fileInput').addEventListener('change', function (e) {
      handleFiles(e.target.files);
      e.target.value = '';
    });
    // 导出
    $('btnExportXlsx').addEventListener('click', function () { exportXlsx(null); });
    $('btnExportWeek').addEventListener('click', function () {
      var w = activeWeek();
      if (!w) { toast('当前没有选中的周', 'bad'); return; }
      exportXlsx([w]);
    });
    $('btnExport').addEventListener('click', exportJSON);
    $('btnImpJson').addEventListener('click', function () { $('jsonInput').click(); });
    $('jsonInput').addEventListener('change', function (e) {
      if (e.target.files[0]) importJSON(e.target.files[0]);
      e.target.value = '';
    });
    $('btnReset').addEventListener('click', function () {
      if (!confirm('确定清空本机保存的全部计划与打卡记录？此操作不可撤销，建议先导出备份。')) return;
      localStorage.removeItem(LS_KEY);
      S.weeks = []; S.activeWeekId = null; S.activeDate = null; S.sources = [];
      refreshAll();
      toast('数据已清空');
    });

    // 周列表点击
    $('weekList').addEventListener('click', function (e) {
      var card = e.target.closest('[data-week]');
      if (!card) return;
      var w = null;
      for (var i = 0; i < S.weeks.length; i++) if (S.weeks[i].id === card.dataset.week) w = S.weeks[i];
      if (!w) return;
      S.activeWeekId = w.id;
      var t = todayISO();
      S.activeDate = (t >= w.startDate && t <= w.endDate) ? t : (w.days.length ? w.days[0].date : t);
      save(); refreshAll();
    });

    // 作战日历：切日期 / 切视图 / 翻周翻月
    $('calStrip').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-cal]');
      if (btn && btn.dataset.cal) {
        var iso = btn.dataset.cal;
        calShift = 0;                       // 翻页后回到基准周，避免视图跳位
        var tw = weekOfDate(iso);
        if (tw) { S.activeWeekId = tw.id; S.activeDate = iso; }
        else {
          // 该日不在任何周内：切到最近的周并保持日期
          for (var i = 0; i < S.weeks.length; i++) {
            if (iso < S.weeks[i].startDate) { S.activeWeekId = S.weeks[i].id; break; }
            S.activeWeekId = S.weeks[i].id;
          }
          S.activeDate = iso;
        }
        save(); refreshAll();
        e.stopPropagation();
        return;
      }
      var act = e.target.closest('[data-act]');
      if (!act) return;
      var a = act.getAttribute('data-act');
      if (a === 'cal-view') {
        calExpanded = !calExpanded;
        calShift = 0;
        renderCalStrip();
      } else if (a === 'cal-prev' || a === 'cal-next') {
        var dir = (a === 'cal-next') ? 1 : -1;
        if (calExpanded) {
          var b = calMonthBase();
          var nm = new Date(b.getFullYear(), b.getMonth() + dir, 1);
          S.calMonth = nm.getFullYear() + '-' + pad2(nm.getMonth() + 1);
        } else {
          calShift += dir;
        }
        renderCalStrip();
      }
      e.stopPropagation();
    });

    // 主区域交互
    $('console').addEventListener('click', function (e) {
      var week = activeWeek();
      if (!week) return;

      var chip = e.target.closest('[data-jump]');
      if (chip && chip.dataset.jump) { setDate(chip.dataset.jump); return; }
      var sc = e.target.closest('[data-sc]');
      if (sc) {
        week.scoreGoals[+sc.dataset.sc].done = !week.scoreGoals[+sc.dataset.sc].done;
        save(); refreshAll(); return;
      }
      var wg = e.target.closest('[data-wg]');
      if (wg) {
        week.weekGoals[+wg.dataset.wg].done = !week.weekGoals[+wg.dataset.wg].done;
        save(); refreshAll(); return;
      }
      var it = e.target.closest('[data-it]');
      if (it) {
        var day = dayOf(week, S.activeDate);
        if (day && day.items[+it.dataset.it]) {
          day.items[+it.dataset.it].done = !day.items[+it.dataset.it].done;
          save(); refreshAll(); return;
        }
      }
    });

    // 拖拽导入（侧栏里一个、空状态右下角悬浮卡里一个，共用同一套逻辑）
    var dzs = document.querySelectorAll('.drop-zone');
    for (var di = 0; di < dzs.length; di++) {
      (function (dz) {
        dz.addEventListener('click', function () { $('fileInput').click(); });
        dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('hot'); });
        dz.addEventListener('dragleave', function () { dz.classList.remove('hot'); });
        dz.addEventListener('drop', function (e) {
          e.preventDefault(); dz.classList.remove('hot');
          handleFiles(e.dataTransfer.files);
        });
      })(dzs[di]);
    }

    /* 一键复制计划表提示词（侧栏导入区 + 空状态悬浮卡各一个入口） */
    function copyPlanPrompt() {
      var txt = window.FAIRY_PROMPT || '';
      if (!txt) { toast('提示词内容缺失', 'bad'); return; }

      function ok() {
        toast('提示词已复制（约 ' + (txt.length / 1000).toFixed(1) + ' 千字），粘贴给任意 AI 即可');
      }
      function fallback() {
        var ta = document.createElement('textarea');
        ta.value = txt;
        ta.style.cssText = 'position:fixed;top:-9999px;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); ok(); }
        catch (e) { toast('复制失败，请手动选择文本', 'bad'); }
        document.body.removeChild(ta);
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(ok, fallback);
      } else {
        fallback();
      }
    }
    ['btnCopyPrompt', 'btnCopyPrompt2'].forEach(function (id) {
      var b = $(id);
      if (b) b.addEventListener('click', copyPlanPrompt);
    });

    // 右侧番茄悬浮按钮：点一下进番茄页
    var fab = $('pomoFab');
    if (fab) {
      fab.addEventListener('click', function () {
        switchTab('pomo');
      });
    }

    // 恢复数据
    var had = load();
    if (!had) {
      // 首次使用：给出引导而非空白页
      S.weeks = [];
    } else {
      var w = weekOfDate(todayISO());
      if (w) { S.activeWeekId = w.id; S.activeDate = todayISO(); }
    }
    bindTabs();
    bindNewPanels();
    bindSkin();
    applyTab();
    refreshAll();

    /*
     * 超宽屏整体等比放大
     * 布局被 max-width:1620 锁住，1920/2560 全屏时两侧会空出大片黑边，字也显得小。
     * 这里按视口宽度给 body 加 zoom，让布局和字号一起放大到铺满。
     * 1500 以下不缩放（笔记本、分屏、移动端保持原样），上限 1.5 防止字过大。
     */
    function applyUiScale() {
      var w = document.documentElement.clientWidth;
      var z = Math.min(Math.max(w / 1500, 1), 1.5);
      document.body.style.zoom = z <= 1.001 ? '' : (Math.round(z * 1000) / 1000) + '';
    }
    applyUiScale();
    var scaleTimer = null;

    // 置顶小窗与主窗口各是独立页面，靠 storage 事件同步计时状态
    if (MINI_ONLY) {
      window.addEventListener('storage', function (e) {
        if (e.key !== LS_KEY || !e.newValue) return;
        try {
          var o = JSON.parse(e.newValue);
          if (o && o.pomo) { S.pomo = o.pomo; paintPomoTick(); }
        } catch (err) { /* 解析失败就等下一次 */ }
      });
    }
    window.addEventListener('resize', function () {
      if (scaleTimer) clearTimeout(scaleTimer);
      scaleTimer = setTimeout(applyUiScale, 120);
    });

    // 窗口宽度跨过窄屏阈值时，时间轴的像素比例要跟着变，重排一次
    window.addEventListener('resize', function () {
      if (tlPpm() !== _lastPpm) refreshAll();
    });

    setInterval(function () {
      var c = $('nsClock');
      if (c) {
        var d = new Date();
        c.textContent = pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
      }
      applyNow();
      // 番茄钟每秒走一格；自然走完会在这里收尾
      if (typeof pomoRemain === 'function') {
        var pp = ensurePomo();
        if (pp.running && pomoRemain(pp) <= 0) { pomoFinish(true); }
        else { paintPomoTick(); }
      }
      // 只在跨过任务边界时重绘实时条，避免每秒闪烁
      var week = activeWeek();
      if (week && S.activeDate === todayISO()) {
        var day = dayOf(week, todayISO());
        if (day && day.items) {
          var cur = nowHM();
          var idx = -1;
          day.items.forEach(function (it, i) {
            var r = parseTimeRange(it.time);
            if (r && cur >= r[0] && cur <= r[1]) idx = i;
          });
          if (idx !== _lastNowIdx) { _lastNowIdx = idx; renderNowStrip(); }
        }
      } else if (_lastNowIdx !== -2) {
        _lastNowIdx = -2; renderNowStrip();
      }
    }, 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();