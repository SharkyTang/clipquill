# ClipQuill UI：S0–S3 实施记录

日期：2026-10-14。停止点：S3 第一次视觉检查点；S4–S6 未开始。改动仍未提交、未推送、未发布；原 v0.1.5 ZIP 与安装目录未重建或覆盖。

## 材料与授权边界

最初仓库里没有命名为 `ClipQuill_UI_Handoff_2026-10-14` 的文件夹；实际完整规划、补充提示词和两张原图位于用户提供的 Downloads 路径。本轮已原样复制到本目录下同名文件夹，保留 `references/` 相对引用，便于后续对话接续。用户当前请求决定本轮范围；交接文档中的建议组件名/目录名/后续阶段不是既有能力事实，也不构成自动进入 S4–S6 的授权。

## S0：审计

详见 [baseline.md](baseline.md)。修改前工作区干净；无适用 AGENTS.md。唯一宿主是 MV3 action 打开的完整扩展标签页；原生 HTML/CSS/ES Modules，无前端编译器。现有 70 JS、53 Python 检查通过。只读既有服务健康检查与已有 287 段结果的数据编辑/导出/恢复验证通过，未创建新的下载或推理任务。

浏览器策略禁止 `chrome-extension://` 内容访问；没有继续通过其他表面或协议绕过。随后仅用用户允许的隔离 fixture 运行同一份 HTML/CSS/JS，验证布局与部分页面交互。真实 Chrome 扩展入口验收仍待人工进行。

## S1：品牌

- `assets/brand/clipquill-logo.svg` 与 `clipquill-logo-small.svg`：按第二张参考重绘的蓝紫羽毛笔 + 播放符号矢量源，小母版减少细节。
- `icons/icon16.png` / `icon32.png` / `icon48.png` / `icon128.png`：深色中性底板；`favicon16.png` / `favicon32.png`：透明底。
- `scripts/render_clipquill_icons.cjs`：可复现 PNG 导出与实际尺寸检查图；使用已有 sharp 开发工具，没有新增运行依赖。实际成功命令：`NODE_PATH=/Users/shaoqitang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules node scripts/render_clipquill_icons.cjs`。该路径由 `load_workspace_dependencies` 返回；其他机器可使用已有可用 sharp。
- manifest 名称、short_name、action 标题统一为 ClipQuill；增加 PNG 映射。页面 title 与 favicon 同步统一。
- manifest version 仍为 0.1.5；权限、host permissions、worker、原入口与身份配置未改变。未发现动态旧标题/图标写回。
- 图标已在深浅底实际 16/32/48/128 像素检查；Chrome 原生工具栏、标签和管理页面仍未在本轮验收。

## S2：主题

- `tool.css` 使用规划中完整 `--cq-*` 语义 token；补充成功/警告/错误底色与选中底色。页面、导航、卡片、输入、编辑器、工具条、来源弹层、原生 select、回听面板、状态、焦点、选中文本、滚动条、禁用与 reduced-motion 均使用同一组变量。
- `theme-init.js` 是包内外部经典脚本，在 CSS 前加载；同步枚举缓存尽早设置根属性，然后以 `chrome.storage.local` 为权威。没有内联脚本、CDN 脚本或 CSP 放宽。
- 新增唯一设置键 `clipquill.ui.theme.v1`；值为 light / dark / system。首次 system；显式偏好优先、持久化、其他页面同步；系统事件只在 system 模式响应。localStorage 同名枚举只是首屏缓存，不迁移任何旧数据。
- 防止迟到初始化覆盖、快速写入乱序、旧事件回声和同值写入遗留回声；存储错误显示真实提示，当前页面仍可切换。页面卸载清理监听。
- 17 项主题 VM 测试通过。真实 Chrome 跨页面事件、系统切换与首屏闪烁仍需人工验证。

## S3：真实入口布局

直接修改 action 原先打开的 `tool.html`，保留业务 DOM ID 和原事件。184px 导航 + 顶部来源栏 + 320px 视频操作栏 + 大编辑区；1024–1279px 导航缩为 64px；小于 1024px 降级单栏/紧凑视频区；390px 与 320px 不塞三栏。

- 下载与提取仍调用原流程；提取不要求手动先下载。旧稿在新任务失败后保留。
- “已打开作品”仍按原限定 URL 查询并过滤作品 ID；空列表增加说明，不抓自身扩展页、不新增网页权限。
- 最近文案仅导航到已有当前稿或展开原恢复入口；没有虚构多任务历史、取消、时间轴或新模块。
- 编辑器仍是原 textarea；主题只改根样式，不重建编辑器。复制/TXT/SRT 仍读取当前稿；draft/review/对齐实现未改。
- 增加真实字数、同步存储成功/失败状态和连接确认状态；版本从 `chrome.runtime.getManifest()` 读取。
- 导出工具条在编辑区内 sticky；展开长校对区后仍可见。为避免滚动顶部露出被覆盖控件，修正 sticky 偏移和 scroll-padding。
- 标准界面图标随包 vendored Heroicons（MIT），不是 emoji；品牌 SVG 为用户明确要求的重绘源。

## 相对参考图的必要偏离

1. 蓝紫代替绿色主品牌；不画假窗口按钮或 Chrome 原生壳。
2. 真实捕获响应没有封面/作者字段；没有生成假视频、封面或播放按钮。恢复旧稿并不声称已重新解析当前来源。
3. 无独立元数据预览接口，因此保留“下载视频/提取文案”直接触发原流程，未添加“开始处理/获取作品”的新协议。
4. 无完整历史，使用最近文案；已有回听与细致校对保留折叠入口，未造新时间轴页签。
5. 辅助参数放视频栏折叠卡，服务帮助与最近恢复放同一栏；正文空间优先。
6. 没有清空按钮、虚构耗时/百分比、10,000 字限制或支持平台宣传；只显示实际阶段与字符数。
7. 提供窄视口完整页截图；不存在原生 side panel/popup 宿主。

验证详情、截图与限制见 [qa-report.md](qa-report.md)，接续步骤见 [handoff.md](handoff.md)。
