# ClipQuill

## UI 重构：S3 视觉检查点（2026-10-14）

当前扩展源码已接入蓝紫羽毛笔品牌、浅色/深色/跟随系统主题，以及宽屏工作区和窄屏单栏布局。唯一入口仍为浏览器扩展标签页，下载、提取、编辑、恢复与 TXT/SRT 沿用原实现。详见 [S0–S3 交接](docs/ui-redesign/handoff.md) 和 [验证报告与实现截图](docs/ui-redesign/qa-report.md)。目前 94 项 JavaScript、53 项 Python 检查通过；截图来自明确隔离的 HTTP fixture，真实 Chrome 新界面端到端仍待验收。S4–S6 未开始，现有 ZIP 和安装目录未更新。

## 当前仓库版本：v0.1.5（2026-10-14）

当前扩展源码与使用说明见 [扩展 README](outputs/douyin-independent-extension/README.md)，扩展包为 `outputs/douyin-independent-extension-v0.1.5.zip`。点击“提取文案”会先连接本地服务；服务未运行时，通过已安装的本地助手自动后台启动，连接成功后继续解析、复用视频和识别。启动失败提供“重试启动并提取”，重试保留原任务的链接、所选作品、清晰度和术语。下载视频不需要安装或启动助手。现有后台解析、登录/验证提示、当前稿和 TXT/SRT 功能保留。

首次安装包 `outputs/ClipQuill-v0.1.5-mac-arm64.zip` 内置可移动的 Python、固定版本依赖、FFmpeg/ffprobe、Whisper 可执行文件及动态库。双击包中的“首次安装.command”，自动下载固定版本并校验 SHA-256 的模型、准备隔离环境及配对 Chrome 扩展。安装目录固定在当前用户的 `Library/Application Support/ClipQuill`；解压目录可以在完成后移走。安装无须 Homebrew、Python、编译工具、手动填扩展 ID 或修改 shell 配置。首次下载约 4.0 GiB 模型，支持下载中断后续传。当前安装包限制 Apple Silicon Mac + macOS 26 或更新版本 + Chrome。

70 项 JavaScript、53 项 Python 检查通过，覆盖服务复用、首次启动、失败重试、连接验证、精确扩展配对、跨进程启动锁、下载续传与校验及既有功能。本机独立环境的安装、真实模型处理、失败重试与结果恢复通过；用户在真实 Chrome 确认了“服务已停止 → 点击提取 → 自动启动 → 完成提取”，对应后台任务已核对完成。完整证据见 [v0.1.5 验证记录](outputs/自动启动与首次安装验证.md)。自动浏览器工具禁止访问扩展 URL，Chrome 操作由用户完成。其他电脑的完整安装、Developer ID 签名和公证仍未完成。

仓库保存源码、测试、文档、安装入口、固定模型清单和扩展包。大体积安装包、模型、Python 环境、原始抓取、视频、音频、转写结果、截图和本机记录保留在本地，不随 Git 提交。可用 `scripts/build_helper_installer.py` 从本机已验证的环境重建安装包，构建脚本会收集并重定位动态库、保留来源和许可证，并验证独立运行；用户不需要执行构建。

## 原型历史验证记录（2026-10-12）

当前状态：Chrome 扩展已安装，原始短链接的一键下载、一键文案提取均已实测。自动获取的目标 MP4 为 720p、300 秒、27,594,766 字节，完整 SHA-256 与轻抖导出文件相同。扩展自动交给本机 Qwen3-ASR 转写、对齐，并用 Whisper 对照提示分歧，支持逐句回听、校对和 TXT/SRT 导出。

最新结论：`outputs/轻抖视频来源-字节级验证.md`。扩展源码和使用方法：`outputs/douyin-independent-extension/README.md`。

2026-10-12 浏览器实测证据：`outputs/extension-browser-validation.json`、`outputs/extension-browser-success.png`。已修复短链接跳转的跨域问题，以及直达页没有首屏作品数据的问题；14 项扩展测试通过。当前验收范围是本机已登录 Chrome 中的一条样本，尚未验证其他作品、未登录环境或 1080p 下载。

精校版最新实测见 `outputs/文案精度优化验证.md`。

旧版本文案接入时的历史实测：`outputs/extension-transcription-validation.json`，完整流程 2 次成功，分别用时约 49.0 / 45.6 秒（本地转写阶段，不含下载），均产生 1,528 字、26 段字幕。已实测自动显示全文、复制、TXT/SRT 导出和重新打开后恢复结果。现有及新增检查共 38 项通过（17 项扩展测试、21 项 Python 测试）。

## 日常使用

