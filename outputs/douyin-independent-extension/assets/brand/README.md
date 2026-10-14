# ClipQuill 品牌资源

本目录 SVG 是根据 2026-10-14 用户提供的羽毛笔＋播放符号参考重新绘制的矢量源，不是从海报裁图。使用 `#4F8CFF → #8B5CF6` 渐变，不包含文字或其他产品标识。

- `clipquill-logo.svg`：透明背景主图形，用于页面品牌。
- `clipquill-logo-small.svg`：16/32px 母版，加粗左侧视频轮廓与羽毛分隔，减少羽片切口。
- `../../icons/icon16.png`、`icon32.png`、`icon48.png`、`icon128.png`：深色中性底板的扩展 PNG，manifest 和 action 使用这些文件。
- `../../icons/favicon16.png`、`favicon32.png`：透明背景小尺寸 favicon。

在仓库根目录运行 `node scripts/render_clipquill_icons.cjs` 可重新导出全部 PNG。该开发命令需要可用的 `sharp`；扩展运行不依赖它，也没有新增依赖或升级锁文件。Codex 工作区已有 `sharp` 时，可将 `load_workspace_dependencies` 返回的 Node packages 路径设为 `NODE_PATH` 再运行。

导出脚本同时生成 `docs/ui-redesign/screenshots/brand-icons-actual-size.png`，在浅、深背景以实际 16/32/48/128px 显示图标，并展示小尺寸透明图形。它是资产检查图，不是运行中扩展截图。已人工查看该图；PNG 尺寸、格式和 favicon alpha 已检查。Chrome 原生工具栏与管理页的真实显示仍需扩展环境验收。

本轮只更新自有页面资源、manifest 名称/描述和图标；不改变 Chrome 原生标签样式、网页标题或浏览器主题。
