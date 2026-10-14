# S3 视觉检查点与后续接续

当前源码已实施 S0–S3；停在第一次视觉检查点。S4–S6 未自动开始。先看 [实施记录](implementation-log.md)、[验证报告与截图](qa-report.md)、[基线](baseline.md) 和当前 Git diff，再结合用户反馈继续。

## 现在查看

隔离预览：`http://127.0.0.1:4176/tool.html?state=complete`，如未运行：

```sh
python3 scripts/ui-preview/server.py --port 4176
```

这是运行真实页面代码的 fixture；不操作 Chrome、抖音、本地服务或真实文案。空态使用 `?state=empty`。不要把 fixture.js 引入生产 HTML/manifest。

真实源码入口：`outputs/douyin-independent-extension/tool.html`；action 仍打开它。原生扩展须从 Chrome 扩展管理对**原扩展**重新加载，再打开工具页，不卸载、不清数据、不换 ID。如果 Chrome 当前加载的是安装器复制到 Application Support 的副本，仓库修改不会自动更新该副本；先核对原加载目录及既有升级方式。本轮没有覆盖安装目录、重新安装或重新打包。自动工具不能访问扩展 URL，真实扩展加载/验收需在下一次人工检查完成。

## 关键文件

- `tool.html`：原入口的布局与原 ID；`tool.css`：tokens、深浅主题、断点与滚动；`tool.js`：少量显示/保存/连接/导航适配。
- `theme-init.js`：首次主题、系统/显式偏好、持久化与同步；唯一新主题键 `clipquill.ui.theme.v1`。
- `manifest.json`、`assets/brand/`、`icons/`：品牌配置与重绘资源。
- `scripts/render_clipquill_icons.cjs`：图标导出；Heroicons 的 `assets/ui/LICENSE` 随包保留。
- `scripts/extension-tests/theme.test.mjs`、`tool-page.test.mjs`：主题与既有页面业务契约回归。
- `scripts/ui-preview/`：独立测试服务器与 fixture，不进入扩展运行包。
- 本目录的 `ClipQuill_UI_Handoff_2026-10-14/`：用户材料原样副本。

## 本轮保持不变

原权限、身份、version 0.1.5、background 入口、消息 action、8766 端口、下载策略、模型、音频处理与对齐、视频复用、draft/review 算法、所有旧 storage key。原发布 ZIP 与安装版副本均未修改。未提交、推送、发布或清理用户数据。

## S4–S6 待办

1. 用户确认蓝紫羽毛笔、宽/窄布局、浅色与深色方向后，S4 在真实扩展中验证来源、多作品、登录/验证、独立下载/提取、复用、服务冷启动/离线/轮询中断/迟到响应。只映射实际协议，不发明进度或取消。
2. S5 完成真实 IME、撤销/重做及其 SRT 映射、长稿、保存失败、恢复/重新识别覆盖保护、剪贴板与实际导出、原音回听/模型对照。保留已有源时间和当前稿，不重写底层算法；确需重写先报告。
3. S6 完整矩阵：真实 MV3 CSP/存储/消息、Chrome 工具栏和 favicon、200% 缩放、键盘焦点、系统主题首屏、设备兼容与最终视觉精修。没有条件的项目写具体未验证原因。

## 回退边界

基线提交 `e3dadaa5cdc43f80dbed44afadb87952a0587fcf`。先保存/审查当前工作区，再只恢复本轮 tool.html/tool.css/tool.js/manifest 的对应差异，按需移除本轮新增品牌/主题引用；不要全库 reset、clean 或覆盖后来用户改动。旧代码会忽略新主题键；不需要删存储，不做数据迁移。未执行回退。
