# ATOM Connect · 小电脑连接个人电脑上的 Agent

ATOM 仍可独立使用。需要操作电脑项目时，打开设备上的「我的电脑」，把需求交给个人电脑上的 Codex，查看实际文本进度、批准或拒绝操作，并获取结果。长按空格可录入需求，松手转写；**转写后仍需明确点击发送任务**。

电脑不需要开放入站端口，也不需要公开 Codex app-server。三个部分通过有身份认证、持久化的 HTTP 轮询协作：

```text
ATOM「我的电脑」→ 设备私有 Python bridge → 中继 SQLite ← 电脑 ATOM Connect → Codex stdio app-server
                                       HTTPS / HTTP 轮询
```

这套程序创建和管理自己的 Agent 会话，不接管用户已经打开的 Codex 桌面聊天窗口。电脑必须开机、联网，并保持 ATOM Connect 运行，才能执行电脑上的任务。电脑关机时，设备其他独立应用仍可使用。

## 当前交付与验证边界

- 已实现：自托管中继、令牌注册、短时配对码和设备确认、项目选择、真实 Codex stdio 协议适配、任务状态/文本、审批、取消、断线重发和重启中断标记。
- 已提供：macOS 菜单栏原生外壳，内嵌 Node 连接程序和本地 WebKit 控制台；也可以直接运行跨平台 Node 源码。
- 真实 Codex 已执行隔离只读测试，返回 `ATOM_CONNECT_OK` 和协议 completed；并非测试替身推理结果。真机已通过开发隧道完成「设备发起 → 中继 → Mac Codex → 设备显示 `ATOM_RELAY_DEVICE_OK`」；参见[验收记录](verification/README.md)。这不等于正式公网部署已完成。
- Claude 是可选官方 Agent SDK/API Key 适配，缺 SDK 或 Key 时明确不可用；目前没有真实 Claude 凭据，因此未验证付费推理。
- 源码市场已有自托管账号系统。当前没有托管公网服务器、端到端加密或 Windows 原生安装包。HTTP 轮询不是 WebSocket。

## 第一次使用：先部署中继

需要一台双方能访问的中继主机。开发时可以先在个人电脑启动；生产时应放到受保护的服务器并配置 HTTPS。

```sh
python3 atom/connect/relay/server.py --host 127.0.0.1 --port 8787 --db ~/.local/share/atom-connect/relay.sqlite3
```

Python 3.7+，仅标准库。服务器默认仅监听回环地址。程序没有网页登录页；`GET /` 返回 JSON 404 不代表启动失败。完整接口和容量限制见 [relay/README.md](relay/README.md)。

生产方式建议：

1. 使用独立非特权系统用户和私有数据目录运行中继，数据库权限 0600。
2. 用 systemd、launchd 或容器进程管理器守护服务，配置重启策略和磁盘配额；中继只监听内部回环地址。
3. 反向代理提供有效 HTTPS 证书，将完整 `/v1/` 路径转发至 `127.0.0.1:8787`，设置请求体、连接和访问速率限制。
4. 备份 SQLite 时使用 SQLite backup API，或停服务后备份数据库及 WAL；不要只复制正在写入的主文件。
5. 轮询和出站 HTTPS 在代理上正常放行；不把电脑控制台端口 8788 暴露到公网。

这只是部署建议，仓库没有替用户开通域名、证书、云主机或生产账号。公网注册仍是开放 enrollment 原型，正式多租户服务还需邀请/账户配额、撤销与恢复策略及运营监控。

## 电脑端：推荐 macOS App，也可运行源码

### macOS 原生外壳

需要 macOS 13+、Apple 命令行开发工具和 Node.js 22+。构建机与目标机架构需匹配；脚本把指定 Node 可执行文件复制进 App，不下载运行时，也不捆绑凭据。

```sh
python3 atom/connect/desktop/build-macos.py --node "$(command -v node)"
open "atom/connect/dist/ATOM Connect.app"
```

构建输出为 `atom/connect/dist/ATOM Connect.app`。该开发包使用本机 ad-hoc 签名，没有 Developer ID 公证，不应当作正式可公开分发安装包。菜单栏的 ATOM 菜单可打开窗口、选择项目文件夹或退出；关闭窗口后连接程序继续运行，退出 App 才停止。当前没有自动安装开机启动项。

App 配置保存在 `~/Library/Application Support/ATOMConnect/state.json`。不要同时启动多个使用此目录的实例。

### ATOM 模拟器（模拟设备）

侧栏「模拟设备」（或菜单栏「打开 ATOM 模拟器」）在这台 Mac 上运行小电脑：App 内置真实的设备后端（`atom/*.py`、`static/`）和构建时预装的全部仓库应用，由 macOS 自带的 `/usr/bin/python3` 运行，480×360 屏幕直接嵌在主窗口里。点「停止」才会关闭；退出 App 时若模拟设备在运行，下次打开会自动恢复。

