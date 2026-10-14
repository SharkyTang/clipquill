# ClipQuill UI v2 · S0–S3 实施记录

第二轮 S4–S6 已接续：见 [第二轮实施与回退](s4-s6-implementation.md)、[第二轮验证](s4-s6-qa-report.md) 和 [F01–F22 矩阵](s4-s6-matrix.md)。下文保留第一轮历史记录；真实 Chrome 门槛仍未完成。

2026-10-15（Europe/London；本轮从 10 月 14 日开始）。起始状态见 [baseline.md](baseline.md)。本轮只在原扩展源码增量实现 S0–S3，停在第一轮检查点。**源码和隔离运行通过；真实 Chrome 扩展截图与真实任务验收仍阻塞，不能宣称第一轮全部验收通过。**

## S0：基线与授权

- 真实入口仍为 `outputs/douyin-independent-extension/tool.html`，由原 `background.js` action 打开；未新建产品入口、框架或工作台。
- 起始 HEAD `739e1faa89169fc42ab5a03243409f7362318cbe`，工作区干净；本轮不提交、推送、发布或改安装目录/ZIP。
- 已读详细计划全文、适用 README、manifest 与交接材料。无适用于本轮的 AGENTS.md。
- 原指定五张 `references/00...04...png` 均未定位到，确切名称与搜索范围见基线。随后实际查看用户补充的 `/Users/shaoqitang/Downloads/ClipQuill双主题界面设计参考.png`；仅将其用于卡片分层、信息顺序、蓝紫激活态和双主题对照，未复制示例视频、人物、文案、固定秒数或右侧设计说明。
- 用户明确允许给扩展内部 `work` 临时对象增加可选封面、作者和头像展示字段；本地服务、草稿与存储格式不变。
- 修改前 143 JS、53 Python 检查通过；修改后结果见 [qa-report.md](qa-report.md)。

## S1：沿用现有主题

- 保留 `theme-init.js` 和原 `clipquill.ui.theme.v1`，不建立第二套系统。已有深色、浅色、跟随系统、偏好持久化、系统变化、跨页同步及失败反馈均沿用。
- `tool.css` 为封面、媒体时长标签、元信息、阶段行、未知/错误状态使用现有语义 Tokens；新增媒体标签和弹层阴影 Tokens，修正弹层固定阴影色。
- 保留现有蓝紫羽毛笔/播放轮廓品牌与导航、编辑器结构。主操作继续蓝紫，成功/连接正常用绿色。当前稿 textarea 与事件机制不替换。
- 在隔离运行中，完成态深/浅切换前后 `transcriptText.value`、`selectionStart`、`selectionEnd` 完全一致。主题模块仍只更新根节点主题属性，不创建识别任务。
- 对语义文字/表面、成功/警告/错误、主按钮及封面时长标签计算颜色对比度：浅色最小 5.43:1、深色最小 6.29:1（检查的 9 类文字颜色对）。这不等同完整无障碍审计，禁用透明态和所有系统原生组件尚需真实 Chrome 检查。

## S2：真实视频信息卡

### 字段接线

