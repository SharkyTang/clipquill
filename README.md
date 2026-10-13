# 抖音独立工具验证

## 当前仓库版本：v0.1.2（2026-10-13）

当前扩展源码与使用说明见 [扩展 README](outputs/douyin-independent-extension/README.md)，扩展包为 `outputs/douyin-independent-extension-v0.1.2.zip`。阶段 0/1 的本机验收范围与待验证项见 [验收报告](outputs/phase-01/验收报告.md)。

仓库保存源码、测试、文档、本地服务启动入口、模型来源说明和当前扩展包。模型、Python 环境、原始抓取、视频、音频、转写结果、截图、历史扩展包与验收过程文件保留在本地，不随 Git 提交；下文历史记录中指向这些文件的路径仅适用于原本机项目。新电脑仍需按使用说明准备依赖、模型和扩展身份，本次提交不代表完成跨机器安装验收。

## 原型历史验证记录（2026-10-12）

当前状态：Chrome 扩展已安装，原始短链接的一键下载、一键文案提取均已实测。自动获取的目标 MP4 为 720p、300 秒、27,594,766 字节，完整 SHA-256 与轻抖导出文件相同。扩展自动交给本机 Qwen3-ASR 转写、对齐，并用 Whisper 对照提示分歧，支持逐句回听、校对和 TXT/SRT 导出。

最新结论：`outputs/轻抖视频来源-字节级验证.md`。扩展源码和使用方法：`outputs/douyin-independent-extension/README.md`。

2026-10-12 浏览器实测证据：`outputs/extension-browser-validation.json`、`outputs/extension-browser-success.png`。已修复短链接跳转的跨域问题，以及直达页没有首屏作品数据的问题；14 项扩展测试通过。当前验收范围是本机已登录 Chrome 中的一条样本，尚未验证其他作品、未登录环境或 1080p 下载。

精校版最新实测见 `outputs/文案精度优化验证.md`。

旧版本文案接入时的历史实测：`outputs/extension-transcription-validation.json`，完整流程 2 次成功，分别用时约 49.0 / 45.6 秒（本地转写阶段，不含下载），均产生 1,528 字、26 段字幕。已实测自动显示全文、复制、TXT/SRT 导出和重新打开后恢复结果。现有及新增检查共 38 项通过（17 项扩展测试、21 项 Python 测试）。

## 日常使用

1. 本机模型已经就绪。电脑重启后，先双击 `outputs/启动本地文案服务.command`，保留服务窗口。当前服务已运行，无需再次启动。
2. 从 Chrome 扩展按钮打开本地工具，粘贴分享链接，点击“提取文案”。保持工具页打开，下载完成后自动进行本地识别。
3. 完成后复制全文或导出 TXT / SRT。刷新/重新打开后，可点“恢复上次识别”。结果也保存在 `outputs/extension-transcripts/`。

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
