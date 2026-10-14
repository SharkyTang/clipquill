# ClipQuill S0 审计与运行基线

日期：2026-10-14。范围：当前仓库的 v0.1.5 扩展，执行到 S3 后停止；本文件记录修改 UI 前的行为与证据，不代表 S4–S6 已完成。

## 来源与工作区

- 基线提交：`e3dadaa5cdc43f80dbed44afadb87952a0587fcf`（`feat: add on-demand local helper startup and installer in v0.1.5`）。开始审计时 `git status --short` 为空；后续出现的品牌与 UI 改动属于本轮并行实现。
- 已读根 README、扩展 README、manifest、入口 HTML/JS/CSS、背景脚本、解析/下载/服务/当前稿/导出实现及现有测试。仓库根与入口的祖先/所属目录未发现适用的 `AGENTS.md`；仅 vendored `work/independent-asr/whisper.cpp/AGENTS.md` 与扩展 UI 无关，本轮不修改该目录。
- 已完整读取用户提供的 `/Users/shaoqitang/Downloads/ClipQuill_Codex_执行规划.md`（800 行）。参考图由主实施流程核对：第一张决定结构，第二张决定蓝紫羽毛笔与播放符号。交接文档中的组件与阶段为执行参考，实际入口和能力以下列源码为准。
- 不创建桌面应用，不修改 FrameWeave，不扩权限，不改版本/扩展身份，不清用户数据，不安装或升级依赖，不启动/停止服务，不创建新识别任务，不发布或推送。

## 真实入口与技术栈

| 项目 | 当前事实与源码 |
|---|---|
| 完整扩展标签页 | 存在。`outputs/douyin-independent-extension/background.js` 的 `chrome.action.onClicked` 通过 `chrome.tabs.create` 打开同目录 `tool.html`。 |
| Side panel / popup / options | 均不存在。manifest 无 `side_panel`、`action.default_popup`、`options_page`/`options_ui`。窄屏截图只能叫完整页的窄视口测试。 |
| 前端 | 原生 HTML/CSS/JavaScript ES Modules：`tool.html`、`tool.css`、`tool.js`；没有前端 package.json、打包器或框架。源码目录即加载目录，无需 npm build。 |
| 后台 | MV3 module Service Worker `background.js`；通过 `chrome.scripting.executeScript` 按需在支持的抖音页面执行捕获函数，无常驻 content script。 |
| 长任务 | 同机 Python `scripts/transcription_bridge.py` 管理任务，调用 `scripts/transcribe_accurate.py`，使用现有 Qwen3-ASR/ForcedAligner 与 Whisper 对照链路。前端轮询真实任务。 |
| 自动启动 | `service.mjs` 使用固定 Native Messaging 主机 `com.clipquill.local_helper` 与固定 `{action: 'ensureService', protocol: 1}`；已就绪服务直接复用。 |
| 平台 | 只支持源码中已有的抖音官方 HTTPS 链接和兼容 MP4；不是 B 站/YouTube 多平台工具。 |
| 权限/CSP | 原 manifest 权限为 `scripting`、`downloads`、`storage`、`nativeMessaging`，host permissions 仅 `www.douyin.com`、`v.douyin.com`。没有自定义 CSP 放宽项。 |

## 原页面与真实操作链

原 `tool.html` 是单列工具页：分享内容 → 独立的下载/提取按钮 → 默认折叠的辅助选项与已打开作品 → 状态、重试和恢复 → 当前全文编辑、复制/TXT/SRT、默认折叠的回听校对 → 已识别作品信息。旧 HTML 可由上述基线提交读取；本轮没有旧界面的新增浏览器截图，不能用参考图替代。

下载独立执行解析→Chrome 下载→完成状态和大小核对；不启动本地识别。提取会先确保本地服务就绪，再解析→`/videos/find` 检查已有完整兼容视频→需要时下载→`POST /jobs`→轮询结果。没有强制用户先手动下载的要求。文件丢失/截断在提交时最多再检查并补取一次；识别/服务错误不会反复下载。

“已打开作品”使用 `chrome.tabs.query({url: 'https://www.douyin.com/*'})`，再经 `workIdFromURL` 过滤明确作品。它不读取 `chrome-extension://` 当前标签，不能直接改成抓活动标签。后台只接受同扩展 `tool.html` 的既有消息。

