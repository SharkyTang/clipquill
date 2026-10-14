# S4–S6 独立环境与边界核验

日期：2026-10-14（用户时区 Europe/London）。本记录区分源码/单元、真实只读服务、隔离网页和真实扩展；历史报告不作为当前通过证据。最终页面交互和截图以本轮 QA 报告补充。

## 本轮开始的事实

- 初始 `git status --short`、`git diff --stat` 均为空；HEAD 为 `81f0672f73607fc54541ee83e3c8eb27ed7f5e15`（`feat: add ClipQuill UI redesign S3 checkpoint`）。因此上一轮文档的“未提交”属于历史状态，当前 S0–S3 已在 HEAD 中。本轮没有提交、推送或发布。
- 已逐段读取完整 800 行执行规划，以及 baseline、implementation-log、handoff、qa-report、根和扩展 README、manifest、页面/主题及服务源码。项目根、相关祖先及扩展目录没有适用的 AGENTS.md；不采用其他项目的规则。
- 实际宿主仍仅为 MV3 action 点击后打开的 `tool.html` 标签页。没有 action popup、side panel、options 页面，不为凑测试矩阵增加入口。
- 原生 HTML/CSS/ES Modules，无前端 package.json、框架迁移或 npm build 步骤。未升级依赖，未生成新版本 ZIP，也未覆盖安装器副本。

## 当前环境与实际命令

| 项目 | 当前证据 |
|---|---|
| 系统 | `uname -srm` → Darwin 25.6.0 arm64；`sw_vers` → macOS 26.6.2 / 25G83 |
| Node | `node --version` → v26.0.0 |
| Python | `python3 --version` → Python 3.9.6；测试使用 `-B` 禁止写 pycache |
| Python 回归 | `PYTHONPATH=scripts python3 -B -m unittest discover -s scripts/tests -v` → 53 tests / OK |
| JS 工作中回归 | `node --test scripts/extension-tests/*.test.mjs` → 109 tests / 104 pass / 5 fail；此时新的 task-contract 测试已落盘，主页面修复尚未合并，不能当最终结果。失败均为本轮明确要修的重复/迟到/阶段/来源竞态；最终重跑结果记录在下文。 |
| JS 合并后独立重跑 | 同一完整命令 → 124 tests / 124 pass / 0 fail / 0 skipped（工作中证据）；根流程最终重跑为 143 tests / 143 pass / 0 fail / 0 cancelled / 0 skipped，作为交付数字。 |
| 服务监听 | `lsof -nP -iTCP:8766 -sTCP:LISTEN` → 已存在 PID 47162，仅监听 `127.0.0.1:8766` |
| 真实服务健康 | 读取安装版现有 `work/native-host.json` 的 protocol 1、两条已配对扩展来源；GET `/health` 对两条来源均 HTTP 200：`service: douyin-local-transcription`、`protocol: 1`、`ready: true`、`videoReuse: true`、`busy: false` |
| 来源拒绝 | 同一服务，无 Origin 或 Origin `https://example.com` 均 HTTP 403 |
| 初次网络限制 | sandbox 中 loopback 请求为 `[Errno 1] Operation not permitted`；按工具规则申请只读请求权限后重跑才得到上述 403/200。未把 sandbox 阻塞误报为服务离线。 |

HTTP 检查仅执行 GET `/health`，没有 POST、新任务、启动/停止、安装、配对或模型调用。配置只读，不打印 Cookie、令牌、文案或账号。

只读核对安装版既有记录：28 份任务记录，其中 27 份 complete、1 份 failed。最近既有完成结果含 287 段、3592 个原识别字符，原 TXT/SRT/review/manifest 文件存在；真实回听文件为 `review.m4a`，是输出根内的非符号链接普通文件，5,202,296 字节，低于现有 64 MiB 限制。这仅证实旧结果/媒体仍在，不是新 UI 回听成功或本轮新识别通过。

## 受保护边界与品牌静态核验

以 UI 前基线 `e3dadaa5cdc43f80dbed44afadb87952a0587fcf` 比较：manifest 的非品牌字段、action 非名称/图标字段均相同；仍为 manifest v3、扩展 version 0.1.5，权限仍为 `scripting`、`downloads`、`storage`、`nativeMessaging`，网页权限只有 `https://www.douyin.com/*` 和 `https://v.douyin.com/*`。没有 CSP 放宽、外部脚本、内联脚本或内联事件。

