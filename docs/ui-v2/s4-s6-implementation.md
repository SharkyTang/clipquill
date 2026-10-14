# ClipQuill UI v2 · 第二轮实施与回退

2026-10-15，Europe/London。**S4/S5 增量源码已实现；S6 自动回归和隔离浏览器检查通过，真实 Chrome 扩展验收仍被工具 URL 策略阻塞。不能称 S4–S6 全部验收通过。**

## 起点复核

- 读取详细执行计划、第一轮 baseline/implementation-log/qa-report、当前 Git diff 和可用视觉参考。最初的 `references/00-current-running-ui.png`、`01-target-dark-light-ui.png` 仍未找到；最新可用反馈是用户补充的 `/Users/shaoqitang/Downloads/ClipQuill双主题界面设计参考.png`，本轮再次实际查看。
- HEAD 仍为 `739e1faa89169fc42ab5a03243409f7362318cbe`。S0–S3 是工作区内未提交实现；未把它当已在 Chrome 验收/发布。启动独立复跑 174 JS、53 Python 通过。
- 原导航、蓝紫 Logo、深/浅/system 主题、视频卡、阶段适配均保留。封面/作者代码已接通，真实 CDN 展示未验收；服务端没有各阶段时间，没有可验证的视频预览路径，仍按未知/隐藏降级。
- 没有新增适用 AGENTS.md。继续遵守既有入口和资料中的数据保护边界。
- 修改前保存本地源码快照：`work/ui-v2-round2-baseline-20261015/`，66 个文件及 SHA-256 清单，含第一轮尚未提交的工作。不含浏览器草稿、账号或用户媒体。

## S4：编辑、保存与回听

保留同一个原生 textarea、既有 `editor.mjs`、SRT 映射和草稿键。没有增加字幕剪辑器或给正文注入时间戳。

- 增加 `editorBody` 滚动容器，将复制/TXT/SRT 工具条放到其外；展开回听或滚动长稿时仍可使用工具条。没有运行时替换编辑器节点。
- 保存状态增加真实语义色和“重试保存”。只有草稿、结果缓存和最近稿引用的既有必需写入均成功才显示已保存；重试只写原有键，不解析来源、不下载、不创建模型任务。
- 修复取消中文组合输入后提示一直停在“输入中”的问题；按原来的成功/失败状态恢复提示。
- 修复时间映射异常后勾选校对可能把旧映射文本写回编辑框的问题。保留原始输入，复制/TXT 仍使用当前文字，SRT 继续安全拒绝；不标已保存，不更新校对记录。
- 修复剪贴板异步失败回调在用户已继续编辑或组合输入时全选正文的问题。只有稿件和编辑代次均未变且不在输入时才执行原手动复制回退。
- 损坏草稿中的 null/原始值块现在进入既有拒绝恢复与警告路径，不让有效识别结果一起隐藏。旧记录仍保留，格式与时间算法未改。
- 音频不可用、加载中或加载失败时隐藏空播放器，只显示真实说明；既有音频 Blob 成功后或已缓存时才显示播放器。回听、对照模型、片段切换与旧音频迟到保护保留。
- 恢复原任务连接成功后收起过期的服务错误帮助；旧来源的迟到连接提示也受 source revision 校验，不能覆盖新来源状态。

## S5：输入、布局与键盘

- 顶部来源区默认紧凑，提供“展开输入/收起输入”（展开内容高度 108px，可手动调整）。原 textarea 完整保留多行分享文字，不改成 URL-only，不增加新处理命令。
- 1024px 继续复用已有收缩导航。窄屏保留单栏，新增仅在窄屏出现的“编辑当前文案”锚点，直接聚焦既有 textarea，减少跨视频卡寻找文案的滚动。
- 390/320px 来源菜单、操作、工具条可达；窄屏工具条使用视口 sticky，修正 overflow 祖先约束。封面限制高度但不拉伸图片。
- 增加当前稿跳转链接、输入展开 ARIA 状态和复制/导出组标签。来源菜单 Escape 返回 summary；展开来源可 Escape 收起，组合输入时不拦截 Escape。显式打开设置/帮助后把焦点放到其原生 summary。
- 所有新样式使用既有 Tokens；轻量交互遵守 prefers-reduced-motion。没有新框架、远程运行时或主题系统。

