# ClipQuill UI v2 · 第二轮验证报告

2026-10-15，Europe/London。**S4/S5 源码和可执行的 S6 检查通过；真实 Chrome 扩展、真视频、系统 IME/外观、原音和真实截图仍 ENV-BLOCKED。** 所有下列运行截图均为明确标注的测试数据，不是真实模型任务成功证据。

完整 F01–F22 判定见 [验收矩阵](s4-s6-matrix.md)，改动与重载/回退见 [实施记录](s4-s6-implementation.md)。

## 实际检查

| 检查 | 实际命令/方式 | 结果 |
| --- | --- | --- |
| 修改前基线 | `node --test --test-reporter=spec scripts/extension-tests/*.test.mjs` | PASS：174/174 |
| 修改后完整 JS | 同上 | PASS：189/189，0 fail/cancelled/skipped |
| Python | `PYTHONPATH=scripts python3 -m unittest discover -s scripts/tests -v`；修改后 `-q` | PASS：53/53；未运行真实模型 |
| 语法 | `node --check outputs/douyin-independent-extension/tool.js`、`node --check outputs/douyin-independent-extension/draft.mjs` | PASS，退出 0 |
| 差异格式 | `git diff --check` | PASS，退出 0 |
| 仅第二轮回退验证 | `git apply --reverse --check docs/ui-v2/evidence/s4-s6-code.patch` | PASS，退出 0；没有实际反向应用 |
| 运行页 | 既有 `python3 scripts/ui-preview/server.py --port 4176`，`lsof -nP -iTCP:4176 -sTCP:LISTEN` 确认 | PASS：原生产 HTML/CSS/JS 加显著隔离拦截器，不连接真实 Chrome/抖音/8766/模型 |
| 浏览器控制台 | IAB `dev.logs` warn/error | 检查时为空 |

开发中新增回归真实暴露了 IME 取消提示、映射异常覆盖、剪贴板迟到选区、损坏草稿恢复等失败，均修复后重跑通过。浏览器最初把字符串 ` appended` 当一个整体撤销单元的比较为 false；实际原生撤销只撤销最后一个字符。随后按真实逐字符粒度检查 Meta+z/Meta+Shift+z 均通过，**没有把整组撤销或系统中文输入法标为通过**。

最终 Git 检查时，部分文件已进入暂存区（起始为空），且有些暂存版本早于当前工作树。本轮代理未执行 git add/commit/push，暂存来源未核实，已保留该状态；没有清理或改写 index。HEAD 仍为 `739e1faa89169fc42ab5a03243409f7362318cbe`。验证对象为当前工作树，第二轮八个文件的最终 SHA-256 已核对。

320px 首次截图实际像素高度为 693，未将文件名当作实际视口证据。最终再次读取 CSS 视口为 320×740 并重拍，报告引用新的 `320px` 图；原裁切图作为记录保留。

## 实际运行断言

| 项目 | 观察与证据 | 结论边界 |
| --- | --- | --- |
| 完整分享内容 | 多行文字＋官方 URL 保留；展开高度 108px，收起不改文字；原按钮走原解析/复用/任务链路 | PASS：隔离边界；真实抖音导航另验 |
| 当前稿复制 | 原按钮复制的 35 字当前编辑稿与剪贴板读取完全一致 | PASS：IAB；不是原 Chrome 系统剪贴板验收 |
| TXT/SRT | 原导出按钮实际生成文件并读取核对；TXT 与当前稿逐字一致，SRT 为同一稿，跨段全文编辑保留原外区间 0..14500ms | PASS：[导出核对记录](evidence/s4-s6-export-check.json)，不推导真实视频准确率 |
| 主题/恢复 | light/dark 前后 value/selectionStart/selectionEnd 一致；system 解析为当前 dark，刷新后 system 与 61 字当前稿保留 | PASS：IAB；没有切换真实 OS 外观 |
| 原生撤销/重做 | 真实 textarea 键盘输入一个字符后，Meta+z 恢复前文、Meta+Shift+z 恢复该字符 | PASS：IAB 单字符；IME/原 Chrome 仍未验收 |
| 长稿 | 100000 字符完整保留，计数为 100,000，实际写入成功；独立 textarea wheel scrollTop 844，页面无横向溢出，工具条仍在视口内 | PASS：[长稿几何记录](evidence/s4-s6-long-text.json)；不是系统性能基准 |
| 保存失败 | storage-error 场景显示错误色、真实失败提示与重试保存，当前稿仍可复制/导出 | PASS：隔离故障；成功重试/失败前提与组合输入保护由入口测试覆盖 |
| 处理中主题切换 | dark/light/system 后阶段标签、working 状态和当前文案保持一致 | PASS：UI 观察；单提交/GET-only 计数由自动契约检查证明 |
| 断连/恢复 | poll-error 显示连接中断/待确认和原任务 GET 重查；重查后返回结果，已编辑稿不变，过期服务帮助收起 | PASS：边界模拟；没有停止真实服务来验收 |
| 回听/设置 | 缺音频只显示说明，不显示空播放器；390px 展开回听时工具条底边为 844；打开设置后 summary 获焦 | PASS：IAB；真实音频设备/原音不在范围证据中 |
| 不可信文字 | `<b>原样保留</b> & 中文🙂` 留在 textarea.value，childElements 为 0 | PASS：当前稿纯文本；标题安全由自动检查覆盖 |

