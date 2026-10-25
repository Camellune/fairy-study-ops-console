/*
 * 路径总表：所有构建/测试脚本共用这里
 * 以后要调整目录结构，只改这个文件即可
 *
 * 目录约定：
 *   学习/
 *   ├─ 交付/          ← 交付物（用户验收只看这里）
 *   ├─ 备考资料/      ← pdf、计划表、学习手册
 *   ├─ 参赛_1024/     ← 参赛材料
 *   ├─ 开发/          ← 源码、脚本、打包工程（_build / _desktop）
 *   └─ 归档/          ← 作废版本
 */
const path = require('path');
const { pathToFileURL } = require('url');

const BUILD = __dirname;                       // 开发/_build
const DEV = path.resolve(BUILD, '..');         // 开发
const WS = path.resolve(DEV, '..');            // 学习

const DELIVER = path.join(WS, '交付');
const DESKTOP = path.join(DELIVER, 'Fairy_桌面版');

module.exports = {
  WS,
  DEV,
  BUILD,
  DELIVER,
  CONTEST: path.join(WS, '参赛_1024'),
  ARCHIVE: path.join(WS, '归档'),

  // 交付物
  APP_HTML: path.join(DELIVER, 'Fairy.html'),          // 发行版：不含第三方皮肤图
  APP_HTML_LOCAL: path.join(DELIVER, 'Fairy_本地版.html'), // 本地版：内联官方皮肤
  APP_URL: pathToFileURL(path.join(DELIVER, 'Fairy.html')).href,
  APP_URL_LOCAL: pathToFileURL(path.join(DELIVER, 'Fairy_本地版.html')).href,
  DESKTOP,
  DESKTOP_EXE: path.join(DESKTOP, 'Fairy.exe'),
  SAMPLE_XLSX: path.join(DELIVER, '示例_第06周计划.xlsx'),
  TEMPLATE_XLSX: path.join(DELIVER, '计划表模板.xlsx'),
  PROMPT_MD: path.join(DELIVER, '计划表导入格式_提示词.md'),

  // 打包工程
  DESKTOP_SRC: path.join(DEV, '_desktop'),
  ELECTRON_DIST: path.join(DEV, '_desktop', 'node_modules', 'electron', 'dist'),

  // 测试临时产物（统一放 out/，避免散落）
  OUT_DIR: path.join(BUILD, 'out'),
  DEMO_XLSX: path.join(BUILD, 'demo_conflict.xlsx')
};