## 第二轮改动文件

以下为**相对第一轮快照**的八个源码/测试文件，区别于仍未提交的第一轮改动：

| 文件 | 理由 |
| --- | --- |
| `outputs/douyin-independent-extension/tool.html` | 原入口中调整正文/工具条层级、保存重试、来源展开和窄屏文案锚点；保留原 ID |
| `outputs/douyin-independent-extension/tool.css` | 工具条/滚动、保存语义色、紧凑来源、窄屏可达性和焦点样式 |
| `outputs/douyin-independent-extension/tool.js` | 保存/IME/剪贴板异常保护、原音可用性展示、来源展开、键盘焦点与恢复状态校验 |
| `outputs/douyin-independent-extension/draft.mjs` | 仅为损坏 saved.blocks 增加形状校验；不更改映射算法或存储格式 |
| `scripts/extension-tests/tool-page.test.mjs` | 输入取消、保存重试、映射异常、剪贴板迟到和来源折叠回归 |
| `scripts/extension-tests/task-contract.test.mjs` | 原音显隐/迟到、恢复连接提示迟到与既有任务契约回归 |
| `scripts/extension-tests/editor.test.mjs` | 跨段 IME 撤销/重做、emoji 前向删除、10 万字符与有界历史 |
| `scripts/extension-tests/draft.test.mjs` | 损坏草稿回退且不修改原数据 |

文档新增本文件、`s4-s6-qa-report.md`、`s4-s6-matrix.md`、`evidence/s4-s6-*` 与 `screenshots/s4-s6/`；第一轮日志增加续作链接。原 manifest、模型、FFmpeg、Python、服务端口/协议、下载/复用、文件名/路径、主题键和用户数据没有变更。本轮代理未运行 git add/commit/push，没有发布或生成新安装包；最终检查出现的已有暂存状态原样保留，详见验证报告。

## 原扩展重载

用户已在本轮确认当前 Chrome 原扩展加载的是仓库 `outputs/douyin-independent-extension`，因此本轮无需同步 Application Support 副本。

1. 在旧工具页先完成当前输入；保存失败的稿件先复制/TXT 导出，在途任务先记录状态。不要卸载或清空存储。
2. 在 Chrome 扩展管理中找到**原 ClipQuill**，点击“重新加载”；不新建扩展身份，不改 key 或配对目录。
3. 关闭旧工具页，再通过原扩展按钮打开新工具页。manifest 版本仍为 0.1.5；新 UI 可用“展开输入”和窄屏“编辑当前文案”识别，“重试保存”仅在真实保存失败时出现。
4. 当前稿、主题和原任务引用继续使用原存储。下载/提取仍是两个独立按钮；本地助手仍按原方式自动连接。

本轮工具不能操作或观察真实 `chrome-extension:` 页面，所以上述是**人工重载步骤，不是已完成的重载记录**。需补真视频、原音、IME、系统外观及 1440/1024/390 的真实 Chrome 验收，见矩阵。

## 精确回退第二轮

不要对整个工作区使用 `git restore`/reset：第一轮仍有未提交实现，会被一起撤掉。

已生成仅涵盖上述八个文件的 [第二轮代码补丁](evidence/s4-s6-code.patch) 和 [前后 SHA-256 清单](evidence/s4-s6-code-files.json)。本轮只运行过以下**只读回退检查**，退出 0，没有实际回退：

```sh
git apply --reverse --check docs/ui-v2/evidence/s4-s6-code.patch
```

需要回退时，先备份此刻工作区，再重新执行该检查；若检查失败，说明相关文件已有其他修改，应停下核对，不能强制覆盖。检查通过且确认回退时，再由用户执行：

```sh
git apply --reverse docs/ui-v2/evidence/s4-s6-code.patch
```

该补丁只恢复工作树中的八个文件到第二轮开始时的第一轮状态，不修改暂存区。最终检查时已有部分文件暂存，因此回退前还必须核对工作树与暂存区差异，不能把旧暂存内容误作回退后的内容提交。补丁不碰浏览器 storage、识别结果、视频或 Git 历史；验证文档和截图保留为记录。之后按上面步骤重载原扩展。快照也可作为逐文件审阅来源；没有运行自动回退。
