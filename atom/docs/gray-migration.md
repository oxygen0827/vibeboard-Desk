# 灰色板迁移记录 · 2026-10-22

本次迁移对象是 `taishan-gray`，不是透明板。它使用 RK3566、约 2 GiB 内存、480×360 DSI、Debian 10 / Linux 4.19.232 / Chromium 91。应用系统安装在 `/home/linaro/atom`；保留 Debian、板厂驱动、联网、FRP、音频与风扇硬件控制。

## 四个 GrayOS 应用

[光子芯片](../official/photon-chip)、[光子快跑](../official/photon-runner)、[指尖烟花](../official/finger-fireworks)、[迷你钢琴](../official/mini-piano) 已转为完整 ATOM 源码包。共用代码、构建和测试在 [gray-ports](../official/gray-ports)。

- 白天 / 暗黑控件、每应用独立的 currentColor 图标、全屏固定画布。
- 空格 / Home 交给系统；退出回到原桌面页；数字键 / Enter 供应用内部使用。
- 移除旧服务器轮询、蜂鸣和灯光接口。声音由本机 WebAudio 合成。
- 快跑最高纪录使用 AtomApp 读写，读取失败不覆盖旧数据，保存失败可重试。
- 页面隐藏时暂停；退出释放动画、计时器和音频；减少动态效果时关闭自动光流 / 烟花。
- 光子芯片只做交互示意，原来的模拟“算力”数字已移除，不作为光学计算或性能测量。

云端源码市场现有 **14 个官方作品**，加上已有社区作品共 **16 个公开作品**。这四款都有真实界面截图封面、完整源码和 MIT 许可；官网静态目录由 35 项增至 **39 项**，并合并云端社区作品。电脑端、设备端读取同一市场。14 个官方应用的设备安装目录补充不可变版本的 `ATOM-SOURCE.json`，支持日后识别来源并更新。

## 新系统安装树

`python3 atom/deploy/build-device-image.py /绝对路径/新目录` 可生成不含设备身份、账号或模型密钥的新安装树（构建机 Python 3.8+）。目标目录必须不存在。它包含当前官方应用、四个系统客户端、用户此前选择且仓库中有完整资源的 15 个移植应用、麦克风测试，以及这次的四个新应用，共 **34 个可安装应用**。系统自带时钟、设置等入口另计。四个新应用追加在末尾。

两款只存在于透明样机的旧定制应用（粒子实验室、随身唱片）没有独立源码包，不凭空复制空壳。大型移植会复制整个资源目录，包括 JS、WASM、纹理及许可；不会只复制入口 JSON。

`deploy/start-atom.sh` 现在允许根用户通过 `/etc/default/atom-kiosk` 选择 `ATOM_GRAPHICS=egl` 或 `software`。默认仍为原来的 EGL。`ATOM_DEBUG=1` 仅供诊断，调试接口只监听本机；本次交付已设为 0，并重启浏览器关闭接口。不要将状态目录或浏览器 profile 从透明板复制到灰色板。

## 连接验证

灰色板以独立身份“灰色 ATOM”注册到 `https://ldcx.tech/atom`，通过正常的配对码和设备确认流程连接“开发用 Mac”。透明板原来的配对保留。两端确认任务加密为开启状态。

已从灰色板创建一个真实 Codex 任务，经过云端中继交给 Mac，在设备端收到完成状态与回复“灰色 ATOM 与 Mac 的任务链路已打通。”公开验证记录不包含令牌和项目路径，见 [mac-link-verification.json](../artifacts/gray-migration/mac-link-verification.json)。应用市场的账号登录独立于电脑配对；私人相册、便签等同步需要在设备上登录同一市场账号。

## 验证与显示边界