「概览」按上线顺序显示三条链路，每 2 秒刷新：

1. **测试 · 本机直连**：这台 Mac ⇄ 模拟设备（`127.0.0.1:8790`），不经过服务器，显示实测延迟和应用数。
2. **测试 · 经中继**：这台 Mac ⇄ 中继 ⇄ 模拟设备，与真机相同的注册、配对、端到端加密和任务链路。「一键配对」自动完成配对码 → Mac 认领 → 设备确认，双方互相看到在线才算通过。
3. **正式 · 真机**：这台 Mac ⇄ 中继 ⇄ ATOM 小电脑（不含模拟设备）。

下方「上线步骤」逐项检查：启动模拟设备、本机直连、Mac 连上中继、模拟设备连上同一中继、经中继配对、从模拟设备发起一次电脑任务、真机配对并在线、从真机发起一次电脑任务。前六步通过即说明链路和 Mac 端没有问题，再换真机。

- 数据在 `~/Library/Application Support/ATOMConnect/simulator/`，与 App 配置、真机互不影响；固定端口 `127.0.0.1:8790`，应用存档按来源保存，不能换端口。
- 首次启动以「Mac 模拟器」身份注册到 ATOM Connect 当前使用的中继，之后复用该身份。登录市场账号后，随手记、今日、市场、电脑任务和真机一样可用；AI 创作类应用需在模拟器的工作坊填写模型 API。
- 依赖 Linux 硬件的功能不可用：录音/语音（`parec`/`pactl`）、音量、背光、温度。画面由 macOS WebKit 渲染，性能与兼容性以 RK3566 上的 Chromium 91 为准。
- 未安装命令行工具时窗口会提示运行 `xcode-select --install`。
- 开发时也可直接运行 `python3 atom/tools/simulator.py`（从仓库同步应用、用 Chrome 打开窗口）。

### 源码方式

需要 Node.js 22+；主程序没有 npm 必装依赖。

```sh
node atom/connect/computer/main.mjs --port 8788
```

打开终端显示的本机地址，默认 `http://127.0.0.1:8788/`。源码方式默认配置在 `~/.atom-connect/state.json`，与 macOS App 的目录不同。如需共享配置，退出另一个实例后使用 `--state-dir` 指向同一个目录。

电脑必须安装并登录官方 Codex CLI。控制台显示检测结果；若 CLI 不在 PATH，可以用 `ATOM_CODEX_BINARY=/absolute/path/to/codex` 指定可执行文件。连接程序使用电脑现有 Codex 账户，不把模型账号密钥上传到设备或中继。更多配置见 [computer/README.md](computer/README.md)。

## 配对、授权与执行

1. 在电脑控制台填写中继 HTTPS 根地址和电脑名称，保存连接。
2. 添加明确允许处理的项目文件夹。Mac 可从菜单选择文件夹，再确认添加；默认只读，启用修改需主动选择。中继只得到项目 ID/名称，不得到本地路径。
3. 设备安装本版本后打开桌面「我的电脑」→「连接设置」，填写同一个中继服务的地址与设备名称，保存。
4. 在设备生成配对码，五分钟内在电脑控制台输入，再回设备确认显示的电脑名称。只输入配对码不会立即获得授权；新配对码会使旧请求失效。
5. 选择在线电脑、授权项目和已登录 Agent，输入或按住空格口述任务，确认后发送。
6. 任务页显示真实运行状态和返回文本。审批需手动允许/拒绝；取消按钮只是发送请求，收到电脑终态后才代表停止。
7. 已有会话可继续，但只能续接本程序记录、属于同一设备和项目的会话。离开应用不会自动取消电脑任务。

若设备尚未安装「我的电脑」，先部署本版本 ATOM 服务及静态代码，再通过本机服务或 SSH 管理隧道安装：

```sh
ssh -N -L 18770:127.0.0.1:8770 DEVICE_USER@DEVICE_HOST
```

另开终端运行：

```sh
python3 atom/tools/deploy_app.py --target http://127.0.0.1:18770 install atom/examples/my-computer.json
```

`my-computer.json` 已包含应用界面和语义 SVG 图标。只安装这个应用包不能替代后端 `relay_bridge.py`、server 路由和系统桥接代码的升级。

## 无云主机的开发联调：SSH 反向隧道

可以让设备通过 SSH 私有隧道访问电脑的本地中继，无须公开 HTTP 端口。在电脑启动 8787 中继，再执行：

```sh
ssh -N -o ExitOnForwardFailure=yes -R 18787:127.0.0.1:8787 DEVICE_USER@DEVICE_HOST
```

- 电脑控制台中继地址：`http://127.0.0.1:8787`。
- 设备「我的电脑」中继地址：`http://127.0.0.1:18787`。
- 两个地址通过隧道到达同一个中继，仍需要注册、配对和确认。

