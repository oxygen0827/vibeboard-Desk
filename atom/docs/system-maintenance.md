# 系统维护、数据备份与模拟设备镜像

2026-10-22。此文描述灰色板维护通道和 ATOM Connect 0.6.2 内部测试版。系统核心版本由 `atom/VERSION` 标识；已安装应用通过应用市场单独升级。

## 在设备上使用

- **设置 → 系统更新**：检查版本、下载并校验、明确点击安装。显示真实下载、安装和恢复结果。安装只重启 ATOM 后端，不重启 LightDM/Xorg。
- **设置 → 数据与恢复**：创建最多 10 份手动备份，另保留最近 7 天有变化的自动快照；查看、导出、导入、恢复或删除。恢复前需要确认。恢复时会暂时阻止旧页面写回记录。
- **恢复初始设置**：输入完整文字「重置这台设备」。清除设备上的账号、配对、模型配置、桌面偏好、应用记录和本机备份；保留已安装应用、Wi-Fi 配置和云端账号内容。它不是磁盘刷机或删除云端账号。
- **同步到电脑模拟设备**：默认关闭，明确授权后才启用。随后在 Mac「设置 → 开发者工具」打开模拟设备，选择已配对真机，点击同步或开启持续跟随。同步覆盖模拟设备的对应本地记录，不向真机回写。

本机备份只保存桌面布局、外观、计时等经过审核的系统记录，以及 AtomApp v1 应用 JSON 存档；单个应用最多 64 KiB，整份记录最多 1500 KiB。它不包含应用安装包、账号令牌、模型配置、云端便签/日程和照片。导出的 JSON 可能包含应用里的个人内容，请自行妥善保存。应用保存等待设备确认落盘后才返回成功；写入失败会保留原记录并允许重试。浏览器存储为空时先恢复设备副本，避免默认布局覆盖记录。当前副本损坏时校验前一版本；两份均不可用则报错，不以默认空数据覆盖。

镜像整份记录最多 **64 KiB**，超限时保留本机数据并提示改用备份。真机使用已有配对密钥进行端到端加密；云端只保存每个配对关系的最新密文与版本摘要。状态轮询带回版本，仅有变化时传输和导入。关闭镜像会清除云端密文；离线时显示重试入口。解除配对也会清除该关系的快照。镜像不安装应用，模拟设备需要已有对应应用才能显示记录。

## 系统升级的范围与恢复

发布包只包含根目录 Python 模块、`VERSION`、`static/`、`templates/` 和 `deploy/`；不替换 `apps/` 或 `state/`，不改变桌面安装顺序，不升级 Debian、内核或板厂驱动。

设备验证 Ed25519 签名、SHA-256、包大小、文件数量和解包路径。安装时重新校验原始签名包，不信任已解压暂存文件。修改第一个系统文件前保存旧核心和持久化恢复日志；新服务未在限时内报告目标版本便自动恢复。断电或安装中断后的下次启动先恢复，再启动桌面服务。网络下载失败不会改动当前系统。

稳定安装器位于 `/home/linaro/.local/lib/atom/system_update.py`，在本轮核心替换范围之外。systemd 的 `atom-update.path` 触发安装，`atom-update-recover.service` 在启动时恢复。运行用户是 `linaro`。稳定安装器及 systemd 单元的变更需要管理员单独审核安装，普通系统发布不会自动执行新 shell 脚本。

首次给旧设备接入维护通道：先私有备份核心、状态和系统服务配置，复制经审核的核心后执行：

```sh
sudo sh /home/linaro/atom/deploy/install-maintenance.sh
sudo systemctl restart atom
systemctl status atom atom-update.path atom-update-recover.service
```

脚本同时安装经过审核的 `atom-system.pkla`，仅授权 linaro 重启、关机、修改时区和自动校时；蓝牙组存在时加入服务用户。已有维护通道的设备也需由管理员执行一次新脚本，普通 OTA 不会自动扩大权限。执行后重启 ATOM 后端使组权限生效。

脚本面向现有 `/home/linaro/atom` 样机，其他用户名或路径需调整单元。不要用重启显示管理器来刷新前端；后端更新成功后刷新 Chromium 页面即可。

## 构建与发布

需要 Python `cryptography`。提交审核后的核心后再构建，构建器拒绝未提交的核心改动，并要求 `deploy/atom-session.sh` 与 `deploy/start-atom.sh` 均为可执行文件（0755）；Git 必须保留执行位，避免更新后无法进入 ATOM 会话。私钥保存在维护者私有目录，**不得进入仓库**；仓库只包含设备信任的 `deploy/release-public.key`。

```sh
python3 atom/tools/build_release.py --notes "本版更新说明" --out /private/path/release
ATOM_SSH_KEY=/private/path/server-key sh atom/tools/publish_release.sh /private/path/release user@server
```