| 字段 | 实际来源 | 回退与口径 |
| --- | --- | --- |
| 标题、作品 ID | `capturePage` 严格核对 URL 与 `RENDER_DATA.app.videoDetail.awemeId` 后读取 `itemTitle`/`desc` | 文本安全赋值；标题最多两行，悬停或键盘聚焦可看完整标题；缺标题写未知 |
| 平台 | `work.pageURL` 的官方域名与 ID 校验 | 不匹配显示未知；不由图片推断其他平台支持 |
| 封面 | 同一目标 `video.cover`、`coverUrlList`、`originCover`、`originCoverUrlList` | 无字段显示“暂无可用封面”，失败显示“封面暂不可用”；没有随机图 |
| 作者与头像 | 同一目标 `authorInfo.nickname`、`avatarThumb.urlList`、`avatarUri` | 缺作者隐藏；头像失败只隐藏头像，保留作者文字 |
| 时长、分辨率 | `video.duration` 与选中兼容 MP4 `bitRateList.width/height` | 明确标为页面元数据；不是声称从 ffprobe 接口获取尺寸 |
| 文件大小 | 候选 `bitRateList.dataSize` | 核验前标“页面标称”；Chrome `completedFile` 或 `/videos/find` 真实完整文件核验后标“本地文件已核对” |
| 复用规格 | `video.mjs:onSource` 匹配已找到文件的 height 与 expectedBytes 对应候选 | 显示实际复用候选，不误用用户的新下载清晰度偏好 |
| 预览 | 当前没有已验证可用的完整视频播放路径 | 本轮不显示播放按钮；本地磁盘路径不转成可播放 URL |

已有保存的正常页面响应中确认了字段形状和图片主机，仅输出过键名/主机名检查，没有把完整 HAR、会话字段或签名 URL 写入文档。`capturePage` 只增加有界可选展示值：作者最多 120 字、每类图片最多 6 个候选。只允许已观察到的 `p3-pc-sign.douyinpic.com`、`p9-pc-sign.douyinpic.com`、`p3-pc.douyinpic.com` 的 HTTPS 图片，拒绝凭据、端口和其他域名；图片使用 no-referrer。未扩展 host permissions/CSP。

`metadata.mjs` 是只读展示适配层。下载与提取仍为两个独立按钮；提取继续先检查并复用完整本地视频，没有要求手动先下载。封面请求使用独立加载对象与 image/source revision 校验；旧作品的封面/头像加载和错误回调不能覆盖新来源。可见图片的二次加载失败也有占位。相同作品重新查询任务不会让尚在加载的封面卡住。

### 尚未取得

- 未识别图片域名、缺字段或失效签名均降级为无封面，不为此扩大权限。
- 当前服务不返回 ffprobe 的视频宽高，不能声称分辨率来自文件探测。
- 没有可靠视频预览服务，本轮不添加播放器。
- 真实扩展加载图片的权限/网络行为待 Chrome 人工验收；HTTP fixture 没有伪装真实封面或作者。

## S3：真实事件时间线

`progress.mjs` 只记录调用者实际收到的事件，不发请求、不写 storage、不启动计时器、不推进百分比。`tool.js` 在原链路接入来源确认、服务连接、元信息解析、本地文件检查、下载或复用、任务提交、服务报告的实际阶段和结果返回；只出现本次确实观测到的步骤。支持 pending/running/completed/skipped/failed/unknown。

| 事件 | 证据与展示 |
| --- | --- |
| 下载完成 | Chrome 下载记录 complete 且实际字节数匹配后才完成；独立下载任务不等于文案完成 |
| 本地复用 | 既有 `/videos/find` 及 `onSource` 验证回调；显示“已复用”，不显示下载耗时 |
| 文件失效后的补下载 | 沿用一次重查/必要时补下载逻辑；清除已复用标记，真实发生的下载才记录下载观测时间 |
| 服务执行 | 沿用原 `/jobs/{id}` 每两秒查询；不增加平行轮询。当前后端只能报告“准备音频”和“中文模型识别与逐句时间对齐”等粗阶段 |
| 结果 | 只有校验通过的 complete 任务才记录结果返回；结果返回与当前稿写入是两种状态，保存失败仍沿用现有警示 |
| 查询失败/断连/提交响应丢失 | 状态待确认，不误报模型失败/完成；原 GET 恢复和提交未知防重复机制保留 |
| 服务失败 | 展示真实 error。服务把 stage 改成“失败”时，标明具体失败步骤未报告，最后观测的处理阶段待确认，不猜成某个音频/模型步骤 |