SSH 服务器需允许远程端口转发，远程端口保持回环绑定，不启用公网 GatewayPorts。退出隧道进程后设备连接会断开。这是开发方式，**不等于已部署正式云端服务**。普通局域网明文 HTTP 地址会被客户端拒绝；跨机器正常部署应使用 HTTPS。

## 数据、权限和故障恢复

| 数据 | 保存位置与说明 |
| --- | --- |
| 设备身份令牌 | 设备 ATOM `state/connect.json`，0600；不传给应用 iframe |
| 电脑身份、项目映射、任务/事件账本 | App 的 Application Support 或 CLI `~/.atom-connect/state.json`，0600 |
| 配对、任务、事件、未确认命令 | 中继 SQLite；令牌与配对码只存哈希；任务内容仍为服务端可读明文 |
| 模型凭据 | 电脑本机 Codex 账户或 Claude 启动环境；不配置在中继 |

- 中继重启后恢复任务和事件，不自动宣称成功或失败；电脑连接程序重启时把未完成执行标为 interrupted，不悄悄重跑。
- 心跳过期约 45 秒电脑显示离线。检查电脑进程、网络、TLS 和中继后再重试，避免重复提交同一实际工作。
- 设备重新注册会更换身份，需重新配对；旧任务不能以新身份读取。切换服务器前先结束任务，按电脑端当前提示处理待发送事件，保留旧私有配置备份。
- 项目授权约束工作目录和可写范围；Codex read-only 不等于操作系统级单目录读隔离。敏感项目建议使用专用系统账号或容器。
- Claude 当前禁用 Bash，文件工具需要审批与路径校验。Key 存在不代表 API 额度有效。
- 不把配置文件、数据库、日志或调试导出提交到 Git。中继磁盘容量有限，需由运营人员制定保留与归档策略。

## 开发与测试

```sh
python3 -m unittest discover -s atom/connect/relay -p 'test_*.py' -v
node --test atom/connect/computer/test/*.test.mjs
python3 -m unittest discover -s atom/tests -v
```

参考 [共享协议](PROTOCOL.md)、[中继部署](relay/README.md)、[电脑端操作](computer/README.md) 和[总体连接方案](../docs/computer-agent-bridge-plan.md)。测试中的假进程仅用于协议与故障验证，不能代替真实模型推理、真实设备或生产网络验收。

## 本机开发服务恢复记录（2026-10-20）

临时 SSH ControlPersist 到期会撤销反向端口，表现为设备访问 127.0.0.1:19441 被拒绝，即使 Mac 中继仍在运行。测试机器现改为用户级 launchd 守护开发中继和 SSH 隧道：`local.atom.connect.relay-test` 与 `local.atom.connect.tunnel-test`，登录后启动、异常退出重启，SSH 启用心跳与转发失败退出。主动中断隧道后已验证自动恢复。它们是这台 Mac 的本地测试配置，不是产品自带云服务。

中继数据库迁至 `~/Library/Application Support/ATOMConnect/relay.sqlite3`，电脑伴侣统一使用同目录的 `state.json`，不再同时运行临时 CLI 伴侣。原生 App 已继承原测试配对与项目，旧的空配置备份在 `state.before-test-migration.json`。这些私有数据和日志不进入仓库。测试服务日志在该目录的 `logs/`，LaunchAgent 配置位于 `~/Library/LaunchAgents/`。

Mac 需保持开机、联网，ATOM Connect App 需保持运行；电脑休眠期间不能执行任务。开发服务关闭可用 `launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/local.atom.connect.tunnel-test.plist`，中继相同方式指定 relay-test 文件。正式迁云后应停用这两个开发服务，并通过新中继重新配对。

## 从 ATOM 创建并安装应用

在设备「我的电脑」中选择「创建应用」，选好已配对电脑、授权项目和可用 Agent，输入需求（或长按空格录入后确认发送）。电脑 Agent 生成自包含的 ATOM 应用包；这条路径不要求修改项目文件，默认只读项目也可使用。当前交付支持最多 96 KiB UTF-8 的文本资源应用包，不用于完整大型 GitHub 资源移植。

模型完成后，电脑伴侣检查清单、资源路径、包大小和主题图标。失败会明确标记失败；有效包通过拥有者限定的中继接口交付。设备端再使用实际安装器和 SVG 验证器检查，然后可点击「全屏预览」。预览的存储是临时的；空格返回原桌面页，再进入「我的电脑」继续操作。

点击「安装到桌面」后，需要再次确认。安装要求设备开发模式已开启；关闭时会明确提示，不会自动启用。安装只取服务器保存的该任务产物，不接受界面伪造文件包；已有 ID 冲突会拒绝覆盖。安装成功后新应用出现在桌面末尾，具有自己的主题适配图标。安装后的 AtomApp 持久化与预览数据隔离。

安全更新「我的电脑」客户端请先人工审查源代码，再使用 `atom/tools/deploy_app.py update atom/examples/my-computer.json`；该工具会调用专用本机 `client-update` 接口。普通应用导入和工作坊不能覆盖这个带连接权限的入口。
