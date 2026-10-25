# assets · 素材目录

本目录在仓库中**保持为空**，用于存放构建与运行需要、但**不应随仓库分发**的素材。

## 会被自动忽略的内容

`.gitignore` 已排除：

- `assets/skin/` —— 官方角色立绘（用于自用版背景皮肤）
- `assets/bangboo/` —— 官方邦布设定图切出的 15 只贴图

## 为什么排除

《绝区零》相关美术素材版权归米哈游所有。本项目为**非商业学习工具**，
不获取、不再分发任何第三方素材。详见根目录 [`DISCLAIMER.md`](../DISCLAIMER.md) 第二节。

## 自行获取（仅供个人学习）

仓库在 `tools/` 下提供两个脚本，它们从**官方公开渠道**抓取素材并做本地处理：

```bash
cd tools
node make-skin.mjs      # 背景皮肤（角色立绘）→ assets/skin/sunbringer.jpg
node make-bangboo.mjs   # 邦布贴图 15 只   → assets/bangboo/bb-00…bb-14.png
```

两个脚本都依赖 **playwright + 本机 Edge**（本机无 Pillow / sharp，用浏览器 canvas 替代图像处理）。

运行后：

- 素材只会保存在你本机的 `assets/` 下，**不会**被提交；
- 发行版构建 `node build-ops.js` **不会**引用它们（零第三方素材）；
- 自用版构建 `node build-ops.js --skin` 会内联它们，供个人学习使用。

再次提醒：获取到的素材仅限个人学习与非商业用途，请自行确保使用方式合规。
