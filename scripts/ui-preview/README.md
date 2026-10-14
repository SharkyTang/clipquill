# 隔离 UI fixture

仅供 UI、错误态和当前稿保护回归，不能证明真实扩展的权限、CSP、消息、下载、Native Messaging、本地服务或识别通过。预览使用同一份生产 HTML/CSS/模块；`server.py` 额外注入本目录的测试拦截器。扩展 manifest 和生产页面不引用 fixture。

启动：`python3 scripts/ui-preview/server.py --port 4176`。访问以下页面，所有页面都有“隔离 UI 测试”横幅：

| URL | 用途 |
| --- | --- |
| `http://127.0.0.1:4176/tool.html?state=complete` | 原有完成文案布局，不提供模拟来源和服务 |
| `http://127.0.0.1:4176/tool.html?state=empty` | 原有空态 |
| `http://127.0.0.1:4176/tool.html?state=complete&scenario=success` | 模拟元数据、已下载文件复用、两个真实格式的阶段、第三次查询返回不同 ID 的测试结果 |
| `http://127.0.0.1:4176/tool.html?state=complete&scenario=running` | 保持模拟运行阶段，供阶段展开与主题检查；不是实际识别任务 |
| `http://127.0.0.1:4176/tool.html?state=complete&scenario=failed` | 第二次查询返回模拟失败和真实格式错误；不是实际模型失败 |
| `http://127.0.0.1:4176/tool.html?state=complete&scenario=poll-error` | 第一次 GET 连接失败，显示“重新查询原任务”；重试 GET 返回同一新任务结果，不重新 POST |
| `http://127.0.0.1:4176/tool.html?state=complete&scenario=submit-unknown` | POST 响应丢失，提交状态未知，核对 UI 没有自动重复提交 |
| `http://127.0.0.1:4176/tool.html?state=complete&scenario=storage-error` | 仅模拟 `draft-v1-*` 的写入失败，当前内容、复制和 TXT 保留；其他设置仍可保存 |

场景页中打开“已打开作品”，选择带【隔离测试】标题的作品，选择“提取文案”后处理；也可以粘贴 `https://www.douyin.com/video/1000000000000000001` 或末尾为 `2` 的第二个测试链接。这里的链接、元数据、文件路径、阶段和结果都是测试数据。没有打开抖音页面、读取用户视频或执行模型。

新任务 ID 为 `eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee`（第二作品为 `dddddddddddddddddddddddddddddddd`），与初始缓存的 `ffffffffffffffffffffffffffffffff` 不同。先编辑初始文案，再运行 success，可检查新结果等待载入、旧稿保存与载入确认。未编辑时允许直接显示新结果。成功场景通常约 4 秒结束，计时来自该次模拟提交时刻。

`window.ClipQuillFixture.inspect()` 只读返回场景名、提交/查询/原生启动/下载尝试次数、模拟路径与明确的隔离标记，便于检查重试是否只有 GET。原生启动和视频下载 shim 始终抛错；这里不能验证下载成功。`/health`、`/videos/find`、`/jobs` 与已知任务 GET 全部由 JS 直接返回；未知服务接口和其他跨域 fetch 拒绝，不会访问真实 `8766` 服务。

切换 state/scenario 时，仅重置该 HTTP origin 的已知 fixture 缓存键；同一场景刷新保留测试当前稿。fixture 在 `chrome-extension:` 或其他非本机 HTTP origin 上拒绝运行，不修改扩展存储。测试完关闭预览即可；不要把此 HTTP 预览当作真实扩展验收。
