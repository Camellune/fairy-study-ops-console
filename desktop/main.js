const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// 单实例：双击第二次时聚焦已有窗口，避免两份数据打架
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

// 任务栏分组标识
// 不设置时 Windows 会把本应用和所有其它 Electron 应用归到「Electron」一组，
// 任务栏固定项上就会显示成 Electron 的名字和原子图标。
// 这个 ID 一旦定了就别再改，否则已经固定在任务栏的那一项会失效、需要重新固定。
app.setAppUserModelId('com.fairy.studyops');

/**
 * 改名迁移：旧版叫「考研计划作战台」，Electron 的 userData 目录跟着 productName 走，
 * 直接改名会让升级后的应用读不到旧目录，用户会以为打卡和番茄记录全丢了。
 * 这里在 ready 之前把旧目录整体复制到新目录（只在新目录不存在时做一次）。
 */
(function migrateLegacyUserData() {
  try {
    const cur = app.getPath('userData');                    // …/AppData/Roaming/Fairy
    const legacy = path.join(app.getPath('appData'), '考研计划作战台');
    if (cur === legacy) return;
    if (fs.existsSync(cur)) return;                          // 新目录已有数据，不覆盖
    if (!fs.existsSync(legacy)) return;                      // 没有旧数据，正常首次启动
    fs.cpSync(legacy, cur, { recursive: true });
  } catch (e) {
    // 迁移失败不阻断启动，用户仍可正常使用（只是看不到旧数据）
  }
})();

const STATE_FILE = () => path.join(app.getPath('userData'), 'window-state.json');

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8'));
  } catch (e) {
    return { width: 1460, height: 940 };
  }
}

function saveState(win) {
  try {
    if (!win || win.isDestroyed()) return;
    const b = win.getNormalBounds();
    fs.writeFileSync(STATE_FILE(), JSON.stringify({ width: b.width, height: b.height, x: b.x, y: b.y }));
  } catch (e) { /* 窗口状态存不下不影响使用 */ }
}

let mainWin = null;

function createWindow() {
  const st = loadState();
  mainWin = new BrowserWindow({
    width: st.width || 1460,
    height: st.height || 940,
    x: st.x,
    y: st.y,
    minWidth: 380,
    minHeight: 560,
    backgroundColor: '#0a0a0a',
    title: 'Fairy',
    icon: path.join(__dirname, 'icon.ico'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  Menu.setApplicationMenu(null);

  /*
   * 任务栏显示名与图标（Windows 专属）
   *
   * setAppUserModelId 只负责「分组 ID」，它决定本应用会不会和别的 Electron 程序并成一组，
   * **不负责显示名**。任务栏右键菜单上那个名字/图标，来自窗口的 System.AppUserModel.* 属性，
   * 要用 setAppDetails 显式设置，否则即使 exe 的 FileDescription 已经改成 Fairy，
   * 系统仍然会回退显示 "Electron" + 原子图标。
   */
  if (process.platform === 'win32') {
    try {
      mainWin.setAppDetails({
        appId: 'com.fairy.studyops',
        appIconPath: path.join(__dirname, 'icon.ico'),
        appIconIndex: 0,
        relaunchDisplayName: 'Fairy'
      });
    } catch (e) {
      // 老系统（Win7）不支持这个 API，失败不影响使用
    }
  }

  mainWin.loadFile(path.join(__dirname, 'index.html'));
  mainWin.once('ready-to-show', () => mainWin.show());

  // 站内跳转保持在应用内，外部链接交给系统浏览器
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWin.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  // 无菜单栏，补上缩放快捷键
  mainWin.webContents.on('before-input-event', (e, input) => {
    if (input.control && (input.key === '=' || input.key === '+')) {
      mainWin.webContents.setZoomLevel(mainWin.webContents.getZoomLevel() + 0.5);
      e.preventDefault();
    } else if (input.control && input.key === '-') {
      mainWin.webContents.setZoomLevel(mainWin.webContents.getZoomLevel() - 0.5);
      e.preventDefault();
    } else if (input.control && input.key === '0') {
      mainWin.webContents.setZoomLevel(0);
      e.preventDefault();
    } else if (input.key === 'F11') {
      mainWin.setFullScreen(!mainWin.isFullScreen());
      e.preventDefault();
    }
  });

  mainWin.on('close', () => saveState(mainWin));
  mainWin.on('closed', () => { mainWin = null; closeMiniWindow(); });
}

/* ============================================================
   番茄钟置顶小窗
   页面里的 position:fixed 只能保证不被自己的滚动带走，
   切到别的应用就会被盖住。要「始终浮在最上层」必须开一个原生窗口，
   并设 alwaysOnTop + 'screen-saver' 层级（比普通置顶更高）。
   ============================================================ */
let miniWin = null;

function createMiniWindow() {
  if (miniWin && !miniWin.isDestroyed()) {
    miniWin.show();
    miniWin.focus();
    return miniWin;
  }

  miniWin = new BrowserWindow({
    width: 210,
    height: 158,
    minWidth: 150,
    minHeight: 120,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  // 'screen-saver' 是最高常规层级，能盖住大多数其它窗口
  miniWin.setAlwaysOnTop(true, 'screen-saver');
  miniWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  Menu.setApplicationMenu(null);

  // ?mini=1 → 页面进入极简模式，只渲染那个计时小组件
  miniWin.loadFile(path.join(__dirname, 'index.html'), { search: 'mini=1' });
  miniWin.once('ready-to-show', () => miniWin.show());

  miniWin.on('closed', () => { miniWin = null; });
  return miniWin;
}

function closeMiniWindow() {
  if (miniWin && !miniWin.isDestroyed()) miniWin.close();
  miniWin = null;
}

function miniIsOpen() {
  return !!(miniWin && !miniWin.isDestroyed() && miniWin.isVisible());
}

ipcMain.handle('pomo-mini:toggle', (e, on) => {
  if (on) createMiniWindow();
  else closeMiniWindow();
  return miniIsOpen();
});

ipcMain.handle('pomo-mini:state', () => miniIsOpen());

app.on('second-instance', () => {
  if (mainWin) {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.focus();
  }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