每次改包必须增加 `atom/VERSION`。发布脚本先验证上传包，再原子替换公开版本指针，拒绝用不同内容覆盖已有版本。云端接口：`GET /market/v1/system/latest` 和 `GET /market/v1/system/package/<version>`，设备仍独立验签。

检查故障可查看 `state/update/result.json`、`journal.json` 和 systemd 日志。若自动恢复仍失败，保留恢复副本与日志，联系维护者。更新日志不得包含账号令牌或模型密钥。

## Mac 内部测试与正式发行

构建可同时内置独立 Node 和可迁移 Python，模拟设备不再要求用户安装 Python 或 Xcode。构建机仍需 Apple 命令行工具；Codex 功能仍要求用户安装并登录 Codex CLI。

```sh
python3 atom/connect/desktop/build-macos.py \
  --node /path/to/standalone/node \
  --python-root /path/to/portable/python \
  --output "/private/path/ATOM Connect.app"
```

正式发行可附加 `--sign-identity "Developer ID Application: …" --notary-profile "keychain-profile"`。这会签署嵌套运行时、提交公证并装订结果；失败会停止构建。本轮机器没有有效 Developer ID 证书，只交付本机 ad-hoc 签名的内部测试版，**未完成 Apple 公证或公开分发验收**。Windows 包不在此轮交付范围内。

## 验证

自动化覆盖签名与篡改、路径拒绝、复制中断、服务启动失败回滚、断电日志恢复、暂存文件篡改、数据校验与恢复确认、镜像授权边界、跨账号/未配对访问拒绝、版本去重以及 HTTP 重置流程。浏览器以 480×360 验证备份、恢复、重置和页面高度。破坏性恢复测试使用隔离目录；不会清空用户真机数据。

真机及线上验收结果见 [本轮维护交付记录](maintenance-delivery-2026-10-22.md) 与 [后续 .8 实机收尾](continuation-2026-10-22.md)。

## 手机扫码登录

设备「开机引导 → 登录账号 → 用手机扫码登录」，或「设置 → 系统工具 → 开机引导」重开。
手机相机扫描后核对两端完整 8 位确认码，输入已有 ATOM 账号。没有账号可在手机页选择「创建账号」，设置密码后先保存恢复密钥，再确认创建并登录。密码包装和恢复密钥包装均在手机 WebCrypto 内生成，并与设备的加密格式兼容。
二维码有效 5 分钟；返回、跳过或重新生成会取消旧请求。手机提交遇到网络故障可重试完成登录。
设备只在账号已保存后确认领取，丢失轮询响应可以重复读取。手机使用密码在本地解开账户数据密钥，
用二维码片段中的随机密钥重新加密后交给设备。云端不获取这把转交密钥；未能解锁的账户仍可登录，
设备会提示去市场账号页输入密码解锁记录。

云端 `ATOM_WEB_ORIGINS` 默认只接受 `https://ldcx.tech`。自建服务需设置自己的 HTTPS Origin，
二维码页与 API 必须同源。登录请求保存在内存，服务重启后重新生成即可；过期且未领取的会话会被撤销。
已领取但确认响应丢失的会话会保留，避免设备刚保存就被意外注销。

## 灰色板蓝牙音频依赖

该样机的 PulseAudio/libpulse0 为 13.99.3-1，不能直接安装 buster 源中依赖 12.2 的蓝牙模块。此次从 Debian 官方 snapshot 取得同版本 arm64 包，只新增 `pulseaudio-module-bluetooth`，模拟安装确认没有降级或移除依赖后才实际安装。

- 包索引：<https://snapshot.debian.org/mr/binary/pulseaudio-module-bluetooth/13.99.3-1/binfiles>
- 文件 SHA-1（用于匹配官方快照）：`24b7619a2bf012865adb8695333c8b9a131022a2`
- 下载入口：<https://snapshot.debian.org/file/24b7619a2bf012865adb8695333c8b9a131022a2>

现有 `/etc/pulse/default.pa` 已有条件加载蓝牙发现与策略模块的配置，安装后在当前音频会话加载模块，不重启现有音频服务。原 RK809 声卡和咪头输入仍可用。此方案仅适用相同 PulseAudio 版本的样机；其他镜像先核对版本及依赖，不可照抄降级。外设需由用户选择，再做实际连接和声音测试。

蓝牙完整配对向导、依赖与交互协议见 [bluetooth-pairing.md](bluetooth-pairing.md)。Mac 构建在临时目录完成编译和签名验证后才替换目标；`--app-version` 默认 `0.6.2`，包内 `ATOMCoreVersion` 记录实际设备核心版本。
