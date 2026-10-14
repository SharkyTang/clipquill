# ClipQuill UI v2 · S4–S6 回归与验收矩阵

日期：2026-10-15（Europe/London）。本文件按用户提供的详细执行计划 F01–F22 记录第二轮检查结果。启动基线由独立代理复跑，以下新增浏览器结果由主代理在 Codex 内置浏览器（IAB）实际执行；运行的是原生产 HTML/CSS/模块加隔离 fixture，**不是实际 Chrome 扩展**。

## 判定口径与当前基线

- **PASS**：该列注明的自动检查或已执行观察通过；不扩展为未执行的真实环境验收。
- **FAIL**：已实际执行且未达到预期；需记录失败命令、现象与修复后的重跑结果。
- **UNVERIFIED（待验证）**：尚未执行，或只有静态实现证据，不能称通过。
- **ENV-BLOCKED（环境阻塞）**：既有工具/权限策略明确阻止该项；需要允许的真实环境操作补验。

| 基线检查 | 实际结果 |
| --- | --- |
| `git rev-parse HEAD` | `739e1faa89169fc42ab5a03243409f7362318cbe`，本轮检查时没有新提交 |
| `git status --short`、`git diff --stat` | S0–S3 和本轮增量保留，未提交；最终观察到部分文件已暂存且部分暂存版本早于工作树。本轮代理未运行 git add，未调整 index。已接入原 `tool.html`/`tool.js`，未替换产品入口 |
| `node --test --test-reporter=spec scripts/extension-tests/*.test.mjs` | **PASS：本轮修改后 189/189**，0 fail/cancelled/skipped，退出 0；本轮启动前独立复跑为 174/174 |
| `PYTHONPATH=scripts python3 -m unittest discover -s scripts/tests -v` | **PASS：53/53**，退出 0；没有运行真实语音模型任务 |
| 本轮语法与 `git diff --check` | **PASS**：语法检查和差异检查退出 0；未据此推导真实 Chrome 通过 |
| S0–S3 截图与已知限制 | 见 [第一轮验证](qa-report.md)；四张均为 1440×900 的隔离测试数据，不能作为真实 Chrome 新版本截图 |
| 本轮新 fixture 运行、布局与主题交互 | 以下已执行项目分别记 PASS；新截图位于 [screenshots/s4-s6](screenshots/s4-s6/)，不以旧截图替代 |
| 本轮真实 Chrome 扩展页与真实任务 | **ENV-BLOCKED**：本次对话已实际发现扩展工具标签页，但 `cua.getTab` 因 URL 安全策略拒绝 `chrome-extension:`，且禁止绕过。不得改用原始 CDP、其他表面或原生截图绕过 |
| 实际加载目录 | 用户已确认是仓库 `outputs/douyin-independent-extension`；对原扩展手动重载、关闭旧工具页再重开仍待完成，不能当已运行最新源码 |

本矩阵编写者未操作浏览器或用户存储；浏览器结果来自主代理本次实测与下列证据。当前自动回归无失败；**不存在“真实 Chrome 全部通过”的结论**。S0–S3 的四项封面/重试问题已修复并有回归：真实补下载清除已复用标记、文件变化重查不把下载时间算入提交、可见图片失败占位、相同作品重新查询不丢失待加载封面。

## F01–F22

“自动”列指修改后 189 项 JS 与 53 项 Python 的对应范围；VM DOM、模拟 Chrome/API、合成 composition/undo 事件不能证明系统实际交互。IAB 的真实浏览器输入、剪贴板和文件检查限定于隔离 HTTP origin，不证明 Chrome 扩展权限、消息、CSP、Native Messaging 或真实模型通过。

