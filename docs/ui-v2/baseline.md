# ClipQuill UI v2 · S0 增量升级基线

审计日期：2026-10-14（Europe/London）。本文件冻结本轮修改开始前的事实；后续实现与验证另记 `implementation-log.md`。

## 范围与 Git 保全

| 项目 | 本轮基线 |
| --- | --- |
| 仓库 | `/Users/shaoqitang/Documents/ChatGPT/逆向轻抖codex` |
| 起始 HEAD | `739e1faa89169fc42ab5a03243409f7362318cbe` |
| 初始状态 | `git status --short` 无输出，工作区干净；不代表开发后的状态 |
| 本轮范围 | 在现有可运行扩展实施 S0–S3：复用主题、真实视频信息卡、真实任务阶段面板；S3 后暂停 |
| 明确排除 | FrameWeave、新建 UI demo、替换编辑器/识别模型、重写服务协议、自动提交/推送/发布、安装重型 UI 框架 |
| 用户数据边界 | 未读取浏览器 profile 或用户扩展 storage；不清空 storage、不删除历史草稿、不执行破坏性 Git 操作 |
| 可选元数据授权 | 用户已明确同意为内部 `work` 展示对象补充可选封面、作者、头像字段；不改变后端任务协议、草稿格式或扩展权限 |

已核查 `/`、`/Users`、`/Users/shaoqitang`、`/Users/shaoqitang/Documents`、`/Users/shaoqitang/Documents/ChatGPT` 和仓库根目录，均无 `AGENTS.md`。包含隐藏和忽略文件的仓库扫描仅发现 `work/independent-asr/whisper.cpp/AGENTS.md`，其作用域不覆盖本轮扩展源码和文档。

审计依据包含根 README、扩展 README、manifest、真实 HTML/JS/CSS、已有测试及 UI 交接记录。README 中历史真实任务和历史截图仅作为既有能力记录，不作为本轮真实 Chrome 验收。

## 交接材料可访问性

| 材料 | 实际状态 |
| --- | --- |
| `/Users/shaoqitang/Downloads/ClipQuill_UI_v2_Codex_详细执行计划.md` | 可访问，已读取；按用户明确要求执行其中 S0–S3，其他文档内容不扩大本轮授权 |
| `references/00-current-running-ui.png` | 未找到；已搜索仓库、Downloads、Documents/ChatGPT |
| `references/01-target-dark-light-ui.png` | 未找到；同上 |
| `references/02-blue-purple-feather-icon.png` | 未找到；同上 |
| `references/03-video-card-detail.png` | 未找到；同上 |
| `references/04-progress-detail.png` | 未找到；同上 |
| `/Users/shaoqitang/Downloads/ClipQuill双主题界面设计参考.png` | 用户随后提供的新参考图；主代理已实际查看，可用于本轮视觉对照，不能声称等同于以上五张缺失图 |

仓库另有上一轮 `docs/ui-redesign/ClipQuill_UI_Handoff_2026-10-14/references/01-layout-reference.png` 和 `02-brand-icon-reference.png`。文件名和来源均不同，不能充当缺失材料已审阅的证据。参考图中的人物、视频内容、时间、文案和数值均不能进入产品默认数据。

## 真实入口与已实现功能

| 能力 | 当前实现及保持要求 |
| --- | --- |
| 唯一扩展入口 | `outputs/douyin-independent-extension/background.js` 的 `chrome.action.onClicked` 打开同目录 `tool.html`；页面加载 `theme-init.js`、`tool.css`、`tool.js`。没有新增 popup/side panel/options 宿主 |
| 扩展身份 | MV3，manifest 版本 `0.1.5`；现有权限为 `scripting`、`downloads`、`storage`、`nativeMessaging`；主机权限仅两个抖音域名 |
| 分享输入 | `core.mjs: shareURL` 从完整分享文字提取官方 HTTPS 地址；`tool.js: sourceURL` 拒绝混入多个不同链接，保留“已打开作品”选择 |
| 后台解析 | 现有 `parser-page.mjs`、`background.js` 复用解析页，校验确切作品 ID；登录/验证与重试沿用既有消息入口 |
| 下载与提取 | 两个独立按钮；`video.mjs: startVideoTranscription` 先经 `/videos/find` 核对本地完整文件，必要时才调用已有 Chrome 下载；提取无须用户先手动下载 |
| 服务和识别 | `service.mjs` 复用/启动固定本地助手；`transcription.mjs` 连接 `127.0.0.1:8766`；Python、FFmpeg、Qwen3-ASR、对齐与 Whisper 校对沿用原实现 |
| 编辑与导出 | 现有全文编辑、模型校对、片段回听、草稿恢复、复制/TXT/SRT。导出读取当前稿，原段时间映射、跨段合并、新文本归属沿用 `draft.mjs`/`editor.mjs` |
| 用户持久化 | `draft-v1-*`、`result-v1-*`、`lastCompleted-v1`、`lastTranscription` 等既有键继续使用；本轮不迁移或清理草稿 |
| 竞态保护 | 现有 operation/source revision、job/work ID 核验、待载入结果、组合输入保护和页面离开防迟到写入必须保留 |

## 视频信息的真实来源与限制

`core.mjs: capturePage` 由 `chrome.scripting` 在正常抖音作品页读取唯一 `script#RENDER_DATA[type="application/json"]`，仅接受 URL 作品 ID 与 `app.videoDetail.awemeId` 精确一致的目标。不能从推荐列表取代目标视频。