## 能力矩阵

这里的“已运行验证”明确注明证据层级。自动化测试通过不等于本轮真实 Chrome 下载/识别端到端通过；历史验收也不算新 UI 验收。

| 能力 | 状态 | 本轮证据与限制 |
|---|---|---|
| 支持链接与完整分享文字 | 已运行验证（单元） | `core.test.mjs`；额外对已有作品分享文字调用 `shareURL`，得到正确官方作品 URL。 |
| 链接导航、作品 ID 一致性、登录/验证与解析页复用 | 已运行验证（模拟 Chrome/DOM） | `core`、`access`、`parser-page`、`background`、`tool-page` 测试；本轮未在真实抖音会话重跑。 |
| 已打开作品选择、排除插件自身 | 有实现未验证（真实 Chrome） | 查询与过滤路径已读，模拟测试覆盖后台现有页面；真实多标签选择留到后续验收。 |
| 独立视频下载、完成/中断与大小校验 | 已运行验证（模拟） | `transcription.test.mjs` 与 `tool-page.test.mjs`；没有本轮新的 CDN/磁盘下载。 |
| 完整本地视频查找复用、重试 | 已运行验证（单元/临时目录） | `video.test.mjs`、Python bridge 测试，覆盖重复文件名、质量、缺失/截断、符号链接和错误边界。 |
| 本地服务健康及严格来源校验 | 已运行验证（真实只读 HTTP） | 既有 PID 47162 监听 `127.0.0.1:8766`；无 Origin 的 GET `/health` 为 HTTP 403；使用既有配对来源为 HTTP 200，`ready: true`、`videoReuse: true`、`busy: false`。未启动或重启该进程。 |
| 自动启动/失败重试 | 已运行验证（模拟/单元） | `service.test.mjs`、`test_native_host.py`；没有为测试停掉用户服务，当前 UI 的真实冷启动待验证。 |
| 音频处理、识别、对齐与模型校对 | 有实现未验证（本轮新任务） | 模型/FFmpeg 调用路径已读，Python alignment 测试通过；本轮未启动推理。既有完成任务仍可只读读取，不冒充新任务成功。 |
| 已有结果读取、全文编辑与保存/恢复兼容 | 已运行验证（内存与单元） | 对安装版真实已完成任务 `7d00ba7c0ac640db9b54270f357b851b`（287 段）创建内存稿、插入测试前缀、序列化并恢复，全文和 SRT 相同；原文件与浏览器存储均未写入。 |
| 当前稿 TXT/SRT 数据 | 已运行验证（内存与单元） | 上述同一内存编辑同时出现在 TXT/SRT；287 cues，恢复前后相等。现有 draft/review 测试覆盖跨段、增删和非法时间；真实新 UI 浏览器下载文件待验收。 |
| 复制与导出浏览器动作 | 有实现未验证（本轮浏览器） | `tool.js` 复制读取 `draftText`，TXT/SRT 读取 `exportDraft`；导出提示为“已发起”，不宣称磁盘保存完成。 |
| 逐段回听、片段编辑、重点分歧、人工确认 | 有实现未验证（本轮浏览器音频） | `reviewDetails`、`reviewAudio`、`segmentSelect` 等真实入口，音频通过已完成 job 的 `/audio`；Python 权限/路径测试通过。 |
| 离线恢复本机缓存当前稿 | 有实现未验证（本轮真实存储） | `lastCompleted-v1` + `result-v1-*` 在连接服务前恢复；失连不阻止纯文本编辑/导出。测试覆盖相关存储/服务失败分支；未读取或改写用户 Chrome localStorage。 |
| 服务不可用行为 | 已运行验证（模拟） | 自动启动失败保留原输入与 retry operation；未停止真实服务伪造离线。 |
| 封面、作者、可播放视频封面卡 | 不存在（当前响应） | `capturePage` 只返回作品 ID、标题、时长、download 标志和 variants；不能从参考图填封面/作者或新增假播放按钮。 |
| 多任务历史 UI、取消任务、百分比进度 | 不存在 | 只有最近完成/最近提交引用和旧稿，不是历史产品；服务无取消接口，任务 stage 是文本，无百分比。 |
| 新主题/品牌/布局 | 本轮 S1–S3 实现对象 | 不属于修改前既有能力；结果与新增测试见阶段实施/QA 文档。 |