浏览器集成测试通过：真实 ATOM 后端、opaque iframe、白天 / 暗黑、无整页溢出、光路交互、纪录保存与读取失败重试、文字烟花、黑白琴键和本机音频、退出资源释放。钢琴真实演奏时，硬件输出的 PulseAudio monitor 录得有效信号（峰值 3495、RMS 500.28）；这验证数字输出链路，没有冒充远程试听扬声器。市场后端 26 项测试通过，官网目录在 1440 / 768 / 390 / 320 宽度通过筛选、搜索、分页、下载与离线回退检查。

四个应用已在灰色板实体会话启动和操作，空格返回原桌面页。早期旧排序为第 7 / 8 页；完成最新桌面升级后统一追加在第 6 页。软件显示配置下短时 requestAnimationFrame 回调约 59–61 次/秒；这是短时动画调度测量，不是 GPU 压测或长期稳定性结论。见 [canvas-verification.json](../artifacts/gray-migration/canvas-verification.json)。

原系统禁用了 WebGL。测试 modesetting / EGL 后，浏览器正确识别 ARM Mali-G52，Canvas、合成、WebGL 1/2 开启，DRM DSI 输出层为 ACTIVE。见 [gpu-verification.json](../artifacts/gray-migration/gpu-verification.json)。`video_decode=enabled` 只是浏览器能力状态，本次没有据此宣称完成硬解实播测试。

设备重新开机后，ATOM、LightDM、FRP 和风扇服务正常；Xorg 确认为 Mali-G52 的 glamor 加速，实体 DSI 输出层为 ACTIVE，480×360 X11 输出截图正常。又在实体会话验证了光影水池、天体观测台、我的电脑、市场、相册、天气、节拍和这四个新应用，共 11 个应用的启动、全屏与原页返回，见 [最终检查](../artifacts/gray-migration/final-verification.json)。

旧 GrayOS、数字生命、旧状态屏/聊天服务、对应源码/历史发布目录及旧开机入口已清理。原风扇 GPIO3 A4 与温控阈值核对一致后，升级为 ATOM 风扇服务；暂停与恢复均通过真机 socket 验证。保留麦克风既有硬件路由，没有套用透明板的单端 PMIC 实验。设备新增独立 SSH 密钥、加密连接依赖及中文黑体字体，私钥留在 Mac。

**已知限制：验证期间，旧 BSP 的 Xorg 曾在重启图形会话时进入不可中断等待，完整重启后恢复；没有证明根因已消除。** 本次日常代码更新使用后端或浏览器重载，避免反复热重启 LightDM。GPU 下短时动画回调约 46–63 次/秒，见 [EGL 检查](../artifacts/gray-migration/canvas-egl-verification.json)；尚无长时间压力测试。模型生成、ASR / TTS 的密钥没有从其他设备复制，新设备需在设置中配置；电脑 Codex 任务链路已独立验证通过。

## 私有备份与回退

Mac 的 `~/Library/Application Support/ATOM/Backups/taishan-gray-20261022-000556/` 保存三份已校验归档：旧应用/配置、补充配置与浏览器状态、旧服务停止后的最终数据。目录 0700，归档 0600，SHA-256 和条目数量在同目录的 `backup-manifest.json`。这些文件可能包含账号信息，不能进入仓库或市场。

显示试验前的可用 fbdev 配置还保存在板子 `/root/atom-gray-xorg-fbdev.conf`，软件启动配置在 `/root/atom-gray-kiosk-software.conf`。恢复时先复制回对应系统路径，再安排重启；显示驱动已经卡住时不要无限重启 LightDM。SSH 可用后，先检查 `systemctl is-active atom lightdm frpc taishan-fan`、8770 健康接口、Xorg 日志与真实 DRM 输出层。

最终桌面四个新应用统一排列在第 6 / 6 页，逐个验证退出仍返回第 6 页，见 [桌面图标](../artifacts/gray-migration/new-icons.png)。最新通用桌面与同账号发现功能使用仓库 `34a54bd` 基线，设备配对身份和应用数据独立保存。
