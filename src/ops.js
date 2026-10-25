/* ============================================================
 * Fairy · 核心引擎 OPS
 *
 * 数据模型沿用原作战终端（week/days/items 结构、done 打卡、kind study/rest），
 * 相对原版补齐四项能力：
 *   1. 一次导入一个文件 → 导入文件内【全部】周计划（不再只取一周）
 *   2. 重合自动合并 → 按 周id + 日期 + 时间段|科目 三级匹配做真合并，
 *      打卡状态只增不减（原版是同 id 直接覆盖，会丢打卡）
 *   3. xlsx 导出 → 每天一个 sheet，完成情况以 √/□ 写回
 *   4. 零外部依赖 → 自带 ZIP/xlsx 读写，不依赖 CDN 的 SheetJS
 * ============================================================ */
var OPS = (function () {
  'use strict';

  /* ---------------- 通用工具 ---------------- */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function escXml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  var WD_MAP = { 0: '周日', 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六' };

  /* ---------------- ZIP 读取（零依赖） ---------------- */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();
  function crc32(buf) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function encUtf8(s) { return new TextEncoder().encode(s); }
  function decUtf8(b) { return new TextDecoder('utf-8').decode(b); }

  function zipEntries(buf) {
    var base = buf.byteOffset || 0;
    var dv = new DataView(buf.buffer, base, buf.byteLength);
    var eocd = -1, floor = Math.max(0, buf.length - 66000);
    for (var i = buf.length - 22; i >= floor; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('文件不是有效的 xlsx（未找到 ZIP 结束标记）');
    var count = dv.getUint16(eocd + 10, true);
    var p = dv.getUint32(eocd + 16, true), out = {};
    for (var n = 0; n < count; n++) {
      if (p + 46 > buf.length || dv.getUint32(p, true) !== 0x02014b50) break;
      var method = dv.getUint16(p + 10, true);
      var csize = dv.getUint32(p + 20, true);
      var nlen = dv.getUint16(p + 28, true);
      var elen = dv.getUint16(p + 30, true);
      var clen = dv.getUint16(p + 32, true);
      var lho = dv.getUint32(p + 42, true);
      var name = decUtf8(new Uint8Array(buf.buffer, base + p + 46, nlen));
      var lnlen = dv.getUint16(lho + 26, true);
      var lelen = dv.getUint16(lho + 28, true);
      out[name] = {
        method: method,
        data: new Uint8Array(buf.buffer, base + lho + 30 + lnlen + lelen, csize)
      };
      p += 46 + nlen + elen + clen;
    }
    return out;
  }

  /* 需要解压的条目清单（供浏览器异步解压用） */
  function neededEntries(buf) {
    var entries = zipEntries(buf);
    return Object.keys(entries).filter(function (n) {
      return n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' ||
        n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n);
    }).map(function (n) { return { name: n, method: entries[n].method, data: entries[n].data }; });
  }

  /* ---------------- xlsx 文本层解析 ---------------- */
  function parseSharedStrings(xml) {
    if (!xml) return [];
    var res = [], re = /<si\b[^>]*>([\s\S]*?)<\/si>/g, m;
    while ((m = re.exec(xml))) {
      var s = '', tre = /<t\b[^>]*>([\s\S]*?)<\/t>/g, tm;
      while ((tm = tre.exec(m[1]))) s += tm[1];
      res.push(s
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'").replace(/&#x([0-9a-fA-F]+);/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
        .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(+d); })
        .replace(/&amp;/g, '&'));
    }
    return res;
  }
  function parseSheetRows(xml, shared) {
    var rows = [];
    var re = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g, m;
    while ((m = re.exec(xml))) {
      var attrs = m[1] || '', body = m[2] || '';
      var rm = /\br="(\d+)"/.exec(attrs);
      var rIdx = rm ? parseInt(rm[1], 10) : rows.length + 1;
      var cells = [];
      var cre = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, cm;
      while ((cm = cre.exec(body))) {
        var cattrs = cm[1] || '', cbody = cm[2] || '';
        var refm = /\br="([A-Z]+\d+)"/.exec(cattrs);
        var tm = /\bt="([^"]+)"/.exec(cattrs);
        var t = tm ? tm[1] : 'n', val = '';
        if (t === 'inlineStr') {
          var s = '', tre = /<t\b[^>]*>([\s\S]*?)<\/t>/g, tm2;
          while ((tm2 = tre.exec(cbody))) s += tm2[1];
          val = s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
        } else {
          var vm = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cbody);
          var raw = vm ? vm[1] : '';
          if (t === 's') val = shared[parseInt(raw, 10)] || '';
          else if (t === 'b') val = raw === '1' ? 'TRUE' : 'FALSE';
          else val = raw;
        }
        if (refm) {
          var n = 0, ref = refm[1];
          for (var q = 0; q < ref.length; q++) {
            var c = ref.charCodeAt(q);
            if (c >= 65 && c <= 90) n = n * 26 + (c - 64);
            else if (c >= 97 && c <= 122) n = n * 26 + (c - 96);
            else break;
          }
          cells[n - 1] = val;
        }
      }
      rows[rIdx - 1] = cells;
    }
    for (var i = 0; i < rows.length; i++) {
      if (!rows[i]) rows[i] = [];
      for (var j = 0; j < rows[i].length; j++) if (rows[i][j] == null) rows[i][j] = '';
    }
    return rows;
  }
  function parseSheetDefs(xml) {
    var sheets = [], body = xml;
    var s = body.indexOf('<sheets');
    if (s >= 0) {
      var e = body.indexOf('</sheets>', s);
      body = e > s ? body.slice(s, e) : body.slice(s);
    }
    var re = /<sheet\b([^>]*?)(?:\/>|>)/g, m;
    while ((m = re.exec(body))) {
      var a = m[1] || '';
      var nm = /\bname="([^"]*)"/.exec(a);
      var id = /\bsheetId="(\d+)"/.exec(a);
      var rid = /\br:id="([^"]*)"/.exec(a);
      sheets.push({
        name: nm ? nm[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : '',
        sheetId: id ? +id[1] : sheets.length + 1,
        rid: rid ? rid[1] : ''
      });
    }
    return sheets;
  }
  function parseRels(xml) {
    var map = {}, re = /<Relationship\b([^>]*?)(?:\/>|>)/g, m;
    while ((m = re.exec(xml))) {
      var id = /\bId="([^"]*)"/.exec(m[1] || '');
      var tg = /\bTarget="([^"]*)"/.exec(m[1] || '');
      if (id && tg) map[id[1]] = tg[1].replace(/&amp;/g, '&');
    }
    return map;
  }
  function normTarget(t) {
    if (!t) return '';
    var p = t.replace(/^\//, '');
    return p.indexOf('xl/') === 0 ? p : 'xl/' + p;
  }

  /** 文本层入口：{ 'xl/workbook.xml': '<xml>' } → { sheets:[{name,rows}] } */
  function parseTexts(textMap) {
    var wbXml = textMap['xl/workbook.xml'];
    if (!wbXml) throw new Error('缺少 xl/workbook.xml，不是标准 xlsx');
    var rels = parseRels(textMap['xl/_rels/workbook.xml.rels'] || '');
    var shared = parseSharedStrings(textMap['xl/sharedStrings.xml'] || '');
    var defs = parseSheetDefs(wbXml), sheets = [];
    for (var i = 0; i < defs.length; i++) {
      var d = defs[i];
      var path = normTarget(rels[d.rid]) || ('xl/worksheets/sheet' + d.sheetId + '.xml');
      var xml = textMap[path];
      if (!xml) continue;
      sheets.push({ name: d.name, rows: parseSheetRows(xml, shared) });
    }
    return { sheets: sheets };
  }

  /* ---------------- 计划解析（沿用原版规则 + 扩展多周） ---------------- */
  function sheetRows(rows) {
    // 去掉全空行，保持原版 sheetRows 语义
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i] || [];
      var any = false;
      for (var j = 0; j < row.length; j++) if (row[j]) { any = true; break; }
      if (any) out.push(row);
    }
    return out;
  }
  function findRow(rows, kws) {
    for (var i = 0; i < rows.length; i++) {
      var joined = rows[i].join(' ');
      var ok = true;
      for (var k = 0; k < kws.length; k++) if (joined.indexOf(kws[k]) < 0) { ok = false; break; }
      if (ok) return i;
    }
    return -1;
  }
  function parseDateToken(s) {
    var m = String(s).match(/(\d{1,2})月(\d{1,2})日/);
    if (m) return [+m[1], +m[2]];
    m = String(s).match(/(\d{1,2})[-/.](\d{1,2})/);
    if (m) return [+m[1], +m[2]];
    return null;
  }
  function wdOf(month, day, y) { return new Date(y, month - 1, day).getDay(); }
  function inferYear(overview) {
    var year = parseInt(todayISO().slice(0, 4), 10);
    if (!overview || !overview.length) return year;
    var t = parseDateToken(overview[0].label);
    if (!t) return year;
    var wdText = overview[0].weekday;
    var wdIdx = null;
    for (var k in WD_MAP) if (WD_MAP[k] === wdText) { wdIdx = +k; break; }
    if (wdIdx === null) return year;
    for (var y = year - 1; y <= year + 1; y++) if (wdOf(t[0], t[1], y) === wdIdx) return y;
    return year;
  }

  /** 离今天最近的那一年（用于没有「本周每日一览」时推断年份） */
  function nearestYear(month, day) {
    var base = new Date(todayISO() + 'T00:00:00').getTime();
    var y0 = parseInt(todayISO().slice(0, 4), 10), best = y0, bd = Infinity;
    for (var y = y0 - 1; y <= y0 + 1; y++) {
      var d = Math.abs(new Date(y, month - 1, day).getTime() - base);
      if (d < bd) { bd = d; best = y; }
    }
    return best;
  }

  /* ---------------- sheet 命名识别（支持「第N周 + 周一…周日」写法） ---------------- */
  var WD_KEYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  var WD_ALT = {
    '周天': '周日', '星期日': '周日', '星期天': '周日', '星期曰': '周日',
    '星期一': '周一', '星期二': '周二', '星期三': '周三',
    '星期四': '周四', '星期五': '周五', '星期六': '周六'
  };
  /** 从任意文本里识别星期，统一成「周日/周一…」 */
  function normWeekday(s) {
    var t = String(s || '');
    for (var k in WD_ALT) if (t.indexOf(k) >= 0) return WD_ALT[k];
    for (var i = 0; i < WD_KEYS.length; i++) if (t.indexOf(WD_KEYS[i]) >= 0) return WD_KEYS[i];
    return null;
  }
  /**
   * 是否「周总表」
   * 规则：名字含「计划」→ 是；或形如「第一周」「第05周」「5周」→ 是。
   * 注意「周一」这类纯星期名不算（否则会被误判成周表）。
   */
  function isWeeklyName(nm) {
    var t = String(nm || '').trim();
    if (!t) return false;
    if (t.indexOf('计划') >= 0) return true;
    if (/^周[一二三四五六日天]$/.test(t)) return false;
    return /^第?\s*[0-9一二三四五六七八九十百]+\s*周$/.test(t);
  }
  /** 是否「日期子表」：名字含日期或含星期 */
  function isDailyName(nm) {
    var t = String(nm || '');
    if (parseDateToken(t)) return true;
    return !!normWeekday(t) && !isWeeklyName(t);
  }

  function kindOf(subject) {
    return (subject === '生活' || subject === '休息') ? 'rest' : 'study';
  }

  /** 解析「本周计划」总表 */
  function parseWeeklySheet(rows) {
    var W = sheetRows(rows);
    var week = {};
    week.title = (W[0] && W[0][0]) || '未命名周计划';
    week.phase = (W[1] && W[1][0]) || '';

    var iTheme = findRow(W, ['本周主题']);
    week.theme = (iTheme >= 0 && W[iTheme + 1]) ? W[iTheme + 1][0] : '';

    var iSc = findRow(W, ['目标分', '得分构成']);
    week.scoreGoals = [];
    if (iSc >= 0) {
      for (var r = iSc + 1; r < W.length; r++) {
        var row = W[r];
        if (!row[0] || /^(二|三|四|五|六)[、.]/.test(row[0]) || row[0].indexOf('目标分') >= 0) break;
        if (row[0].indexOf('科目') >= 0 || row[0].indexOf('冲分') >= 0) break;
        week.scoreGoals.push({ subject: row[0], target: row[1] || '', points: row[2] || '', done: false });
      }
    }

    var iWg = findRow(W, ['本周目标']);
    week.weekGoals = [];
    if (iWg >= 0) {
      for (var r2 = iWg + 1; r2 < W.length; r2++) {
        var row2 = W[r2];
        if (!row2[0] || /^(四|五|六)[、.]/.test(row2[0]) || row2[0].indexOf('本周目标') >= 0) break;
        if (row2[0].indexOf('科目') >= 0 || row2[0].indexOf('目标分') >= 0) break;
        week.weekGoals.push({ subject: row2[0], target: row2[1] || '', done: false });
      }
    }

    var iOv = findRow(W, ['日期', '星期', '今日重点']);
    week.overview = [];
    if (iOv >= 0) {
      for (var r3 = iOv + 1; r3 < W.length; r3++) {
        var row3 = W[r3];
        if (!row3[0] || /^(五|六)[、.]/.test(row3[0]) || row3[0].indexOf('关键节点') >= 0) break;
        if (row3[0].indexOf('日期') >= 0 || row3[0].indexOf('星期') >= 0) break;
        week.overview.push({ label: row3[0], weekday: row3[1] || '', focus: row3[2] || '', done: false });
      }
    }

    var iMs = findRow(W, ['关键节点']);
    week.milestones = [];
    if (iMs >= 0) {
      for (var r4 = iMs + 1; r4 < W.length; r4++) {
        var row4 = W[r4];
        if (!row4[0] || /^六[、.]/.test(row4[0]) || row4[0].indexOf('材料建议') >= 0) break;
        week.milestones.push(row4[0]);
      }
    }

    var iMat = findRow(W, ['材料建议']);
    week.materials = (iMat >= 0 && W[iMat + 1]) ? W[iMat + 1][0] : '';
    week.usage = (iMat >= 0 && W[iMat + 2]) ? W[iMat + 2][0] : '';
    return week;
  }

  /** 解析单张日期子表（year 可为 null → 自动取离今天最近的年份） */
  function parseDailySheet(name, rows, year) {
    var D = sheetRows(rows);
    var tok = parseDateToken(name) || (D[0] ? parseDateToken(D[0][0]) : null);
    if (!tok) return null;
    if (year == null) year = nearestYear(tok[0], tok[1]);
    var iso = year + '-' + pad2(tok[0]) + '-' + pad2(tok[1]);
    var iHead = findRow(D, ['时间段', '科目', '学习内容']);
    var items = [];
    if (iHead >= 0) {
      for (var r = iHead + 1; r < D.length; r++) {
        var row = D[r];
        if (!row[0] || row[0].indexOf('复盘') >= 0 || row[0].indexOf('完成率') >= 0) break;
        var subject = row[1] || '';
        items.push({
          time: row[0], subject: subject, content: row[2] || '', target: row[3] || '',
          kind: kindOf(subject), done: false
        });
      }
    }
    var review = '';
    D.forEach(function (row) { if (row.join('').indexOf('今日复盘') >= 0) review = row.join(''); });
    return {
      date: iso,
      label: (D[0] && D[0][0]) || name,
      focus: (D[1] && D[1][0]) || '',
      items: items,
      review: review
    };
  }

  /**
   * 解析整个工作簿 → 返回【多个】周计划
   *
   * sheet 归属规则（按工作簿里的 sheet 顺序）：
   *   1. 名字含「计划」，或形如「第一周 / 第05周 / 5周」→ 周总表
   *   2. 名字含日期（10/12、10月12日）或含星期（周一）→ 日期子表
   *   3. 只有星期的子表，归属到它【前面最近的那张周总表】，日期按该周 overview 同星期那条取
   *
   * @param {Array} sheets
   * @param {Array} [diag] 可选，收集解析警告（如某天无法确定日期）
   */
  function parseWorkbook(sheets, diag) {
    var warnings = diag || [];
    var weekly = [], dailyEntries = [], lastWi = -1;

    sheets.forEach(function (sh) {
      var nm = sh.name || '';
      if (isWeeklyName(nm)) {
        weekly.push(sh);
        lastWi = weekly.length - 1;
      } else if (isDailyName(nm)) {
        dailyEntries.push({ sh: sh, wi: lastWi });   // wi = 所属周总表下标（-1 表示前面没有周总表）
      }
    });
    if (!weekly.length && !dailyEntries.length) throw new Error('未找到「本周计划」或日期子表');

    var weeks = [];
    var parsedWeeklies = weekly.map(function (sh) { return parseWeeklySheet(sh.rows); });

    // 每张周总表的日期范围（来自 overview），用于没有明确归属时兜底
    var wMeta = parsedWeeklies.map(function (w) {
      var dates = (w.overview || []).map(function (o) { return parseDateToken(o.label); }).filter(Boolean);
      return {
        week: w,
        lo: dates.length ? Math.min.apply(null, dates.map(function (d) { return d[0] * 100 + d[1]; })) : null,
        hi: dates.length ? Math.max.apply(null, dates.map(function (d) { return d[0] * 100 + d[1]; })) : null
      };
    });

    /**
     * 解析一张日期子表的日期 token
     * 顺序：sheet 名 → 首行标签 → 所属周 overview 的同星期那条
     */
    function resolveToken(e) {
      var tok = parseDateToken(e.sh.name);
      if (tok) return tok;
      var rows = sheetRows(e.sh.rows);
      if (rows[0]) { tok = parseDateToken(rows[0][0]); if (tok) return tok; }

      var wd = normWeekday(e.sh.name);
      var w = e.wi >= 0 ? parsedWeeklies[e.wi] : null;
      if (wd && w) {
        for (var i = 0; i < (w.overview || []).length; i++) {
          var o = w.overview[i];
          if (normWeekday(o.weekday) === wd || normWeekday(o.label) === wd) {
            tok = parseDateToken(o.label);
            if (tok) return tok;
          }
        }
      }
      return null;
    }

    // 归属：优先「前面最近的周总表」，其次按日期范围就近
    var buckets = weekly.map(function () { return []; });
    var orphans = [];

    dailyEntries.forEach(function (e) {
      var tok = resolveToken(e);
      if (!tok) {
        warnings.push('「' + e.sh.name + '」无法确定日期，已跳过');
        return;
      }
      var tgt = -1;
      if (e.wi >= 0) {
        var m = wMeta[e.wi];
        var v = tok[0] * 100 + tok[1];
        if (m.lo == null || (v >= m.lo && v <= m.hi)) tgt = e.wi;   // 无 overview 时直接信归属
      }
      if (tgt < 0) {
        var v2 = tok[0] * 100 + tok[1], bestDist = Infinity;
        for (var i = 0; i < wMeta.length; i++) {
          var mm = wMeta[i];
          if (mm.lo == null) continue;
          var dist = (v2 >= mm.lo && v2 <= mm.hi) ? 0 : Math.min(Math.abs(v2 - mm.lo), Math.abs(v2 - mm.hi));
          if (dist < bestDist) { bestDist = dist; tgt = i; }
        }
      }
      if (tgt < 0 && buckets.length) tgt = 0;
      if (tgt >= 0) buckets[tgt].push({ sh: e.sh, tok: tok });
      else orphans.push({ sh: e.sh, tok: tok });
    });

    function fillWeek(w, list) {
      var y = (w.overview && w.overview.length) ? inferYear(w.overview) : null;
      w.days = [];
      list.forEach(function (ad) {
        var d = parseDailySheet(ad.sh.name, ad.sh.rows, y);
        if (d) w.days.push(d);
      });
      w.days.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      w.startDate = w.days.length ? w.days[0].date : '';
      w.endDate = w.days.length ? w.days[w.days.length - 1].date : '';
      w.id = 'w_' + (w.startDate || todayISO()).replace(/-/g, '');
      return w;
    }

    if (weekly.length) {
      parsedWeeklies.forEach(function (w, i) { weeks.push(fillWeek(w, buckets[i])); });
    }

    // 情况 B：没有周总表，或有些日期子表没归属上 → 合成一个「导入计划」周
    if (orphans.length || !weekly.length) {
      var all = orphans.slice();
      if (!weekly.length) {
        all = dailyEntries.map(function (e) {
          var tok = resolveToken(e);
          return tok ? { sh: e.sh, tok: tok } : null;
        }).filter(Boolean);
      }
      var w2 = {
        title: '导入计划', phase: '', theme: '',
        scoreGoals: [], weekGoals: [], overview: [], milestones: [], materials: '', usage: ''
      };
      w2.days = [];
      all.forEach(function (ad) {
        var d = parseDailySheet(ad.sh.name, ad.sh.rows, null);
        if (d) w2.days.push(d);
      });
      if (w2.days.length) {
        w2.days.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
        w2.startDate = w2.days[0].date;
        w2.endDate = w2.days[w2.days.length - 1].date;
        w2.id = 'w_' + w2.startDate.replace(/-/g, '');
        weeks.push(w2);
      }
    }

    weeks = weeks.filter(function (w) { return w.days.length || w.scoreGoals.length || w.weekGoals.length; });
    if (!weeks.length) throw new Error('未解析到有效计划内容');
    return weeks;
  }

  /* ---------------- 合并：重合自动合并，打卡只增不减 ---------------- */
  function itemKey(it) { return it.time + '|' + it.subject; }
  function pickLonger(a, b) {
    a = a == null ? '' : String(a);
    b = b == null ? '' : String(b);
    if (!a) return b;
    if (!b) return a;
    return b.length > a.length ? b : a;
  }

  /** 合并两个周里「非每日」的部分：目标、概览、节点、材料。不动 days。 */
  function mergeWeekMeta(newW, oldW, report) {
    function mergeGoals(a, b, key) {
      if (!Array.isArray(a) || !Array.isArray(b)) return;
      var bmap = {};
      b.forEach(function (x) { if (x && x[key] != null) bmap[x[key]] = x; });
      a.forEach(function (x) {
        if (!x) return;
        if (bmap[x[key]]) {
          x.done = !!(x.done || bmap[x[key]].done);      // 打卡只增不减
          x.target = pickLonger(x.target, bmap[x[key]].target);
          x.points = pickLonger(x.points, bmap[x[key]].points);
        }
      });
      var amap = {};
      a.forEach(function (x) { if (x && x[key] != null) amap[x[key]] = 1; });
      b.forEach(function (x) {
        if (x && x[key] != null && !amap[x[key]]) { a.push(x); report.added++; }
      });
    }
    mergeGoals(newW.scoreGoals, oldW.scoreGoals, 'subject');
    mergeGoals(newW.weekGoals, oldW.weekGoals, 'subject');

    if (Array.isArray(newW.overview) && Array.isArray(oldW.overview)) {
      var om = {};
      oldW.overview.forEach(function (o) { if (o && o.label != null) om[o.label] = o; });
      newW.overview.forEach(function (o) {
        if (o && om[o.label]) {
          o.done = !!(o.done || om[o.label].done);
          o.focus = pickLonger(o.focus, om[o.label].focus);
        }
      });
    }

    if (Array.isArray(newW.milestones) && Array.isArray(oldW.milestones)) {
      oldW.milestones.forEach(function (m) {
        if (newW.milestones.indexOf(m) < 0) { newW.milestones.push(m); report.added++; }
      });
    }
    newW.materials = pickLonger(newW.materials, oldW.materials);
    newW.usage = pickLonger(newW.usage, oldW.usage);
    newW.theme = pickLonger(newW.theme, oldW.theme);
    newW.phase = pickLonger(newW.phase, oldW.phase);
    return newW;
  }

  /**
   * 把 src 这一天并入 target 同一天（item 级）
   * 对齐键：时间段 + 科目。打卡只增不减；源里多出来的条目追加进去（按时间排序）。
   */
  function mergeDayInto(target, src, report) {
    if (!target || !src) return target;
    var imap = {};
    (target.items || []).forEach(function (it) { if (it) imap[itemKey(it)] = it; });
    (src.items || []).forEach(function (ni) {
      var oi = imap[itemKey(ni)];
      if (oi) {
        oi.done = !!(oi.done || ni.done);
        oi.content = pickLonger(oi.content, ni.content);
        oi.target = pickLonger(oi.target, ni.target);
        if (!oi.kind) oi.kind = ni.kind;
      } else {
        target.items.push(ni);
        imap[itemKey(ni)] = ni;
        report.added++;
      }
    });
    (target.items || []).sort(function (a, b) {
      var ra = parseRange(a.time), rb = parseRange(b.time);
      if (!ra || !rb) return 0;
      return ra[0] - rb[0];
    });
    if (!target.review) target.review = src.review || '';
    if (!target.focus) target.focus = src.focus || '';
    return target;
  }

  function recomputeWeekRange(w) {
    (w.days || []).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    w.startDate = w.days.length ? w.days[0].date : (w.startDate || '');
    w.endDate = w.days.length ? w.days[w.days.length - 1].date : (w.endDate || '');
    if (w.days.length) w.id = 'w_' + w.startDate.replace(/-/g, '');
    return w;
  }

  /**
   * 把导入的周并入现有周表
   *
   * 核心规则（需求2）：**按「日期」去重合并，而不是按「周」**
   * 所以 10/1-10/20 和 10/10-10/25 两个文件导入后，
   * 10/10-10/20 这段只保留一份数据，条目按 time|subject 对齐，打卡只增不减。
   *
   * report: { newWeeks, mergedWeeks, added, days, mergedDays, files }
   */
  function mergeIntoState(state, incomingWeeks, fileName) {
    var report = { newWeeks: 0, mergedWeeks: 0, added: 0, days: 0, mergedDays: 0, files: 1 };

    // 全局日期索引：date -> { week, day }（同一天只允许存在一份）
    var dayIdx = {};
    function indexWeek(w) {
      (w.days || []).forEach(function (d) {
        if (d && d.date && !dayIdx[d.date]) dayIdx[d.date] = { week: w, day: d };
      });
    }
    state.weeks.forEach(indexWeek);

    (incomingWeeks || []).forEach(function (nw) {
      var target = null;
      for (var k = 0; k < state.weeks.length; k++) {
        if (state.weeks[k].id === nw.id) { target = state.weeks[k]; break; }
      }
      if (target) { mergeWeekMeta(target, nw, report); report.mergedWeeks++; }

      var kept = [];
      (nw.days || []).forEach(function (nd) {
        var hit = dayIdx[nd.date];
        if (hit) { mergeDayInto(hit.day, nd, report); report.mergedDays++; }
        else kept.push(nd);
      });
      report.days += (nw.days || []).length;

      if (!target) {
        // 全新的周：只保留没被别的周占用的日子
        var hasMeta = (nw.weekGoals || []).length || (nw.scoreGoals || []).length ||
                      (nw.overview || []).length || (nw.milestones || []).length;
        if (!kept.length && !hasMeta) return;
        nw.days = kept;
        recomputeWeekRange(nw);
        if (fileName) nw.src = fileName;    // 记下这份周是哪次导入带来的
        state.weeks.push(nw);
        report.newWeeks++;
        target = nw;
      } else if (kept.length) {
        // 已有的周，但新文件带来了它没有的日子 → 追加
        target.days = (target.days || []).concat(kept);
        recomputeWeekRange(target);
      }
      kept.forEach(function (d) { dayIdx[d.date] = { week: target, day: d }; });
    });

    state.weeks.sort(function (a, b) { return a.startDate < b.startDate ? -1 : 1; });
    // 清掉因为日子被别人接走而变空的周
    state.weeks = state.weeks.filter(function (w) {
      return (w.days && w.days.length) || (w.scoreGoals && w.scoreGoals.length) || (w.weekGoals && w.weekGoals.length);
    });
    return report;
  }


  /** 从 localStorage 恢复：SEED 与旧数据合并（沿用原版 mergeWeeks 语义，打卡只增不减） */
  function mergeSeedWithOld(seedWeeks, oldWeeks) {
    var state = { weeks: JSON.parse(JSON.stringify(seedWeeks || [])) };
    if (!oldWeeks || !oldWeeks.length) return state;
    var report = { newWeeks: 0, mergedWeeks: 0, added: 0, days: 0, files: 0 };
    mergeIntoState(state, oldWeeks, 'local');
    return state.weeks;
  }

  /* ---------------- 导出：每天一个 sheet ---------------- */
  function sanitizeSheetName(name, used) {
    var s = String(name || 'Sheet').replace(/[\[\]\*\?\/\\:]/g, '-').slice(0, 31) || 'Sheet';
    var base = s, i = 2;
    while (used[s]) { s = base.slice(0, 28) + '_' + i; i++; }
    used[s] = 1;
    return s;
  }
  function colName(idx) {
    var s = ''; idx = idx + 1;
    while (idx > 0) { var r = (idx - 1) % 26; s = String.fromCharCode(65 + r) + s; idx = Math.floor((idx - 1) / 26); }
    return s;
  }
  function zipWrite(files) {
    var chunks = [], central = [], offset = 0;
    var now = new Date();
    var dosTime = ((now.getHours() & 31) << 11) | ((now.getMinutes() & 63) << 5) | ((now.getSeconds() / 2) & 31);
    var dosDate = (((now.getFullYear() - 1980) & 127) << 9) | (((now.getMonth() + 1) & 15) << 5) | (now.getDate() & 31);
    for (var i = 0; i < files.length; i++) {
      var nb = encUtf8(files[i].name), data = files[i].data, c = crc32(data);
      var lh = new Uint8Array(30 + nb.length), lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, 0, true);
      lv.setUint16(10, dosTime, true); lv.setUint16(12, dosDate, true);
      lv.setUint32(14, c, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
      lv.setUint16(26, nb.length, true); lv.setUint16(28, 0, true);
      lh.set(nb, 30);
      chunks.push(lh); chunks.push(data);
      var ch = new Uint8Array(46 + nb.length), cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true); cv.setUint16(12, dosTime, true); cv.setUint16(14, dosDate, true);
      cv.setUint32(16, c, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
      cv.setUint16(28, nb.length, true); cv.setUint32(42, offset, true);
      ch.set(nb, 46);
      central.push(ch);
      offset += lh.length + data.length;
    }
    var cdSize = 0;
    for (var k = 0; k < central.length; k++) cdSize += central[k].length;
    var eo = new Uint8Array(22), ev = new DataView(eo.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
    var all = chunks.concat(central); all.push(eo);
    var total = 0;
    for (var t = 0; t < all.length; t++) total += all[t].length;
    var out = new Uint8Array(total), p = 0;
    for (var t2 = 0; t2 < all.length; t2++) { out.set(all[t2], p); p += all[t2].length; }
    return out;
  }
  var STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="12"/><name val="Calibri"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF2F4F8"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left style="thin"><color rgb="FFB8C0CC"/></left><right style="thin"><color rgb="FFB8C0CC"/></right>' +
    '<top style="thin"><color rgb="FFB8C0CC"/></top><bottom style="thin"><color rgb="FFB8C0CC"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>' +
    '</cellXfs></styleSheet>';

  function sheetXml(rows, widths) {
    var out = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
    if (widths && widths.length) {
      out += '<cols>';
      for (var c = 0; c < widths.length; c++) {
        out += '<col min="' + (c + 1) + '" max="' + (c + 1) + '" width="' + widths[c] + '" customWidth="1"/>';
      }
      out += '</cols>';
    }
    out += '<sheetData>';
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r] || [];
      out += '<row r="' + (r + 1) + '">';
      for (var c2 = 0; c2 < row.length; c2++) {
        var v = row[c2];
        if (v == null || v === '') continue;
        out += '<c r="' + colName(c2) + (r + 1) + '" t="inlineStr"' + (r === 0 ? ' s="1"' : '') +
          '><is><t xml:space="preserve">' + escXml(v) + '</t></is></c>';
      }
      out += '</row>';
    }
    out += '</sheetData></worksheet>';
    return out;
  }

  /** 把一个 week 转成 sheet 列表：1 个「本周计划」总表 + N 个每日 sheet */
  function weekToSheets(week) {
    var out = [];
    // 总表
    var W = [];
    W.push([week.title || '周计划']);
    W.push([week.phase || '']);
    W.push(['一、本周主题']);
    W.push([week.theme || '']);
    W.push(['二、四科冲分目标']);
    W.push(['科目', '目标分', '得分构成', '完成情况']);
    (week.scoreGoals || []).forEach(function (g) {
      W.push([g.subject, g.target, g.points, g.done ? '√' : '□']);
    });
    W.push(['三、本周各科目标']);
    W.push(['科目', '本周目标', '完成情况']);
    (week.weekGoals || []).forEach(function (g) {
      W.push([g.subject, g.target, g.done ? '√' : '□']);
    });
    W.push(['四、本周每日一览']);
    W.push(['日期', '星期', '今日重点', '完成情况']);
    (week.overview || []).forEach(function (o) {
      W.push([o.label, o.weekday, o.focus, o.done ? '√' : '□']);
    });
    W.push(['五、关键节点 / 提醒']);
    (week.milestones || []).forEach(function (m) { W.push([m]); });
    W.push(['六、材料建议']);
    W.push([week.materials || '']);
    W.push(['使用说明：' + (week.usage || '')]);
    out.push({ name: '本周计划', rows: W, widths: [16, 14, 60, 12] });

    // 每日 sheet
    (week.days || []).forEach(function (d) {
      var rows = [];
      rows.push([d.label || d.date]);
      rows.push([d.focus || '']);
      rows.push(['时间段', '科目', '学习内容（具体任务）', '掌握目标 / 检验标准', '完成情况']);
      (d.items || []).forEach(function (it) {
        rows.push([it.time, it.subject, it.content, it.target, it.done ? '√' : '□']);
      });
      rows.push([d.review || '今日复盘：完成率＿＿%｜未完成项：＿＿＿＿＿＿｜明日改进：＿＿＿＿＿＿']);
      out.push({ name: d.date.slice(5).replace('-', '-') + ' ' + weekdayOf(d.date), rows: rows, widths: [14, 10, 46, 30, 12] });
    });
    return out;
  }
  function weekdayOf(iso) {
    var d = new Date(iso + 'T00:00:00');
    return WD_MAP[d.getDay()];
  }

  /** 生成 xlsx（每天一个 sheet） */
  function buildXlsx(weeks) {
    var all = [], used = {};
    weeks.forEach(function (w) {
      weekToSheets(w).forEach(function (s) {
        all.push({ name: sanitizeSheetName(s.name, used), rows: s.rows, widths: s.widths });
      });
    });
    if (!all.length) return null;

    var defs = all.map(function (s, i) { return { name: s.name, rid: 'rId' + (i + 1) }; });
    var files = [];
    for (var i = 0; i < all.length; i++) {
      files.push({
        name: 'xl/worksheets/sheet' + (i + 1) + '.xml',
        data: encUtf8(sheetXml(all[i].rows, all[i].widths))
      });
    }
    var wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>';
    defs.forEach(function (d, i) {
      wb += '<sheet name="' + escXml(d.name) + '" sheetId="' + (i + 1) + '" r:id="' + d.rid + '"/>';
    });
    wb += '</sheets></workbook>';

    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';
    defs.forEach(function (d, i) {
      rels += '<Relationship Id="' + d.rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
    });
    rels += '</Relationships>';

    var ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
    for (var k = 0; k < defs.length; k++) {
      ct += '<Override PartName="/xl/worksheets/sheet' + (k + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
    }
    ct += '</Types>';

    var rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';

    files.push({ name: '[Content_Types].xml', data: encUtf8(ct) });
    files.push({ name: '_rels/.rels', data: encUtf8(rootRels) });
    files.push({ name: 'xl/workbook.xml', data: encUtf8(wb) });
    files.push({ name: 'xl/_rels/workbook.xml.rels', data: encUtf8(rels) });
    files.push({ name: 'xl/styles.xml', data: encUtf8(STYLES_XML) });
    return zipWrite(files);
  }

  /* ---------------- 每日时间轴布局（左侧时间轴 + 冲突分列 + 同时段叠行） ---------------- */
  var MAX_LANES = 4;

  /** "08:00-10:00" → [480, 600]（分钟）；解析不出返回 null */
  function parseRange(str) {
    var m = String(str == null ? '' : str).match(/(\d{1,2})\s*[:：]\s*(\d{2})\s*[-~—－–]\s*(\d{1,2})\s*[:：]\s*(\d{2})/);
    if (!m) return null;
    var s = (+m[1]) * 60 + (+m[2]);
    var e = (+m[3]) * 60 + (+m[4]);
    if (e <= s) e = s + 30;          // 起止写反或零时长 → 兜底 30 分钟，避免高度为 0
    return [s, e];
  }

  /**
   * 把一天的 items 排成「时间纵轴 + 并列列」的版面
   *
   * 规则：
   *   1. 无冲突 → 占满整行宽度，高度 = 时长
   *   2. 有时间重叠 → 该冲突簇内均分为 N 列（N ≤ 4）
   *   3. 起止时间完全相同 → 不拆列，合并成一个块，块内上下叠行（≤ 4 行）
   *   4. 超过 4 个并行 → 多出来的塞进第 4 列并标记 overflow（不丢数据）
   *
   * 返回的 top / dur 单位是「分钟」，渲染时乘以像素比例即可。
   */
  function layoutDay(items) {
    var evs = [], unresolved = [];
    (items || []).forEach(function (it, i) {
      var r = parseRange(it && it.time);
      if (!r) { unresolved.push({ idx: i, item: it }); return; }
      evs.push({ idx: i, item: it, s: r[0], e: r[1] });
    });
    evs.sort(function (a, b) { return a.s - b.s || b.e - a.e || a.idx - b.idx; });

    // 起止完全相同 → 合成一组
    var groups = [], gmap = {};
    evs.forEach(function (ev) {
      var k = ev.s + ':' + ev.e;
      if (gmap[k]) { gmap[k].members.push(ev); return; }
      var g = { s: ev.s, e: ev.e, members: [ev], lane: 0, overflow: false, cluster: null };
      gmap[k] = g;
      groups.push(g);
    });

    // 重叠簇
    var clusters = [], cur = null;
    groups.forEach(function (g) {
      if (!cur || g.s >= cur.end) { cur = { start: g.s, end: g.e, groups: [], lanes: 1 }; clusters.push(cur); }
      cur.groups.push(g);
      if (g.e > cur.end) cur.end = g.e;
      g.cluster = cur;
    });

    // 簇内分列：放进「已经空出来」的第一列
    clusters.forEach(function (c) {
      var laneEnd = [];
      c.groups.forEach(function (g) {
        var put = -1;
        for (var i = 0; i < laneEnd.length; i++) if (laneEnd[i] <= g.s) { put = i; break; }
        if (put < 0) {
          if (laneEnd.length < MAX_LANES) { laneEnd.push(g.e); put = laneEnd.length - 1; }
          else { put = MAX_LANES - 1; g.overflow = true; }
        } else {
          laneEnd[put] = Math.max(laneEnd[put], g.e);
        }
        g.lane = put;
      });
      c.lanes = Math.max(1, Math.min(MAX_LANES, laneEnd.length));
    });

    // 时间窗：向下/向上取整到整点
    var minS = 24 * 60, maxE = 0;
    evs.forEach(function (ev) { if (ev.s < minS) minS = ev.s; if (ev.e > maxE) maxE = ev.e; });
    if (!evs.length) { minS = 8 * 60; maxE = 22 * 60; }
    var startMin = Math.floor(minS / 60) * 60;
    var endMin = Math.ceil(maxE / 60) * 60;
    if (endMin - startMin < 60) endMin = startMin + 60;

    var blocks = groups.map(function (g) {
      return {
        s: g.s, e: g.e, dur: g.e - g.s,
        top: g.s - startMin,
        lane: g.lane,
        lanes: g.cluster ? g.cluster.lanes : 1,
        overflow: g.overflow,
        stack: g.members.length,
        members: g.members.map(function (m) { return { idx: m.idx, item: m.item }; })
      };
    });

    return {
      startMin: startMin, endMin: endMin,
      startHour: startMin / 60, endHour: endMin / 60,
      blocks: blocks, unresolved: unresolved, count: evs.length
    };
  }

  return {
    // 解析
    neededEntries: neededEntries,
    parseTexts: parseTexts,
    parseWorkbook: parseWorkbook,
    parseWeeklySheet: parseWeeklySheet,
    parseDailySheet: parseDailySheet,
    isWeeklyName: isWeeklyName,
    isDailyName: isDailyName,
    normWeekday: normWeekday,
    // 合并
    mergeIntoState: mergeIntoState,
    mergeSeedWithOld: mergeSeedWithOld,
    mergeWeekMeta: mergeWeekMeta,
    mergeDayInto: mergeDayInto,
    // 时间轴布局
    layoutDay: layoutDay,
    parseRange: parseRange,
    MAX_LANES: MAX_LANES,
    // 导出
    buildXlsx: buildXlsx,
    weekToSheets: weekToSheets,
    // 工具
    todayISO: todayISO,
    WD_MAP: WD_MAP,
    weekdayOf: weekdayOf,
    crc32: crc32,
    esc: esc
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = OPS;