11 个原业务模块 `background.js`、`access.mjs`、`core.mjs`、`draft.mjs`、`navigation.mjs`、`parser-page.mjs`、`review.mjs`、`service.mjs`、`settings.mjs`、`transcription.mjs`、`video.mjs` 与 UI 前基线逐字节相同（核对时）。本轮新增必要编辑事件适配允许独立模块实现；不能借此重写原时间映射或改变存储 schema。

所有正式 manifest 图标为 PNG：`icon16` 16×16、`icon32` 32×32、`icon48` 48×48、`icon128` 128×128；favicon 为 16×16/32×32。实际 PNG 头均为 8-bit RGBA（colour type 6）。SVG 源独立存在，不裁参考海报。页面 `<title>` 与 action title 均为 ClipQuill，没有运行时代码改回旧名称。此静态结果不能替代 Chrome 工具栏/管理页实际像素检查。

## 语义颜色数值核验

使用 tool.css 实际十六进制 token，按 sRGB 线性化相对亮度计算；不是对参考图取样，也不是整页 WCAG 认证。

| 前景/背景组合 | 浅色 | 深色 |
|---|---:|---:|
| 正文/卡片 | 15.73:1 | 14.92:1 |
| 主按钮白字/primary | 6.29:1 | 6.29:1 |
| 主按钮白字/primary-hover | 7.90:1 | 7.90:1 |
| 控件边界/editor | 3.55:1 | 3.78:1 |
| 控件边界/surface | 3.55:1 | 3.52:1 |
| 焦点/surface | 6.29:1 | 9.20:1 |
| 选中导航 accent-text/selected | 6.53:1 | 7.03:1 |
| success/success-surface | 5.87:1 | 8.24:1 |
| warning/warning-surface | 6.17:1 | 9.09:1 |
| danger/danger-surface | 5.87:1 | 7.42:1 |

常规 text/secondary/muted 在页面、导航、surface、editor、hover 的实际基础组合均达到 4.5:1；选中导航使用 accent-text。理论 muted/selected 浅色约为 4.497:1，略低于 4.5，当前没有该组合的规则，后续不要把灰提示文字加到 selected 填充上而免检。disabled 的 opacity、原生 select/audio/confirm，以及屏幕缩放和实际渲染仍需浏览器检查。

另用标准库 HTMLParser 静态检查当前真实 tool.html：12 个 input/select/textarea/audio 全部具有 label、包裹 label 或 aria-label；无重复 DOM ID，无损坏 aria-describedby/aria-labelledby 引用，无内联脚本/事件。主题选择已补独立 aria-label，窄屏隐藏视觉 label 后仍有名称；来源面板已有 Escape 关闭并聚焦 summary 的事件。上述是静态证据，HTTP skip link 和来源面板 Esc/焦点已检查；全 Tab 路径、读屏及焦点遮挡仍需人工。

## 执行规划全量矩阵：证据层级

以下表格记录环境可验证范围；“单元”使用模拟 Chrome/DOM/内存或临时目录，不能写成真实 Chrome 端到端。S4/S5 主流程最终 143 项 JS、53 项 Python 通过。下表浏览器结论均限 HTTP 隔离环境；完整操作和截图见 [本轮 QA](s4-s6-qa-report.md)。

