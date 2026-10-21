# 系统维护、数据备份与模拟设备镜像

2026-10-22。此文描述灰色板维护通道和 ATOM Connect 0.6 内部测试版。系统核心版本由 `atom/VERSION` 标识；已安装应用通过应用市场单独升级。

## 在设备上使用

- **设置 → 系统更新**：检查版本、下载并校验、明确点击安装。显示真实下载、安装和恢复结果。安装只重启 ATOM 后端，不重启 LightDM/Xorg。
- **设置 → 数据与恢复**：创建最多 10 份本机备份；查看、导出、导入、恢复或删除。恢复前需要确认。恢复时会暂时阻止旧页面写回记录。
- **恢复初始设置**：输入完整文字「重置这台设备」。清除设备上的账号、配对、模型配置、桌面偏好、应用记录和本机备份；保留已安装应用、Wi-Fi 配置和云端账号内容。它不是磁盘刷机或删除云端账号。
- **同步到电脑模拟设备**：默认关闭，明确授权后才启用。随后在 Mac「设置 → 开发者工具」打开模拟设备，选择已配对真机，点击同步或开启持续跟随。同步覆盖模拟设备的对应本地记录，不向真机回写。

本机备份只保存桌面布局、外观、计时等经过审核的系统记录，以及 AtomApp v1 应用 JSON 存档；单个应用最多 64 KiB，整份记录最多 1500 KiB。它不包含应用安装包、账号令牌、模型配置、云端便签/日程和照片。导出的 JSON 可能包含应用里的个人内容，请自行妥善保存。损坏记录会报错，不能以默认空数据覆盖。

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

脚本面向现有 `/home/linaro/atom` 样机，其他用户名或路径需调整单元。不要用重启显示管理器来刷新前端；后端更新成功后刷新 Chromium 页面即可。

## 构建与发布

需要 Python `cryptography`。提交审核后的核心后再构建，构建器拒绝未提交的核心改动。私钥保存在维护者私有目录，**不得进入仓库**；仓库只包含设备信任的 `deploy/release-public.key`。

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

真机及线上验收结果见 [本轮维护交付记录](maintenance-delivery-2026-10-22.md)。
