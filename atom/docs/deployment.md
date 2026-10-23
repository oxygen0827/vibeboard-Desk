# 样机部署与恢复

本指南针对 Debian 10 BSP / RK3566 透明泰山派、用户 linaro。其他设备先适配路径、音频服务和图形栈。保留原桌面、备份 LightDM/Openbox/systemd 配置后再修改。

## 主系统

1. 将仓库 `atom/` 复制为 `/home/linaro/atom`；不复制任何他人的 state/、SSH 密钥或浏览器 profile。
2. 执行 `sh deploy/install.sh`，安装 atom.service、ATOM 会话、LightDM 配置和背光 udev 权限。脚本不会通用安装 GPU 驱动、模型账户、风扇服务或音频实验 helper。
3. 选择 ATOM 图形会话。启动器使用 `/usr/lib/chromium/chromium-bin`、LD_LIBRARY_PATH 与 EGL；不要误用会强制禁用 GPU 的 BSP wrapper。
4. 显示保护可按样机配置安装 `deploy/atom-display-guard.service`，服务使用 `deploy/display-guard.py`；审核路径后执行 systemctl daemon-reload 和 enable --now。`deploy/xorg/20-modesetting.conf` 是本样机已验证配置，不应直接覆盖其他显卡配置。

后端 8770 仅监听回环，远程通过 SSH 转发。写请求要求一致的 Host/Origin。`deploy/start-atom.sh` 启动全屏浏览器，`atom-session.sh` 保持单工作区并恢复浏览器。返回使用左上角箭头或 Home；Space 短按用于确认、长按用于语音，不用 Alt+F4 退出宿主。

## 完整移植资源

JSON 包仅适用于文本资源完整的小应用。大移植的 `ports/<id>/bundle.json` 可能只包含入口；先使用安装器登记，再复制上游 JS、图片、字体、WASM、LICENSE 和源文件到该应用目录。已有应用需用 update 保留安装顺序，不通过卸载重装更新。部署前使用 prepare_icon_bundles.py 和 check_app.py，部署后检查真实主题、全屏、Home 与必要列表滚动。

## 日志与健康检查

```bash
curl http://127.0.0.1:8770/api/health
systemctl status atom atom-display-guard
journalctl -u atom -n 50 --no-pager
tail -50 /tmp/atom-kiosk.log
```

音频依赖 `/tmp/pulse-socket`，atom.service 指定 PULSE_SERVER。不要给该样机服务加 PrivateTmp；保留 NoNewPrivileges。音频与 GPIO 特权动作交给限定操作的 helper，不放开任意命令接口。

## 回退

移除 `/etc/lightdm/lightdm.conf.d/50-atom-session.conf`，禁用 atom 与可选的显示保护服务，再选择原 LXDE 会话；重启 LightDM 会退出当前图形会话。若此前改过 LXDE autostart，从自己的备份恢复。不要依赖本仓库不存在的私人备份路径。

麦克风单端实验回退见 audio-diagnostics.md。不要用一套批量覆盖命令恢复不同设备的内核、GPU、显示或 PMIC。