测试导出仅产生两个带测试作品 ID 的文件：`Downloads/1000000000000000001_文案_当前稿.txt` 和同名 `.srt`，本轮未删除它们。没有读取或清理真实扩展草稿。

## 视口、滚动和键盘

| CSS 视口 | 实际断言 | 结果 |
| --- | --- | --- |
| 1440×900 | 保留导航＋视频栏＋编辑器；工具条独立于正文滚动；深浅截图 | PASS：隔离运行 |
| 1024×768 | 页面宽度=1024；导航文字收缩；工具条 bottom=710 < 768 | PASS：隔离运行 |
| 390×844 | 页面宽度=390；窄屏锚点聚焦原 textarea；普通稿工具条 bottom≈774.8 < 844，展开回听滚动时 bottom=844 | PASS：隔离运行 |
| 320×740 | 页面宽度=320；来源 popover left=12/right=308/width=296；Escape 关闭并焦点回 summary | PASS：隔离运行 |
| 原 Chrome / 200% 缩放 / 系统字体 | URL 策略阻塞，未获取实际渲染 | ENV-BLOCKED；不由上述 IAB 数值推断 |

未完成所有“状态×主题×视口”的笛卡尔积；当前验收矩阵对此保留未执行项。系统 IME 候选窗、真实原音、真实模型分歧、实际网络封面、真实 Chrome CSP/权限与真实系统外观变化仍需人工补验。

## 本轮截图（全部测试数据）

| 场景 | 截图 |
| --- | --- |
| 完成/当前稿，1440×900 | [深色](screenshots/s4-s6/complete-dark-1440x900-fixture.jpg)、[浅色](screenshots/s4-s6/complete-light-1440x900-fixture.jpg) |
| 1024×768，导航收缩 | [工作区](screenshots/s4-s6/workspace-dark-1024x768-fixture.jpg) |
| 390×844 | [来源](screenshots/s4-s6/source-dark-390x844-fixture.jpg)、[文案](screenshots/s4-s6/editor-dark-390x844-fixture.jpg)、[回听降级](screenshots/s4-s6/review-dark-390x844-fixture.jpg) |
| 320×740，来源菜单 | [菜单与边界](screenshots/s4-s6/source-menu-dark-320px-fixture.jpg) |
| 保存失败，1440×900 | [浅色错误与重试](screenshots/s4-s6/save-error-light-1440x900-fixture.jpg) |
| 处理中/system 当前解析 dark | [动态阶段](screenshots/s4-s6/running-system-1440x900-fixture.jpg) |
| 查询断连 | [状态待确认](screenshots/s4-s6/query-unknown-dark-1440x900-fixture.jpg) |
| 设置与焦点 | [浅色设置](screenshots/s4-s6/settings-light-1440x900-fixture.jpg) |

![深色测试数据](screenshots/s4-s6/complete-dark-1440x900-fixture.jpg)
![浅色测试数据](screenshots/s4-s6/complete-light-1440x900-fixture.jpg)

## 真实 Chrome 门槛

本对话中真实扩展 `chrome-extension:` 访问被浏览器工具安全策略明确拒绝，并禁止改用其他表面、原始 CDP 或间接执行绕过。没有反复尝试绕过。用户确认加载目录为仓库 `outputs/douyin-independent-extension`，但**本轮仍没有实际重载/观察原 Chrome、运行新真实视频或取得真实两主题截图**。

S6 剩余门槛：按实施记录重载原扩展；在真实视频上核对封面/作者/候选信息和实际阶段；独立下载/复用、离线与原任务恢复、真实编辑/IME/剪贴板/字幕/原音；取得 1440×900 深浅和 1024/390 真实 Chrome 截图。尚缺服务端逐阶段时间、ffprobe 宽高返回、可靠视频预览路径的字段继续降级，不修改协议填补。

没有发布、推送、提交、更新 ZIP 或同步安装副本。未验证/环境阻塞不计为通过。