| ID | 场景 | 当前可执行证据与仍需验证 |
|---|---|---|
| F01 | 完整分享文案 | core/tool-page 单元；真实 Chrome 粘贴/解析待验收 |
| F02 | 无/多/不支持链接 | core/tool-page/task-contract；多个不同候选不得静默选错；真实页面待验收 |
| F03 | 来源不选插件自身 | source query 仅 Douyin HTTPS 作品，tool-page 单元；真实权限待验收 |
| F04 | 多作品明确选择 | tool-page/task-contract 单元；真实多标签待验收 |
| F05 | 只下载不提取 | transcription/task-contract 单元；无本轮真实新下载 |
| F06 | 提取复用完整视频 | video 与 Python 临时目录检查；无本轮真实提取 |
| F07 | 防重复任务 | task-contract 新回归；初次失败已修复，最终完整 143 项重跑通过；真实新任务未运行 |
| F08 | 缺元数据 | 页面不造封面/作者/视频播放器；HTTP 实现截图已核对；不造元数据 |
| F09 | 服务离线仍可编辑导出 | tool-page 缓存/错误单元；不为测试停止用户服务 |
| F10 | 轮询断连未知状态 | task-contract 重跑通过：保留 ref 并 GET 原任务，不盲目 POST 新任务；真实断连未制造 |
| F11 | A 迟到不覆盖 B | task-contract + 编辑适配回归；真实并发未运行 |
| F12 | 长稿/IME/undo/redo | editor/draft 单元；系统中文输入法真实 composition 和原生撤销人工验收待补 |
| F13 | 输入中换主题/视图/断点 | 主题不重建 textarea；editor/theme 单元；HTTP 浏览器切主题选区/文字一致、原生 undo/redo 保留 12 段；真实 MV3 待验收 |
| F14 | 保存失败/乱序 | theme/tool-page/editor 单元；浏览器 localStorage 是同步写入，不伪造异步后台保存 |
| F15 | 复制/TXT 当前稿 | draft/tool-page 单元；HTTP 实际下载 TXT/SRT 与可见 299 字稿一致；真实 Chrome 剪贴板/导出待验收 |
| F16 | SRT 原时间映射 | 原 draft/review + 新 editor 回归；最终相关回归通过，原 draft.mjs 未改；HTTP 实际 SRT 12 段原端点保留 |
| F17 | 恢复/重新识别覆盖保护 | tool-page/editor/task-contract 回归；无清空用户数据测试 |
| F18 | 重开/重载 | tool-page 离线恢复单元；真实扩展重载和存储未验收 |
| F19 | 回听/模型对照 | review/bridge 单元，既有 review.m4a 只读存在性通过；真实页面播放未验收 |
| F20 | HTML 特殊字符 | textContent/textarea 文本路径静态核验、tool-page 单元；不使用 innerHTML 渲染来源/文案 |
| F21 | 无时间戳 TXT/复制/SRT说明 | draft/tool-page 单元；无时间戳不编造 SRT |
| F22 | 导出/剪贴板失败 | tool-page 回归；真实浏览器受限权限失败待验收 |
| T01 | 首次系统浅/深 | theme VM 单元；真实首次绘制闪烁待验收 |
| T02 | 手动持久化 | theme VM 单元；真实 chrome.storage 重开待验收 |
| T03 | 手动模式忽略系统 | theme VM 单元；未改操作系统主题 |
| T04 | 系统模式实时变化 | theme VM 单元；未改操作系统主题 |
| T05 | 两扩展页同步 | theme VM 单元；HTTP 预览同步可作辅助，真实扩展待验收 |
| T06 | 存储错误诚实反馈 | theme VM 单元；无需破坏真实浏览器存储来造失败 |
| T07 | 完整控件主题 | CSS token/contrast 数值检查；菜单/error/disabled/review 等浏览器截图补证 |
| B01 | 工具栏/管理页/标签 | manifest/title/favicon 静态通过；真实 Chrome 外壳待验收 |
| B02 | 16/32/48/128 两底 | PNG 实际尺寸与矢量源通过；实际 1×品牌预览/真实 Chrome 分开报告 |
| B03 | 动态品牌不回退 | 搜索 document.title/setTitle/setIcon 未发现旧写回；真实重开待验收 |
| B04 | 不污染抖音/Chrome | 无主题 content script/网页改名/新权限；真实双页并存待验收 |
| A01 | 键盘/焦点 | HTML labels、skip link、focus-visible、按钮 min-height 静态存在；HTTP skip link 通过；全 Tab 路径/读屏待人工 |
| A02 | 菜单 Esc/返回焦点 | 原生 details/select 与必要来源面板处理；HTTP Esc 关闭并返回 summary 已通过 |
| A03 | 对比度/状态文本 | 上述 token 数值检查通过实际组合；成功/失败有文字，不仅颜色 |
| A04 | 200%/320px 重排 | CSS 窄断点存在；320/390 及其余 7 个视口 HTTP 重排/无横向溢出通过；快捷键未改变实际缩放，200% 仍未验证 |
| A05 | 减少动画 | prefers-reduced-motion 样式存在；系统启用运行检查待验收 |
| E01 | 真 MV3 CSP/消息/权限 | 静态 manifest 未放宽；本会话浏览器协议策略明确禁止 chrome-extension 内容访问，限制未解除；不重试或绕过。真实 MV3 仍阻塞 |
| E02 | 本地真实服务 | 本轮 GET health 来源/身份/就绪通过；不等于新 UI Native Messaging/下载/识别通过 |
| E03 | 模型/端到端 | 真实既有结果只读通过；没有创建本轮新任务，标未验证 |

## 最终重跑与接续

本文件首次 JS 结果捕获了并行实现中的红灯，随后 124 项通过；根流程最终重跑 143 项 JS、53 项 Python，语法与 `git diff --check` 通过。最终截图、HTTP 操作、导出文件比对和限制见 [QA](s4-s6-qa-report.md)，摘要见 `evidence/s4-s6-checks.json`。真实扩展与人工项保持“未验证”，不写“全部完成”。
