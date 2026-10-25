/*
 * preload：把「置顶小窗」的能力暴露给页面
 *
 * 为什么需要它：浏览器页面里的 position:fixed 只能保证在自己的页面内不被滚动带走，
 * 一旦切到别的应用（浏览器、PDF、视频），页面就被盖住了。
 * 要做到「始终浮在最上层」，只能由 Electron 主进程创建一个 alwaysOnTop 的原生小窗口。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fairyDesktop', {
  // 页面用它判断「我是不是在桌面版里」，网页版没有这个对象
  isDesktop: true,

  /** 开关置顶小窗，返回小窗当前是否打开 */
  toggleMini: function (on) {
    return ipcRenderer.invoke('pomo-mini:toggle', !!on);
  },

  /** 查询当前状态（页面重载后恢复勾选态用） */
  isMiniOpen: function () {
    return ipcRenderer.invoke('pomo-mini:state');
  }
});