时间口径：有有效 `startedAt`/`finishedAt` 时，终态摘要优先显示“本地服务任务用时”，不包含下载。缺失时，仅在本页面完整观察到开始和结束、且无断线间隙的情况下显示“本页观测用时”。阶段秒数来自 `performance.now()` 的真实进入/退出观察，含最多一个或更多查询间隔，不等同引擎实际耗时；没有数据就不写秒数，低于 0.1 秒写 `<0.1 秒`。恢复历史任务或断线期间不补造阶段时间。`elapsedSeconds` 仍是原模型处理耗时，没有冒用为全流程总耗时。

运行时自动展开；完成默认折叠成摘要；用户当前任务内手动展开/折叠会保留，失败/未知会展开显示问题。重新查询相同任务保留已确认阶段，未知区间不续算成完整耗时。

元数据、图片、阶段和状态受来源代次隔离；服务结果仍校验 taskId/workId。A 的迟到运行、完成和同任务恢复响应不能改 B 的卡片、进度、通用状态或当前稿；待载入结果继续走原保护机制。

## 修改文件与目的

| 文件 | 修改理由 |
| --- | --- |
| `outputs/douyin-independent-extension/core.mjs` | 仅增加获许可的有界可选封面/作者/头像展示字段 |
| `outputs/douyin-independent-extension/metadata.mjs`（新增） | 字段校验、格式化、可信图片 URL 和缺失降级；不改候选选择 |
| `outputs/douyin-independent-extension/progress.mjs`（新增） | 纯前端事件/状态/计时适配，保留真实时间口径 |
| `outputs/douyin-independent-extension/tool.html` | 原 DOM 中增加视频卡与 details 阶段面板，保留原入口及关键 ID |
| `outputs/douyin-independent-extension/tool.js` | 绑定真实来源和原轮询，图片竞态、阶段折叠、重查及状态防覆盖 |
| `outputs/douyin-independent-extension/tool.css` | 双主题卡片/阶段/状态与紧凑独立操作；复用 Tokens |
| `scripts/extension-tests/core.test.mjs`、`metadata.test.mjs` | 元数据真实形状、缺失、URL/文本安全与展示口径 |
| `scripts/extension-tests/progress.test.mjs` | 阶段、复用、时间、恢复、未知/失败与身份隔离 |
| `scripts/extension-tests/tool-page.test.mjs`、`task-contract.test.mjs` | 原入口集成回归、封面错误/迟到、文件复用、GET-only 重试与 A/B 隔离 |
| `scripts/ui-preview/fixture.js`、`README.md`，`scripts/extension-tests/fixture.test.mjs` | 新增明确隔离的 running/failed 视觉场景及边界检查 |
| `docs/ui-v2/baseline.md`、本文件、`qa-report.md`、`screenshots/` | 记录来源、执行、截图和未验收边界 |

未改 manifest、后台消息命令、本地服务端口/接口、Python/FFmpeg/模型、`video.mjs` 复用策略、草稿键/格式、`draft.mjs` SRT 规则、`editor.mjs` IME/撤销机制、回听路径、输出命名或安装副本。没有清除生产 storage、删除历史草稿、提交/推送/发布。

## 检查点与 S4–S6

本轮停在 S3；[验证报告](qa-report.md) 中的真实 Chrome 环境门槛仍未完成。没有继续改造编辑器或大范围响应式布局。

- S4：在真实扩展确认编辑、中文 IME/撤销、当前稿复制/TXT/SRT、原音回听、模型分歧与草稿恢复；仅对发现问题精修，继续保留时间映射语义。
- S5：按原计划精修长分享输入、窄窗口滚动/键盘/性能、超长标题和长文案；不能从示意图增加第三方平台或任务按钮。
- S6：真实 Chrome 重载原扩展（先确认实际加载目录）、真实视频/缓存/任务全链路、系统主题和权限/CSP/剪贴板/下载验收；补齐真实 1440×900 深浅截图及剩余矩阵。真实门槛通过且收到新授权后才考虑打包或发布。