| 编号 | 计划要求 | 已有实现与自动证据 | 自动检查 | 本轮隔离运行 | 真实 Chrome / 系统验收 |
| --- | --- | --- | --- | --- | --- |
| F01 | 完整抖音分享文案，保留原输入 | `core.mjs:shareURL`、`tool.js:sourceURL`；分享文字/地址校验、多链接拒绝与展开回归 | PASS：解析与输入链路 | PASS：完整多行分享文字展开到 108px；收起后文字和选区不变；不代表真实短链跳转通过 | ENV-BLOCKED：扩展内实际粘贴/跳转未验收 |
| F02 | 已打开作品选择，不选工具页 | `refreshTabs` 查询官方域；`tool-page.test.mjs` 排除扩展页，`task-contract.test.mjs` 迟到列表不覆盖新选择 | PASS：模拟标签页 | UNVERIFIED：多候选选择/键盘待跑 | ENV-BLOCKED：真实 Chrome 标签列表 |
| F03 | 元信息缺字段，不填假数值 | `metadata.mjs:deriveVideoInfo`；`metadata.test.mjs` 缺失/非法字段，`tool-page.test.mjs` 标称与已核对大小 | PASS：字段降级/来源标注 | UNVERIFIED：缺封面/作者/尺寸视觉待跑 | ENV-BLOCKED：真实页面不同字段形状 |
| F04 | 真实封面可加载/失败安全回退 | `core.mjs` 可选字段；`tool-page.test.mjs` 成功、预加载失败、可见图片二次失败、旧来源迟到与同作品恢复 | PASS：合成图片事件与 DOM | UNVERIFIED：本轮图片错误样式、溢出待跑 | ENV-BLOCKED：真实 CDN、扩展网络/CSP，不可用假图冒充 |
| F05 | 不可预览时无无效播放按钮 | `deriveVideoInfo.previewURL` 保持 null；`tool-page.test.mjs` 检查封面内无伪播放控件 | PASS：生产 DOM/适配层 | UNVERIFIED：操作可达性待跑 | ENV-BLOCKED：独立下载实际行为另见 F06 |
| F06 | 独立下载不触发转写 | `start('download')`；`task-contract.test.mjs` 下载与本地模型服务独立 | PASS：模拟下载/无提交 | UNVERIFIED：本轮下载交互样式待跑，fixture 不执行真实下载 | ENV-BLOCKED：Chrome 下载权限、磁盘文件 |
| F07 | 本地视频存在时复用 | `video.mjs` 原查找与候选匹配；`video.test.mjs`、`test_transcription_bridge.py` 覆盖复用/重开/丢失/截断；入口卡片显示实际复用规格 | PASS：JS+Python 文件/接口边界 | UNVERIFIED：本轮“已复用”展示待跑 | ENV-BLOCKED：真实视频复用与模型任务 |
| F08 | 完整事件任务的顺序/状态/耗时 | `progress.mjs` 与原 `followJob`；`progress.test.mjs` 浏览器事件时间和任务级服务器时间分开 | PASS：受控时钟/事件 | PASS：running 场景在 light/dark/system 的阶段名称、文字和状态一致；UNVERIFIED：本轮完整任务阶段/时长全程逐项复核 | ENV-BLOCKED：真实服务阶段与起止时间 |
| F09 | 不完整事件不补造阶段/时间 | 恢复任务无本页开始；断连阶段 incomplete；`progress.test.mjs` 缺时间/恢复/未知状态 | PASS：不伪造耗时 | UNVERIFIED：无计时/部分阶段提示待跑 | ENV-BLOCKED：真实任务缺阶段事件 |
| F10 | 断连/轮询失败，原任务重查 | `task-contract.test.mjs` GET-only 恢复、不重复 POST；`progress.test.mjs` unknown/disconnected | PASS：查询错误与恢复契约 | PASS：最新代码 poll-error 提交→查询错误→原“重新查询原任务”返回 complete；无假失败，编辑稿不变，恢复后 serviceHelp.hidden=true。未运行全局请求计数检查，GET-only/不重复 POST 依据自动回归 | ENV-BLOCKED：真实服务断连与重新连接 |
| F11 | A 迟到不覆盖 B | source/operation/image revision、task/work ID；`task-contract.test.mjs` 新旧来源、同任务及恢复连接状态迟到，`tool-page.test.mjs` 旧图片回调 | PASS：有控制的迟到边界；恢复连接提示也校验 currentSource | UNVERIFIED：本轮来源切换视觉待跑 | ENV-BLOCKED：真实双作品任务/标签时序 |
| F12 | 重复点击/重开不重复任务 | busy/提交未知防重复；`task-contract.test.mjs` 重复点击、离页防迟到、缓存恢复；`video.test.mjs` 重开后复用 | PASS：模拟页面/请求 | PASS：重载保留 61 字符当前稿与 system 偏好；UNVERIFIED：运行时重复点击/全局提交次数，本项无运行时计数声明 | ENV-BLOCKED：真实 MV3 生命周期、重载/Native Messaging |
| F13 | 编辑、中文输入、撤销、光标 | 原 textarea/editor 保留；`editor.test.mjs` composition、合并/原生撤销映射、重复句/emoji/长文案 | PASS：合成事件/映射；系统 IME 未验证 | PASS：IAB 原生单字符 Meta+z/Meta+Shift+z；主题切换值/选区不变；10万字符保存/计数/textarea 滚动。UNVERIFIED：整组文字撤销、实际中文 IME | ENV-BLOCKED：真实 Chrome 中文输入法候选窗、撤销栈与吞字/卡顿体验 |
| F14 | 复制/TXT 来自当前稿 | `currentOutput`、`exportDraft`；当前稿到 clipboard/TXT、失败提示与真实保存重试回归 | PASS：模拟剪贴板、Blob 与文件名 | PASS：IAB 原生复制读回等于当前 35 字符编辑稿；TXT 实际下载后读文件与当前稿一致；save-error 中 retrySave 可见 | ENV-BLOCKED：实际 Chrome 扩展权限下的剪贴板/下载；IAB 文件证据不等于扩展通过 |
| F15 | SRT 跨段/新增删除沿用时间 | `draft.mjs` 算法未替换；`draft.test.mjs`/`editor.test.mjs` 原时间端点、区间合并、空稿、末端毫秒界限 | PASS：时间映射与导出内容 | PASS：IAB 实际 SRT 文件读回为当前稿，全文编辑保留原外区间 0..14500ms；本轮浏览器未覆盖全部插入/删除组合，见自动回归 | ENV-BLOCKED：实际 Chrome 字幕下载与外部播放器使用 |
| F16 | 回听/校对/最近稿保留 | 原 `reviewDetails`、片段入口与缓存；`review.test.mjs`、`task-contract.test.mjs` 共用音频请求、关闭暂停、迟到音频保护 | PASS：模拟 Blob/播放器与恢复 | PASS：390px 展开回听区域，无可用音频时没有空播放器（hasEmptyPlayer=false），不可用提示准确；pageWidth390，滚动校对时工具条 bottom844=viewport844。UNVERIFIED：真实播放/分歧内容 | ENV-BLOCKED：真实原音播放、音频设备、模型分歧内容 |
| F17 | 切换/清空/恢复不静默覆盖稿 | 未新增清空动作；`task-contract.test.mjs` 待载入、组合输入、保存失败不覆盖；`tool-page.test.mjs` 损坏草稿保留 | PASS：现有保护与原键格式 | PASS：HTTP 测试稿 61 字符重载恢复，save-error 显示重试；UNVERIFIED：本轮切换/覆盖/取消完整路径 | ENV-BLOCKED：真实扩展重开与历史用户稿；本轮不清除存储 |
| F18 | 深/浅/系统偏好重开且无漏色 | `theme-init.js` 原主题键；`theme.test.mjs` 17 项，涵盖系统事件/跨页/异步/失败/持久化 | PASS：主题逻辑；视觉不据此通过 | PASS：light/dark 值与选区保留；system 在 IAB 解析为 dark，重载仍为 system/dark 并保留 61 字符稿；设置导航打开 settingsPanel 并聚焦其 native summary。UNVERIFIED：所有状态×主题、原生主题菜单与 OS 实际切换 | ENV-BLOCKED：真实系统外观变化、Chrome 原生菜单/CSS 渲染 |
| F19 | 执行中切主题不重启/归零 | 主题仅写根属性，与任务轮询分离；自动检查单次提交/重复任务保护 | PASS：模块边界与受控任务契约 | PASS：running light/dark/system 的阶段名称、文字、状态一致；UNVERIFIED：运行时全局提交/下载计数，不由相同阶段文字推断零重复任务 | ENV-BLOCKED：真实模型执行期间主题切换 |
| F20 | 标题/文案 HTML 符号纯文本 | `textContent` 与 textarea；`metadata.test.mjs`/`tool-page.test.mjs` 不可信作者/图片 URL；`draft.test.mjs` 安全 SRT 文本 | PASS：文本/URL 安全边界 | PASS：编辑器输入含字面量 `<b>原样保留</b> & 中文🙂` 与换行后精确匹配，childElements=0；当前 IAB 标签控制台 warn/error=[]。UNVERIFIED：标题浏览器取样，标题仍仅自动覆盖 | ENV-BLOCKED：真实扩展 CSP/控制台复核；不关闭 CSP |
| F21 | 390/320px 无整页横滚，按钮可达 | 本轮响应式与入口保持原业务；布局结果以真实浏览器几何为准 | PASS：相应控件/事件回归；像素几何依据右列 | PASS：1440/1024/390/320px 页面宽=scrollWidth；1024 导航收窄且工具条 bottom710<768；390 跳转聚焦 textarea，bottom774.8<844；320 弹层 left12/right308/width296，Escape 关闭并聚焦 summary。UNVERIFIED：200%缩放/所有长内容组合 | ENV-BLOCKED：实际扩展视口、缩放、系统字体与 Chrome 渲染 |
| F22 | 生产无演示元数据/固定秒数 | 生产卡片只读真实 work；progress 不使用模拟百分比；fixture 非生产引用且有横幅，`fixture.test.mjs` 验证隔离/外网与原生入口拒绝 | PASS：生产/测试边界与无虚构时间 | UNVERIFIED：本轮截图测试标识、生产引用复核待跑 | ENV-BLOCKED：真实运行字段取样；不存在样例成功证明 |