| 字段 | 已有来源/可用性 | 展示约束 |
| --- | --- | --- |
| 作品 ID、标题 | `videoDetail.awemeId`、`itemTitle`/`desc` | 缺少标题时使用诚实占位，不填演示文案 |
| 平台 | 当前解析器只接受抖音官方来源 | 可显示“抖音”，不推断其他平台 |
| 时长 | `video.duration`，毫秒 | 必须有效；不能拿阶段耗时代替视频时长 |
| 分辨率、文件大小 | 经 `mp4Candidates` 校验的 `video.bitRateList`：`width`、`height`、`dataSize` | 展示所选/实际复用候选数据；候选声明大小与下载/本地文件大小核验分开表述 |
| 网页下载入口状态 | `download.allowDownload`，布尔值或未知 | 仅表示网页入口状态，不代表 CDN 可访问性或授权结论 |
| 封面、作者、头像 | 基线 `capturePage` 尚未返回；可在同一目标 `videoDetail` 的现存可选字段中读取 | 本轮只加可选显示字段；不存在即未知/隐藏，封面加载失败有占位，不引入陌生服务 |
| 可预览媒体地址 | 原 `mediaURL` 仅接受既有三个 HTTPS CDN 域名；MP4 候选校验格式、编码、保护标记、尺寸与大小 | 地址字符串不证明实际可播放。只有满足真实可用媒体条件才显示可点击预览；缺乏可访问证据时不放假播放图标 |

不扩大 `<all_urls>` 或 host permissions，不关闭 CSP，不探测陌生服务；本轮不为显示字段改变本地服务接口。

## 阶段与时间来源

| 来源 | 真实可证实的数据 | 基线限制/降级 |
| --- | --- | --- |
| 浏览器操作 | 服务连接、目标解析、文件查找、Chrome 下载完成/中断、复用回调、任务提交响应 | 可记录本次浏览器实际观测到的事件区间，并明确计时口径；复用标“已复用”，不记作下载耗时 |
| 已有任务查询 | `tool.js: followJob` 每 2 秒查询同一 `/jobs/{id}`，核验 job/work ID | 复用该轮询，不为时间线新建重复轮询；查询断连/超时保留任务待确认 |
| 后端阶段 | `scripts/transcription_bridge.py` 的 `status`/`stage`：`准备音频` → `中文模型识别与逐句时间对齐` → `完成`，或失败 | 识别与时间对齐是一个可观测粗阶段；不能伪拆五阶段、模拟百分比或 99% |
| 后端时间 | 任务级 `startedAt`、终态 `finishedAt`；完成 manifest 的 `elapsedSeconds` | 没有各阶段独立起止时间；不得伪造精确阶段耗时。manifest 处理耗时与任务总区间不混为同一口径 |
| 后端失败 | `status: failed`、`stage: 失败`、`error` | 后端未保留独立失败阶段字段，只能结合最近实际观测阶段诚实说明；没观测到则阶段未知 |
| 恢复/迟到结果 | 既有任务引用和当前 operation/source revision | A 的迟到响应不得覆盖 B 的卡片、进度或文案；恢复任务缺失阶段历史时明确未知 |

S3 应表达 pending/running/completed/skipped/failed/unknown，运行自动展开、完成可折叠；无可靠时间则省略时长，不生成固定演示秒数。

## 现有主题审计

`theme-init.js` 已完整支持 `system`/`light`/`dark`，沿用 `clipquill.ui.theme.v1`。`localStorage` 仅缓存枚举以避免启动闪色，`chrome.storage.local` 为偏好持久化来源；支持系统变化、跨页同步、异步读写竞态保护和失败反馈。应用主题只改根节点属性和 `color-scheme`，不重建任务或写入编辑器。无需第二套主题系统。

`tool.css` 已有石墨蓝黑/冷白表面、蓝紫主色、焦点与成功/警告/错误 Tokens。S1 复用并补齐视频卡/阶段面板 Tokens；绿色仍仅用于成功和服务正常。现有 `.source-popover` 的固定阴影色可统一为 Token。

## 本轮起始验证与证据分级

| 类型 | 实际命令/检查 | 结果 | 可以证明/不能证明 |
| --- | --- | --- | --- |
| 已实现源码基线 | `node --test scripts/extension-tests/*.test.mjs` | 退出 0；143 tests，143 pass，0 fail，0 skipped | 现有 JS 单元/模拟 API 回归；其中主题 17 项。不能代替真实 Chrome/IME/剪贴板验收 |
| 已实现源码基线 | `PYTHONPATH=scripts python3 -m unittest discover -s scripts/tests -v` | 退出 0；53 tests，全部通过；另以 `-q` 确认计数 | 本地服务/路径/配对/对齐等回归；本次未执行真实语音模型任务 |
| 测试专用 | `scripts/ui-preview/server.py` 和 `fixture.js` | 已存在，供后续运行截图 | 同一生产 HTML/CSS/模块的隔离测试入口；需显著标“测试数据”，不证明实际下载、Native Messaging、模型成功 |
| 环境阻塞 | 已发现真实 Chrome 扩展标签页；浏览器工具 `getTab` 被 URL safety policy 拒绝 `chrome-extension:` 协议 | 当前不能自动读取/操作真实扩展页，未尝试绕过限制 | 本轮真实 Chrome 深/浅主题截图、任务与系统级人工验收仍待取得；不得用 HTTP fixture 冒充 |

上述为 **S0 修改前** 的实际检查结果。S1–S3 修改后必须重新运行适当检查，并在交接中分别标明源码通过、测试数据截图与环境阻塞项。
