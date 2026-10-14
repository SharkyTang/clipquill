# S0–S3 验证记录

2026-10-14。测试边界：单元、静态、既有服务只读检查、同源 HTTP 隔离页面的布局与部分交互；不宣称真实 Chrome 扩展端到端通过。

## 实际执行结果

| 项目 | 命令/方法 | 结果 |
|---|---|---|
| 修改前 JS 基线 | `node --test scripts/extension-tests/*.test.mjs` | 70/70 通过 |
| 最终 JS | 同上 | 94/94 通过；新增 17 主题、7 页面契约回归 |
| Python 基线及最终回归 | `PYTHONPATH=scripts python3 -B -m unittest discover -s scripts/tests -v` | 53/53 通过；后端源码未改 |
| JS 语法 | `node --check` 检查 tool.js、theme-init.js、图标导出脚本及 fixture.js | 通过 |
| Python 预览脚本语法 | `ast.parse`，不写系统 pycache | 通过 |
| 品牌 | 实际 SVG→PNG 导出、格式/尺寸/透明通道、1×深浅底检查 | 16/32/48/128 PNG 与 16/32 favicon 通过 |
| DOM/契约 | 原 ID 唯一与事件保留、页面选择排除扩展、导航不创建任务、离线恢复、当前稿复制/TXT/SRT、保存失败、连接失败与重试 | 模拟环境通过 |
| 原 SRT 映射 | 原 draft/review 测试：改字、增删、跨段合并、换行、全空、非法时间、毫秒末端、保存恢复 | 通过；原算法未改 |
| 既有服务 | 正确来源的只读 health + 已有结果内存检查 | ready/videoReuse；287 段编辑/导出/恢复一致，未创建任务 |
| 布局 | CUA in-app browser，HTTP fixture，CSS 视口 320/390/768/1024/1280/1440/1536/1920 | 抽样均无页面横向溢出 |
| 控制台 | 隔离页面的 error/warn 日志 | 检查时为空 |
| 前端构建 | 无 package.json/打包器，源码直接加载 | 不存在 npm build 步骤；没有升级依赖或重打发布 ZIP |
| Git | `git diff --check`，manifest 与受保护源码对比 | 通过；无后端/模型/旧键/权限/协议改动 |

初次 Python discover 没带 PYTHONPATH 导致模块导入失败；按项目命令补齐后 53 项通过。初次系统 py_compile 尝试写不可写的系统缓存；改为内存 AST 检查。初次页面测试缺 getManifest mock；补齐后原测试和新增回归全部通过。

## 隔离预览与浏览器交互

启动：`python3 scripts/ui-preview/server.py --port 4176`。仅绑定 `127.0.0.1`；服务真实扩展文件，在 head 注入 `scripts/ui-preview/fixture.js`，该脚本不进入生产扩展。

fixture 将 Chrome API 替换为明确的测试实现；拦截真实 8766 请求与 Native Messaging，不读取抖音、不下载视频、不启动推理。缓存示例稿只写 HTTP origin 存储，页面顶部标注“隔离 UI 测试 · 示例文案 · 无真实下载 / 识别”。预览可切 `?state=empty` 或 `?state=complete`；切状态只重置 HTTP fixture 的命名记录。

实际 UI 检查：

- 浅/深切换、重载保留、两份 HTTP 测试页同步通过。系统浅/深和失败竞态由 VM 测试验证；未更改操作系统主题。
- 输入“测试编辑”后切主题，文字及 selectionStart/selectionEnd 一致；原生撤销逐次移除新增字符，最终恢复原文。没有销毁 textarea。真实中文 IME composition 与 redo/长稿压力待 S5。
- 断连 fixture 报告失败并提供重试，旧稿仍在；没有真实启动/失败推断。
- 复制按钮显示成功。自动化浏览器的会话剪贴板 API 回读为空，故实际剪贴板内容未确认；当前稿复制参数已有单元证据。
- 实际点击 TXT/SRT 并下载到 `Downloads/1000000000000000000_文案_当前稿.txt` 与 `.srt`。文件正文 297 字符一致。该数据仅为 fixture。
- 上述撤销操作沿用原 beforeinput 全文范围规则，导出 SRT 合并为一段，保留原外边界 00:00:00,000–00:00:59,500；没有平均重估时间。这是旧映射规则在整稿撤销时的行为，S5 需重点确认更细的撤销/重做期望，本轮没有重写映射。
- 展开回听校对并滚至确认控件，导出工具条仍可见；修正顶端偏移后 toolbar top 与滚动区 top 一致。fixture 无音频，不算真实回听通过。

## 实现截图

均由运行中的原页面代码经 HTTP 隔离预览截取；不是参考图或真实下载/识别结果。浏览器观察 DPR 1–2，截图 API 输出按 CSS 视口尺寸的 1× JPEG；没有后期重画。品牌图是独立资产检查，不算实现截图。

| 截图 | CSS / 输出尺寸 | 场景 |
|---|---|---|
| [main-dark-1440x900-fixture.jpg](screenshots/main-dark-1440x900-fixture.jpg) | 1440×900 | 深色，缓存示例稿 |
| [main-light-1440x900-fixture.jpg](screenshots/main-light-1440x900-fixture.jpg) | 1440×900 | 浅色，同一正文 |
| [main-light-1024x768-fixture.jpg](screenshots/main-light-1024x768-fixture.jpg) | 1024×768 | 图标导航，导出可见 |
| [narrow-light-390x844-fixture.jpg](screenshots/narrow-light-390x844-fixture.jpg) | 390×844 | 完整页窄视口，非 side panel |
| [narrow-editor-light-390x844-fixture.jpg](screenshots/narrow-editor-light-390x844-fixture.jpg) | 390×844 | 聚焦编辑后，按钮可见 |
| [comparison-dark-1536x1024-fixture.jpg](screenshots/comparison-dark-1536x1024-fixture.jpg) | 1536×1024 | 与参考同尺寸结构比较 |
| [empty-dark-1440x900-fixture.jpg](screenshots/empty-dark-1440x900-fixture.jpg) | 1440×900 | 空态，无文案操作假按钮 |
| [error-dark-1440x900-fixture.jpg](screenshots/error-dark-1440x900-fixture.jpg) | 1440×900 | 隔离服务错误，当前稿仍在 |
| [review-dark-1440x900-fixture.jpg](screenshots/review-dark-1440x900-fixture.jpg) | 1440×900 | 修正后展开校对、工具条可见 |
| [brand-icons-actual-size.png](screenshots/brand-icons-actual-size.png) | 520×470 | 实际尺寸资产检查图，非运行截图 |

`review-light-1440x900-fixture.jpg` 保留为修正前比较证据；最终对应的是 review-dark 截图。

## 未验证与阶段边界

- 自动浏览器对 `chrome-extension://` 访问返回安全策略禁止；没有绕过。真实 MV3 CSP、native messaging、chrome.storage 跨页事件、网页权限与抖音解析/下载/新识别/音频播放尚未在新 UI 实测。
- 不以 HTTP API、fixture 成功、旧版人工验收或参考图作为当前扩展端到端证据。
- Chrome 原生工具栏与 favicon 的实际显示、真实 IME、200% 缩放、完整键盘路径、系统实时主题和首屏闪烁待人工验收；语义 token 不是完整 WCAG 合格证明。
- 本轮 S3 视觉门槛通过；完整产品验收仍待 S4–S6。详见根目录 design-qa.md 和 handoff.md。