当前没有遗留自动失败，不等于 22 项完整验收通过。一次 IAB 原生撤销最初期望整段 ` appended` 一次消失，实际只撤销最后一个字符；整组断言没有通过。随后按浏览器实际单字符撤销/重做检查通过，**不能据此宣称整组撤销已验证**。尤其真实 CDN、任务时序、IME/OS 和实际 Chrome 布局不能从模拟 API 或 IAB 推导。

## 字段与阶段的已知限制

| 数据 | 已接入来源 | 缺失/未知时的处理 |
| --- | --- | --- |
| 封面、作者/头像 | 目标 `RENDER_DATA.app.videoDetail` 的有界可选字段；严格作品 ID 绑定；仅既有观察到的图片域名 | 缺封面/失败显示占位；缺作者隐藏；头像失败隐藏；新域名不自动放开 |
| 时长/分辨率 | 页面 video.duration 与选中/实际复用 MP4 候选尺寸 | 明确页面元数据；服务尚无 ffprobe 宽高返回字段，不称文件探测结果 |
| 文件大小 | 候选声明大小，后由 Chrome 完整文件或原 `/videos/find` 校验 | 核验前为“页面标称”；无法核验不得称已保存或本地文件已核对 |
| 媒体预览 | 尚无已经验证可用且浏览器可播放的路径 | 不放假播放按钮；不把本地磁盘字符串变成假 URL |
| 服务阶段 | 当前后端只有音频准备、合并识别/逐句对齐等粗粒度 stage | 不拆成五阶段，不补字幕/校对阶段或模拟百分比 |
| 阶段耗时 | 服务器只有任务级 startedAt/finishedAt；前端用真实事件观测 | 没有服务器逐阶段起止；前端秒数含查询间隔，断线/历史缺记录不补造 |
| 失败步骤 | 后端失败会把 stage 覆盖成“失败” | 真实 error 保留；具体步骤未报告时标未知，仅注明最后观测阶段 |