## 运行命令与基线结果

两套完整测试在并行 UI 编辑开始前立即运行；基线为 70 项 JS、53 项 Python 全部通过。

```sh
node --test scripts/extension-tests/*.test.mjs
# tests 70, pass 70, fail 0, skipped 0

PYTHONPATH=scripts python3 -m unittest discover -s scripts/tests -v
# Ran 53 tests, OK
```

最初尝试省略 `PYTHONPATH=scripts` 会导致 5 个模块导入失败（找不到 scripts 内模块），按根 README 的真实命令补上后全部通过；这是调用方式问题，没有修改测试或源代码来掩盖失败。

本轮只读 HTTP 初次在 sandbox 内 curl 返回 exit 7 / HTTP 000；独立 `lsof` 确认监听后，经允许的外部只读请求验证上述 403/200。不能把初次网络阻塞写成“服务未启动”。

额外真实旧任务仅在内存中验证：`status: complete`，`characters: 3592`，`segments: 287`，`hasAudio: true`。编辑后 3599 个 JS 字符、287 个 SRT cues；原始文件、文案和任务状态未改。没有把此历史完成任务当成本轮识别成功证据。

## 必须保留的契约

| 契约 | 路径/值 |
|---|---|
| 服务地址 | `transcription.mjs`: `http://127.0.0.1:8766`；Python 仅 loopback。 |
| 服务协议 | `/health`、`POST /videos/find`、`POST /jobs`、`GET /jobs/:id`、`GET /jobs/:id/audio`；service `douyin-local-transcription`、protocol 1。 |
| 后台消息 | `resolve-douyin`、`login-douyin`；响应 `{ok, work, tabId}` / 既有 error code。 |
| 下载策略 | `core.mjs:filenameFor` → `抖音独立导出/<workId>_<height>p_<title>.mp4`；`conflictAction: uniquify`。不因用户可见品牌改名而改目录。 |
| 解析页存储 | `chrome.storage.session['douyinParserPage-v1']`，仅扩展创建的解析页复用。 |
| 当前稿/结果本机键 | localStorage 的 `draft-v1-<jobId>`、`draft-rejected-v1-<jobId>`、`review-<jobId>`、`result-v1-<jobId>`、`lastCompleted-v1`、`lastTranscription`。 |
| 设置/提示旧键 | `terms`、`terms-legacy`、`terms-policy-v1`、`loginTipSeen-v1`。不更名/清空/迁移。 |
| SRT 时间映射 | `draft.mjs` 的 sources 不变；跨块编辑合并 sourceIds 的原外端点，插入归属所在区间，删除整行保留其余原时间；不平均重估，不导出旧稿。 |
| SRT 拒绝规则 | 空稿、无原时间、重叠/无效/越界时间、空白行、`-->` 文本会明确拒绝 SRT，复制/TXT 继续保留。时长边界按毫秒舍入核对。 |

## 本轮风险与 UI 决策

1. `tool.js` 直接依赖大量 DOM ID；迁移应保留节点身份和事件入口，不通过整页重建编辑器切主题。原 `textarea` 的 value 仅不同内容才写回，应保留该保护。
2. 当前识别服务在线，但自动工具是否可访问 `chrome-extension://` 必须重新实测。普通 HTTP 预览/fixture 截图只能验证布局，不能替代真实扩展权限、CSP、Native Messaging、下载或音频验收。
3. 品牌可改用户可见名称、标题、PNG 图标；旧下载目录、协议、storage key、扩展加载路径、version、权限不随名称替换。
4. 第一张图的封面、作者、多平台宣传、固定字数上限、耗时与进度均不是当前接口证据。新 UI 应省略或显示真实空态；没有独立获取元数据按钮时可保留原下载/提取触发方式并记录偏离。
5. 原输入/IME、撤销、跨段映射、复制与导出当前稿不能因布局迁移被改写。完整人工输入法与浏览器撤销验收仍应列在 S5，而不是以模型单元测试代替。
6. 原有仅最近文案恢复；不增加假历史、空产品模块、取消或“字幕剪辑时间轴”。回听与模型分歧入口必须保留。
7. S3 后为首次视觉检查点；S4 真实状态整合、S5 编辑/恢复全面验证、S6 真扩展完整回归仍待下一轮用户确认后继续。