1. 首次安装本地助手。新用户双击完整安装包中的“首次安装.command”；本项目的旧用户双击 `outputs/首次安装.command`，会复用已有模型、配对原扩展目录并迁移旧任务。之后在 Chrome 对原扩展点击“重新加载”，再重新打开工具页，不要卸载或清除存储。
2. 从 Chrome 扩展按钮打开本地工具，粘贴分享链接，点击“提取文案”。工具会先检查已下载的完整视频，能复用时直接识别；没有完整文件时下载后自动识别。首次下载期间保持工具页打开。
3. 完成后复制全文或导出 TXT / SRT。刷新/重新打开后，可恢复当前稿。安装版原始结果位于 `Library/Application Support/ClipQuill/outputs/extension-transcripts/`。回听和恢复服务上的任务也会自动连接助手；本机缓存稿的编辑、复制和导出仍可离线进行。

电脑重启后直接点击“提取文案”，不需要手动打开终端或设置登录启动。第一次安装之外不会下载模型。启动失败点击重试会自动启动并继续同一条任务。

详细说明：`outputs/文案提取使用说明.md`。服务仅绑定本机 `127.0.0.1:8766`，识别不使用云 API。输入必须是扩展下载目录中的完整 MP4，一次运行一个任务，当前支持一小时以内的视频。模型结果仍需逐句核对，未承诺整体准确率。2026-10-12 精校版在原样本上用时 23.861 秒；具体改善、剩余错误及验证范围见 `outputs/文案精度优化验证.md`。

更正：此前把网页 `allowDownload: false` 当成媒体不可访问的证据，判断过强。本样本该字段为 false，但不带 Cookie、Authorization 的普通 CDN 请求返回 200/206；解析报告中的 `restricted` 仅记录页面下载标志，不是 HTTP 访问结论。

技术结论与证据见 `outputs/独立实现技术结论.md`。

最新实测见 `outputs/抖音原始响应实测结论.md`，脱敏元数据见 `outputs/douyin-target-metadata.json`。

## 离线解析抖音响应

`scripts/inspect_douyin_response.py` 支持正常浏览后保存的 JSON、HTML、HAR。新增支持页面中 URL 编码的 `RENDER_DATA` JSON，以及网页使用的 `awemeId`、`playAddr`、`bitRateList`、`bitRateAudioList`、`download.allowDownload` 字段。它不执行网页脚本、不发起网络请求、不导出完整媒体地址、不覆盖下载限制。

```sh
python3 scripts/inspect_douyin_response.py work/live-capture/target-page.har \
  --work-id 7689864994510343451
PYTHONPATH=scripts python3 -m unittest discover -s scripts/tests -v
```

真实样本验证结果：`target_found`，下载状态 `restricted`，20 个画质/格式条目、1 个独立音轨。50 条候选地址记录包含主备地址和重复引用，不代表 50 个视频。15 项离线测试通过。

原始 HAR 仅留在被版本控制忽略的 `work/`，不要对外分享：浏览器的脱敏导出仍可能保留页面正文和 URL 参数中的个人信息。

## 当前精校转写

```sh
work/asr-venv/bin/python -B scripts/transcribe_accurate.py /绝对路径/视频.mp4 \
  --output outputs/new-accurate-transcript --terms "可选专有名词"
```

依赖与使用方法见 `outputs/文案提取使用说明.md`；所有推理使用已下载的本地模型，运行时启用离线模式。

## 原 Whisper 转写入口（保留用于对照）

当前电脑已在本项目 `work/independent-asr/` 中准备 whisper.cpp、Whisper large-v3-turbo Q5_0、Silero VAD。依赖已有 FFmpeg、ffprobe 和 Python 3。文件复制到其他电脑时需另行准备这些依赖；本项目尚非可分发安装包。

```sh
python3 scripts/transcribe-local.py '/绝对路径/视频.mp4' \
  --output outputs/new-transcript \
  --terms '简体中文。OpenAI，Claude，Opus，GPT。'
```

默认 CPU，输入为本地文件，输出目录必须不存在。运行时不调用轻抖或语音云 API。生成原始文稿 TXT、SRT、JSON、处理日志和验证清单；结果仍需人工校对。

`--seconds 30` 可只验证开头 30 秒。`--gpu` 已在本机 Apple M5 Pro 上实测。`--model` 支持替换模型，`--no-vad` 用于关闭语音检测做对照。

## 来源

- whisper.cpp v1.9.5 官方源码与文档：https://github.com/ggml-org/whisper.cpp
- Whisper 模型：https://huggingface.co/ggerganov/whisper.cpp
- VAD 模型：https://huggingface.co/ggml-org/whisper-vad
- 下载路径研究参考：https://github.com/yt-dlp/yt-dlp

本项目未修改或提交上述开源仓库。后续打包分发须保留所用组件及模型的许可证声明。
