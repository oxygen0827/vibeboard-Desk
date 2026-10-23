# ATOM Connect 电脑端

本程序在电脑本地运行，通过出站 HTTPS 轮询中继服务器接收 ATOM 的任务，调用本机 Codex 官方 stdio app-server，回传文本、状态、审批与结果。它管理自己的会话，不接管已有 Codex 桌面窗口。

## 启动

需要 Node.js 22 或更新版本、已安装并登录的官方 Codex CLI。模型使用电脑端 Codex 的账号配置，本程序不读取或上传账号密钥。

```sh
node atom/connect/computer/main.mjs --port 8788
```

浏览器打开终端显示的 `http://127.0.0.1:8788/`：

1. 输入已部署的 ATOM relay HTTPS 根地址和电脑名称。
2. 添加允许 Agent 操作的项目绝对路径。默认只读；勾选后允许项目内修改。服务器仅收到项目不透明 ID 和显示名称，不收到路径。
3. 在 ATOM「我的电脑」生成配对码，在电脑端填写，并在 ATOM 明确确认。
4. 在 ATOM 选择电脑、项目和 Codex，明确提交任务。

默认数据保存在 `~/.atom-connect/state.json`，目录权限 0700，文件 0600。可用 `--state-dir /absolute/private/directory` 指定目录。**不要把此目录放进 Git、共享文件夹或网站目录。只启动一个使用同一数据目录的实例。**

CLI 不在 PATH 时：

```sh
ATOM_CODEX_BINARY=/absolute/path/to/codex node atom/connect/computer/main.mjs
```

本地开发可以使用 `http://127.0.0.1:8787`。公网必须使用 HTTPS。拒绝在地址中嵌入用户名、密码、查询参数或子路径。默认服务为 `https://ldcx.tech/atom`，也可使用自托管 HTTPS 服务。

## 能力与边界

- 独立本地控制台、服务器注册、项目授权、双端确认配对、Agent 可用/登录检测。
- Codex initialize → thread/start 或 thread/resume → turn/start；流式文本、命令/文件审批、turn/interrupt、协议确认终态。
- 只允许继续本连接程序记录的、属于相同设备及项目的会话。
- 持久化事件 outbox、幂等命令账本。网络恢复后重发相同 event_id；重启后未完成任务标记 interrupted，不自动重跑。
- 同时运行一个任务。并发收到的其他任务明确失败，可稍后重新提交。
- Claude Agent 提供可选官方 SDK 适配：在本目录运行 `npm install --no-save @anthropic-ai/claude-agent-sdk`，通过启动环境配置 `ANTHROPIC_API_KEY`。支持 query/resume、文本流、工具审批和取消；不使用 Claude 订阅登录。缺少 SDK 或 key 时明确不可用；key 配置只代表存在，不代表额度与权限已验证。当前没有可用 Claude 凭据，因此没有进行真实 Claude 付费推理。
- Claude 工具限制为显式列表，默认只读项目仅 Read/Glob/Grep；所有工具通过 PreToolUse 要求用户审批，文件工具校验项目路径。Bash 与任意命令工具当前禁用，待增加真实操作系统文件系统隔离再开放。Glob/Grep 拒绝绝对/穿越模式和含符号链接的项目搜索。
- 仅二选一命令/文件审批；其他复杂交互请求明确拒绝，不自动授权。
- 中继保存任务和事件，当前任务正文使用配对密钥端到端加密，服务器只持有路由和状态元数据。默认不记录 prompt、凭据、Codex stderr 或命令输出；加密后的模型文字经中继转发给配对设备。
- 项目授权限定启动工作目录和可写目录；Codex 的只读能力并不等于操作系统级单目录保密隔离。谨慎授权项目，并在需要时使用独立系统账号/容器。

## 本地 API

控制台只监听 127.0.0.1。首先 GET `/` 获得 HttpOnly、SameSite=Strict Cookie，再 GET `/api/state` 获得本地 csrf。所有 POST 必须带准确 Origin、Cookie、X-Atom-CSRF 和 JSON Content-Type。无 CORS。