## 本轮新运行记录

运行入口为既有本地 `http://127.0.0.1:4176/tool.html` 加明确的 fixture state/scenario。以下仅记录已执行项；没有真实 Chrome/模型操作或用户扩展 storage 清理。导出文件证据见 [s4-s6-export-check.json](evidence/s4-s6-export-check.json)；10万字与滚动几何见 [s4-s6-long-text.json](evidence/s4-s6-long-text.json)。

| 本轮检查组 | 状态 | 实际证据与限制 |
| --- | --- | --- |
| S4 当前稿/选区/undo/导出 | PASS（限定范围） | 35 字符当前稿实际剪贴板/TXT/SRT；单字符撤销重做；主题切换选区保留；save-error 的重试按钮；编辑器 HTML 字面量精确保留。整组撤销、真实 IME 与原音播放仍未验证 |
| S5 分享输入、1024/390/320px、10万字 | PASS（已执行组合） | 多行输入 108px 展开/收起不丢值或选区；各测量宽度无页面横滚；10万字符完整保留、计数100000、保存，wheel 后 textarea.scrollTop=844。长标题/其余极端内容组合待验 |
| 深浅/system 与运行/错误 | PASS（已执行组合） | 完成深/浅、running 三模式、save-error light、query-unknown dark 的截图；system→dark 并重载保留。不是所有状态×主题的笛卡尔积检查 |
| 设置入口与移动回听区 | PASS（限定范围） | 设置导航展开面板并聚焦原 summary；390px 无音频时无空播放器，提示保留，校对时工具条位于 viewport 底部844。没有声称真实原音或模型结果通过 |
| 查询失败与原任务重查 | PASS（隔离请求） | 最新 poll-error 未误报失败，原“重新查询原任务”返回完成，编辑稿不变，恢复后服务帮助收起；仅自动测试验证不重复 POST |
| 执行中切主题、缩放不增任务/下载 | PASS/UNVERIFIED | running 三模式阶段文字/状态保持；重复任务/下载计数仅自动测试验证。运行时全局计数与缩放联动未验证 |
| 本轮修改后完整自动回归与差异检查 | PASS | JS189/189、Python53/53，语法与 git diff --check 退出0 |
| 真实 Chrome 入口、真实视频/任务、IME/系统 | ENV-BLOCKED | 既有 URL 策略阻塞；需允许的真实环境补验，不绕过 |

