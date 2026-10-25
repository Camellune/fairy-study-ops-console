/* 把 Electron 运行时 + 单文件应用打包成一个免安装的绿色目录 */
const fs = require('fs');
const path = require('path');

const P = require('../_build/paths.js');
const DIST = P.ELECTRON_DIST;        // 开发/_desktop/node_modules/electron/dist
const SRC = P.DESKTOP_SRC;           // 开发/_desktop
const OUT = P.DESKTOP;               // 交付/Fairy_桌面版
const EXE = 'Fairy.exe';

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name), d = path.join(dst, name);
    const st = fs.statSync(s);
    if (st.isDirectory()) copyDir(s, d);
    else if (st.isFile()) fs.copyFileSync(s, d);       // 已存在则覆盖
  }
}

if (!fs.existsSync(DIST)) {
  console.error('找不到 Electron 运行时：' + DIST);
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });

console.log('复制运行时…');
copyDir(DIST, OUT);

// electron.exe → 我们的名字
const srcExe = path.join(OUT, 'electron.exe');
const dstExe = path.join(OUT, EXE);
if (fs.existsSync(srcExe)) {
  if (fs.existsSync(dstExe)) fs.unlinkSync(dstExe);
  fs.renameSync(srcExe, dstExe);
}

/*
 * 改 exe 自身的图标与版本信息
 *
 * 为什么要这一步：任务栏固定项、Alt-Tab、文件属性里显示的图标和名称，
 * 读的都是 **exe 的 PE 资源**，不是 resources/app/icon.ico，也不是 BrowserWindow 的 icon 选项。
 * 我们只是把 electron.exe 改了名，所以不处理的话固定到任务栏会显示
 * Electron 的原子图标和「Electron」这个名字。
 *
 * rcedit 是 electron-builder 内部同款工具，这里单独装 1.1.1 版（二进制内置，不需要联网下载）。
 */
function stampExe(exePath) {
  const rcedit = path.join(SRC, 'node_modules', 'rcedit', 'bin', 'rcedit.exe');
  const ico = path.join(SRC, 'icon.ico');
  if (!fs.existsSync(rcedit)) {
    console.warn('  ⚠ 缺少 rcedit，跳过 exe 图标/版本信息');
    console.warn('    修复：cd 开发/_desktop && npm i rcedit@1.1.1');
    return false;
  }
  if (!fs.existsSync(ico)) {
    console.warn('  ⚠ 缺少 icon.ico，跳过 exe 图标');
    return false;
  }
  // 先确认没被占用，否则 rcedit 会静默改不动
  try {
    fs.closeSync(fs.openSync(exePath, 'r+'));
  } catch (e) {
    console.warn('  ⚠ exe 正在被占用，无法写入图标/版本信息');
    console.warn('    请先关闭 Fairy 应用，再重新运行本脚本');
    return false;
  }

  const args = [
    exePath,
    '--set-icon', ico,
    '--set-version-string', 'ProductName', 'Fairy',
    '--set-version-string', 'FileDescription', 'Fairy',
    '--set-version-string', 'CompanyName', 'Fairy',
    '--set-version-string', 'LegalCopyright', 'Fairy',
    '--set-version-string', 'InternalName', 'Fairy',
    '--set-version-string', 'OriginalFilename', EXE,
    '--set-file-version', '1.0.0.0',
    '--set-product-version', '1.0.0.0'
  ];
  const r = require('child_process').spawnSync(rcedit, args, { encoding: 'utf8' });
  if (r.status !== 0) {
    console.warn('  ⚠ rcedit 执行失败：' + String(r.stderr || r.error || '').trim());
    return false;
  }
  return true;
}

console.log('写入 exe 图标与版本信息…');
const stamped = stampExe(dstExe);
console.log(stamped ? '  图标 + 版本信息已写入 exe' : '  → 未写入（见上方提示）');

// 应用放在 resources/app
const APP = path.join(OUT, 'resources', 'app');
fs.mkdirSync(APP, { recursive: true });
fs.copyFileSync(path.join(SRC, 'main.js'), path.join(APP, 'main.js'));
fs.copyFileSync(path.join(SRC, 'preload.js'), path.join(APP, 'preload.js'));
fs.copyFileSync(path.join(SRC, 'icon.ico'), path.join(APP, 'icon.ico'));
fs.copyFileSync(path.join(SRC, 'icon.png'), path.join(APP, 'icon.png'));
// 桌面版是「本地版」：优先用带内置皮肤的 Fairy_本地版.html，没构建过则退回发行版
const appHtml = fs.existsSync(P.APP_HTML_LOCAL) ? P.APP_HTML_LOCAL : P.APP_HTML;
fs.copyFileSync(appHtml, path.join(APP, 'index.html'));

fs.writeFileSync(path.join(APP, 'package.json'), JSON.stringify({
  name: 'fairy',
  productName: 'Fairy',
  version: '1.0.0',
  description: 'Fairy · 考研每日计划与学习计时',
  main: 'main.js',
  author: '柒月Cyan'
}, null, 2));

// 原来的默认应用壳不再需要
const defApp = path.join(OUT, 'resources', 'default_app.asar');
if (fs.existsSync(defApp)) { try { fs.unlinkSync(defApp); } catch (e) { /* 留着也不影响 */ } }

fs.writeFileSync(path.join(OUT, '使用说明.txt'), [
  'Fairy · 桌面版',
  '',
  '用法',
  '  1. 双击「' + EXE + '」直接打开，无需安装。',
  '  2. 想放桌面：右键这个 exe → 发送到 → 桌面快捷方式。',
  '  3. 数据存在本机（应用自己的用户目录），和浏览器版互不影响。',
  '     想在两个版本之间搬数据，用页面顶部的「备份」导出 JSON，再在另一个里「恢复」。',
  '',
  '快捷键',
  '  Ctrl + =  放大      Ctrl + -  缩小      Ctrl + 0  还原',
  '  F11       全屏',
  '',
  '说明',
  '  整个目录要一起保留（exe 依赖同目录的 dll / resources），不能只拷 exe。',
  '  卸载 = 直接删掉整个目录。',
  ''
].join('\r\n'), 'utf8');

function sizeOf(p) {
  let s = 0;
  for (const n of fs.readdirSync(p)) {
    const f = path.join(p, n), st = fs.statSync(f);
    s += st.isDirectory() ? sizeOf(f) : st.size;
  }
  return s;
}
console.log('打包完成：' + OUT);
console.log('体积约 ' + (sizeOf(OUT) / 1048576).toFixed(0) + ' MB');
console.log('可执行文件：' + dstExe);
