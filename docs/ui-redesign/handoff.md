# ClipQuill S4–S6 接续与交接

2026-10-14。本轮已完成 S4/S5 前端实现和可运行回归，并执行 S6 的自动化、静态、隔离浏览器与截图检查。**真实扩展与人工门槛未完成，不能宣称全部验收通过。**

开始时 HEAD 是已提交的 S3 `81f0672f73607fc54541ee83e3c8eb27ed7f5e15`，工作区干净。本轮未提交、推送或发布，未覆盖安装目录/重打 ZIP。上一轮“未提交”记录仅描述 S3 当时的历史状态。

优先阅读 [S4–S6 实施](s4-s6-implementation.md)、[当前验证报告与截图](s4-s6-qa-report.md)、[完整矩阵与环境](s4-s6-environment.md)、[真实 Chrome 验收卡](chrome-acceptance.md)，再看当前 Git diff。原 [baseline](baseline.md)、[S0–S3 实施](implementation-log.md)、[S0–S3 QA](qa-report.md) 保留为历史证据。

## 查看当前实现

已保留的隔离预览：`http://127.0.0.1:4176/tool.html?state=complete&scenario=success`。

如未运行：

```sh
python3 scripts/ui-preview/server.py --port 4176
```

页面使用真实生产 HTML/CSS/模块，仅以测试脚本拦截边界；显式横幅与测试作品名不可删除或当成真实处理证据。`scenario=poll-error` / `submit-unknown` / `storage-error` 可复现安全状态；用法见 `scripts/ui-preview/README.md`。不连接真实抖音/8766/Native Messaging，不执行视频下载。不要把 fixture 引入扩展。

## 真实扩展查看与重载

原源码入口仍是 `outputs/douyin-independent-extension/tool.html`，由原 action 打开；只有完整标签页，没有 popup/side panel/options。

先在 Chrome 扩展管理核对**原扩展的实际加载目录**：若本来加载仓库的 `outputs/douyin-independent-extension`，对原扩展点重新加载，再重开工具页即可。不要卸载、清数据、生成 key 或另换目录。

若当前加载的是安装器复制到 Application Support 的副本，本轮仓库改动不会自动同步，直接重载该副本也不会得到新代码。本轮没有覆盖它；后续应先核对原目录/配对，再只同步经审阅的扩展文件到原目录。旧安装 ZIP 尚未重建，不能用旧包宣称本轮 UI 已安装。当前加载路径与真实重载步骤需要人工现场确认，不能凭先前聊天推断。

本会话浏览器协议策略已明确禁止观察 `chrome-extension://` 内容；本轮没有绕过，HTTP 预览、只读 API 和旧截图均不能代替真实 MV3 验收。

## 关键文件

- `tool.js`：来源/任务代次、真实阶段、未知状态、GET-only 恢复、待载入结果、安全保存、音频去重/迟到保护、导出错误、生命周期适配。
- `editor.mjs`：组合输入、当前稿事件与有界映射历史快照；不拥有 DOM、不改原时间算法/格式。
- `tool.html` / `tool.css`：原入口中的待载入/提交未知提示、标签、Esc/焦点与主题样式；已确认的布局与品牌保留。
- `scripts/extension-tests/editor.test.mjs`、`task-contract.test.mjs`、`fixture.test.mjs`、`tool-page.test.mjs`：本轮新增/扩展回归。
- `scripts/ui-preview/`：隔离开发工具，不属于扩展运行包。
- manifest、theme-init、品牌/图标与原 11 个业务模块没有本轮修改；source handoff 仍在本目录 `ClipQuill_UI_Handoff_2026-10-14/`。

## 数据与恢复边界

原 version 0.1.5、权限、身份、8766 端口、下载路径/命名、模型、对齐、消息/服务协议、所有旧 key/schema 保留。没有清数据、全库清理、依赖升级或 FrameWeave 相关内容。

新结果不会覆盖已编辑/组合输入/未安全保存的当前稿；需明确载入并再次安全保存。任务引用保存失败仅保留本页内存恢复；新结果缓存失败不推进旧完成引用。保存失败时先复制/导出，不能依赖刷新恢复。撤销优先恢复原区间映射；超出内存缓存时按原规则映射并提示，原端点规则不改。

提交无 ID 的响应丢失无法靠现有协议证明服务是否接收；必须先核对，不能盲目重提。当前页有保护，但没有新造全局幂等或后台取消能力。不要把关闭页面当作取消，仍保留处理期间保持页面打开的提示。

## 剩余门槛

按 [真实 Chrome 验收卡](chrome-acceptance.md) 完成实际来源/下载/复用/识别、回听/模型对照、CSP/权限/native messaging/存储同步、系统中文输入法、剪贴板、真实 200% 缩放、原生图标与设备检查。系统主题/首屏/reduced motion/读屏和跨平台也不能由单元或 HTTP 模拟冒充。未具备条件的行保持未验证。

## 回退

本轮接续基线为 `81f0672`，UI 前基线仍是 `e3dadaa`。先保存和审查当前工作区，只反向撤销本轮 tool.html/tool.css/tool.js 与 editor 引用及对应新增文件；不要恢复整个仓库、reset/clean 或覆盖后来用户改动。不需要删除 storage、视频、模型或任何用户文案；本轮未迁移数据。原发布包未动，但它们不是本轮新 UI 的安装包。未执行回退。