本轮截图（均为测试数据）：[完成深色](screenshots/s4-s6/complete-dark-1440x900-fixture.jpg)、[完成浅色](screenshots/s4-s6/complete-light-1440x900-fixture.jpg)、[运行中 system](screenshots/s4-s6/running-system-1440x900-fixture.jpg)、[查询未知](screenshots/s4-s6/query-unknown-dark-1440x900-fixture.jpg)、[保存失败](screenshots/s4-s6/save-error-light-1440x900-fixture.jpg)、[设置浅色](screenshots/s4-s6/settings-light-1440x900-fixture.jpg)、[1024×768](screenshots/s4-s6/workspace-dark-1024x768-fixture.jpg)、[390px 来源](screenshots/s4-s6/source-dark-390x844-fixture.jpg)、[390px 编辑器](screenshots/s4-s6/editor-dark-390x844-fixture.jpg)、[390px 回听区](screenshots/s4-s6/review-dark-390x844-fixture.jpg)、[320px 来源菜单](screenshots/s4-s6/source-menu-dark-320px-fixture.jpg)。全主题原生菜单、真实音频与真实 Chrome 仍待验。

本轮最终交接必须保留未验证/环境阻塞项。本次矩阵编写未提交、推送、发布或同步安装目录；矩阵通过不自动授权这些动作。