| 接口 | 请求 |
|---|---|
| GET /api/state | 公开当前本地配置、项目、Agent 和任务摘要；不返回中继 token |
| POST /api/configure | `{relay_url,name}` |
| POST /api/projects | `{path,name,read_only:true}` |
| POST /api/projects/remove | `{id}` |
| POST /api/pair | `{code}` |
| POST /api/diagnostics | `{}` |

## 验证

```sh
node --test atom/connect/computer/test/*.test.mjs
```

测试中的进程替身只存在 test 目录，覆盖握手、审批、终态、幂等、重启中断、路径映射、凭据不外露和跨站写入拦截。实际 Codex 协议握手和本机账号检测已验证；模型调用是否成功依赖本机账号及网络，不应把测试替身结果当成真实推理。

协议依据：[OpenAI 官方 App Server 文档](https://learn.chatgpt.com/docs/app-server)。

Claude 依据：[官方 SDK 概览](https://code.claude.com/docs/en/agent-sdk/overview)、[审批回调](https://code.claude.com/docs/en/agent-sdk/user-input)、[流式事件](https://code.claude.com/docs/en/agent-sdk/streaming-output)。

真实 Codex 验证：在隔离空目录以 readOnly 策略运行，返回 `ATOM_CONNECT_OK`、turn/completed=completed、目录无文件写入。

## 电脑界面

控制台使用左侧导航，分为概览、我的设备、授权项目、电脑 Agent 和连接设置。概览显示实际设备/Agent 状态与最近任务；连接步骤可直接跳转相应页面。轮询不会覆盖正在输入的表单。Mac 外壳支持在授权项目页面通过原生文件夹选择器填写路径，仍需明确点击添加项目。

## 生成并交付 ATOM 应用

设备提交 `kind:"app"` 时，电脑端会把需求包装为 ATOM bundle 生成协议，无需写入电脑项目，只读项目也支持。Agent 最终必须返回完整 JSON（不接受 Markdown 代码围栏）：

```json
{"manifest":{"id":"my-tool","name":"我的工具","description":"功能说明","icon":"icon.svg","entry":"index.html"},"files":{"index.html":"完整页面","icon.svg":"64×64 currentColor 静态图标"}}
```

电脑端先验证路径、文件类型、图标安全和 96 KiB UTF-8 包大小，再在 result 事件中发送完整 `artifact`；不会按普通任务的文字长度截断应用包。无效包会标记 failed。设备仍执行更严格的独立校验与预览安装，生成完成不等于自动安装。任务种类默认为普通 `task`，原任务取消、审批、恢复规则保持一致。

## Studio：市场、创作、便签与今日

电脑端现在还包含「应用市场」「我的创作」「便签」「今日」。这些内容共用独立的创作账号；模型账号仍在电脑端，市场密码不会发送给模型。需要先部署同仓库的 marketplace 服务，现有默认云端服务已经提供账号与市场。

完整创作流程：市场查看作品与许可证 → 查看各版本全部源码和上游来源 → 基于指定版本派生 → 在「我的创作」打开完整资源 → 编辑 / 本机预览 / AI 改造 → 比较快照 → 同步草稿 → 明确确认公开源码后发布。派生应用使用服务端分配的新应用 ID，不覆盖官方应用。上游作者、许可证、版本由服务端维护。

- 完整源码落盘：`<state-dir>/workspaces/<origin+user 哈希>/<draft-id>/source/`，含 manifest.json 和所有资源，拒绝路径穿越与符号链接。
- 全量快照：相邻 `snapshots/` 目录，每个快照保存完整 bundle，最多保留 80 个；恢复先备份当前内容，不直接改变服务器。
- 差异：包含所有新增、删除、修改文件的完整 before/after，并不是只比较入口 HTML。
- 本机预览：480×360，sandbox opaque origin，禁网络、父页面与设备权限；相对 CSS/JS/图片资源内联；AtomApp 保存仅为当前预览暂存。复杂动态 import / fetch 资源可能需要应用适配，不能以本机预览替代真机验收。
- 本机编辑与服务器同步分开：`dirty:true` 表示有未同步修改。`local_digest` 是当前 bundle 的本机 SHA-256；`synced_digest` 是最近确认发送/接收的 bundle 哈希，不等同于平台不可变版本的规范化 hash。旧同步响应不会把等待期间的新编辑标成已同步。
- 409 冲突：本机内容、完整快照和 AI 产物都保留，可查看服务器完整源码，再明确选择服务器或本机版本；不会自动覆盖。
- 发布需 `confirm:true`，只允许已同步的草稿。服务器再次扫描和检查许可。发布后刷新草稿 revision；源码公开与源代码中任何私人信息需用户确认。
- 便签 / 今日离线编辑写入私有 `studio.json` durable 队列；运行中每 15 秒尝试恢复同步。冲突保留两份，选择服务器或把本机内容另存副本。软删除支持恢复。账号/服务器隔离缓存与队列。

### Studio AI 改造的安全边界

它不是普通项目 Agent 会话。每次创建独立空目录和临时私有 CODEX_HOME，只复制 Codex 登录文件，不继承用户 MCP、插件、技能或广泛配置。完整源代码作为输入种子；不把市场账号和令牌发给模型。

本机 CLI 的部分模型元数据会强制提供工具，即使关闭工具 feature。因此纯文本边界由专用 loopback 代理强制执行：发送到固定官方 Responses 地址前删除顶层和 input.additional_tools 中全部工具，设置 `tools:[]`、`tool_choice:"none"`；拒绝工具历史和工具调用响应。代理只转发到 `https://chatgpt.com/backend-api/codex/responses`（ChatGPT 登录）或 `https://api.openai.com/v1/responses`（API 登录），不接受任意 upstream URL，不记录认证头。随机 capability 路径和配置仅存在临时私有目录；退出删除登录副本。普通电脑任务不经过此代理，继续使用其授权工具。

本机已安装 CLI → 专用代理 → 注入假上游的真实请求抓取验证了 `tools:[]`、`tool_choice:none`、无 embedded tools；这是协议边界验证，不等于真实模型生成验收。实际模型结果需真正 completed，完整 bundle 验证通过才同步；失败、取消或重启不会自动重新执行。最终真机生成结果以集成验收记录为准。

### 可脚本调用的 Studio API

下表前缀均为 `/api/studio`，使用相同本地 Cookie、Origin 和 CSRF。POST JSON 上限 2 MiB；应用 bundle 仍限制 96 KiB。所有令牌保存在私有文件，任何 state API 均不返回。

| 方法与路径 | 请求 / 返回 |
|---|---|
| GET /state | configured, authenticated, user, pending_notes, jobs 摘要 |
| POST /register 或 /login | `{username,password}` → `{user,authenticated}`；密码至少 8 位 |
| POST /logout | `{}` |
| GET /catalog?q=&category= | `{works}`，分类 life/companion/sound/play/connect |
| GET /works/:id | 作品、版本列表与衍生作品 |
| GET /versions/:id | 完整 bundle、不可变版本 hash、许可与来源 |
| POST /forks | `{version_id,title?}` → 已 checkout 的 `{draft,bundle,snapshots}` |
| GET /drafts | 仅当前账号草稿 |
| GET /drafts/:id | 获取或保留 dirty 本机版本；离线已有缓存可读 |
| GET /workspaces/:id | draft,bundle,snapshots,source_path,dirty,local_digest,synced_digest |
| POST /workspaces/:id/save | `{bundle}`，保存本机全量源码与快照 |
| POST /drafts/:id/save | `{revision,bundle?,title?,description?}`，同步本机草稿 |
| POST /workspaces/:id/snapshot | `{label}` |
| GET /workspaces/:id/diff?snapshot_id= | 全部变化文件的 before/after |
| POST /workspaces/:id/restore | `{snapshot_id}`，只恢复本机 |
| GET /workspaces/:id/server | 服务器当前完整草稿，不覆盖本机 |
| POST /workspaces/:id/resolve | `{decision:"server"}` 或 `{decision:"local",confirm:true}` |
| GET /previews/:id | sandbox 预览 HTML，需本地 Cookie |
| POST /ai-modify | `{draft_id,prompt}` → `{job}`，不经设备 relay task |
| GET /ai-jobs/:id | 实际 queued/running/saving/completed/failed/cancelled/interrupted/conflict、text、error、artifact、boundary |
| POST /ai-jobs/:id/cancel | `{}`；保存阶段不允许取消已确认的提交 |
| POST /ai-jobs/:id/apply | `{}`；用户明确选择后将保留产物应用到最新草稿 revision |
| POST /drafts/:id/publish | `{revision,changelog,confirm:true}` |
| GET /notes | `{notes,pending,offline}` |
| POST /notes | `{id?,revision?,text,pinned?,deleted?}`，先落盘本机再尝试同步 |
| POST /notes/resolve | `{id,decision:"server"|"copy"}` |
| POST /notes/sync | `{}` |
| GET /agenda | `{items,pending,offline}` |
| POST /agenda | `{id?,revision?,title,kind:"event"|"todo",starts_at?,done?,deleted?}` |
| POST /agenda/resolve | `{id,decision:"server"|"copy"}` |
| POST /agenda/sync | `{}` |

本地 AI jobs 和快照不属于服务器公开版本，私有文件请勿上传 Git。进程重启后未完成 AI job 标记 interrupted；已保留 artifact 可由用户明确恢复。

安全文本通道补充验收：真实本机 Codex 经固定官方上游完成纯文本推理，精确返回 `ATOM_TEXT_OK`，请求工具列表为空。官方 SSE 响应在某些系统代理路径下可能没有 Content-Type 头，工作台允许缺失该头，并继续逐帧检查与禁止工具调用；相应回归测试已覆盖。完整应用改造、公开发布和设备安装以 ROOT 的集成验收为准。

### AI 整理便签

便签面板的「AI 整理」支持明确选择 1–24 条便签，使用同一个真实 Codex 纯文本安全边界。选中内容总量最多 64 KiB；结果严格解析为摘要、最多 12 条待办建议与最多 12 条日程建议，日期未知时留空。摘要最多 4000 字，标题最多 200 字，结果 JSON 最多 32 KiB。

完成时只展示建议，原便签不改变，也不自动创建日程。用户勾选候选并明确确认后，使用预先固定的候选 UUID 写入本机「今日」待同步队列；重复确认不会创建重复事项。离线时明确显示本机待同步，联网后后台同步。任务与应用改造一样持久化，重启未完成标记 interrupted，不自动重跑；结果和任务按账号 / 服务器隔离。

| 方法与路径（前缀 /api/studio） | 请求 / 返回 |
|---|---|
| POST /notes/organize | `{note_ids?:["note-id"]}` → `{job}`，省略选择当前账号未删除便签（仍有限额） |
| GET /notes/organize/:id | `{job:{kind:"notes-organize",status,result?:{summary,todos:[{title}],events:[{title,starts_at}]},applied,...}}` |
| POST /notes/organize/:id/cancel | `{}` |
| POST /notes/organize/:id/apply | `{confirm:true,todo_indices:[0],event_indices:[0]}` → `{ok,items,pending}`；不选择的候选不写入 |

电脑心跳只携带最近 Studio 活动的 `{id,type,status,updated_at}` 四项脱敏元数据，便于配对设备显示忙闲；不向配对设备发布便签正文、源代码、提示词、标题、账号或路径。保存阶段映射为 running，冲突映射为 failed。普通电脑任务仍使用原有任务流。

此功能已通过确定性测试替身的端到端 UI 与幂等 / 离线 / 账号隔离测试；真实模型能力沿用已验证的安全 Codex 通道，具体整理内容需在真实账号上验收。

AI 整理补充真实验收：最终重建的 Mac App 经真实 Codex 完成整理，得到 2 条待办和 1 条日程建议；原便签正文与 revision 均未改变。明确选中 1 条待办和 1 条日程后重复 apply，两次返回相同 ID，服务器同步后各只有一条记录。脱敏证据见 `verification/notes-organize-native.json`。生产后端 UI 也已通过独立浏览器渲染检查，无脚本错误；macOS 原生窗口屏幕抓取因未授予系统屏幕权限未执行。

## 同账号发现与模拟设备镜像

两端登录同一 ATOM 账号后，Mac 的「设备与连接」会列出在线小电脑；仍需在设备明确确认并核对安全码。原配对码方式保留。模拟设备的单向数据镜像需要设备端先授权，再由 Mac 明确同步，详见[系统维护说明](../../docs/system-maintenance.md)。
