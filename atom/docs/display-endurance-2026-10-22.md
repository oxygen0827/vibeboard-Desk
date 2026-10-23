# 灰色板显示与重启验收

设备核心保持 `2026.10.22.10.4`，没有回退五向导航，也没有更新内核或热重启 LightDM。

## 已完成

- 三次正常 `systemctl reboot` 后记录到三个不同的新 boot ID，ATOM、LightDM、FRP 和实体 DRM 的 Smart0-win0 显示层均恢复。正常重启不能等同物理断电冷启动。
- 启用限额持久日志：`/etc/systemd/journald.conf.d/atom-diagnostics.conf`，32 MiB、保留7天、至少保留256 MiB可用空间；跨重启日志已验证。
- 部署只读 `atom-display-recorder.service`，脚本 `/usr/local/lib/atom/display-recorder.py`。每10秒记录boot ID、温度、可用内存、DRM summary及Xorg状态；D状态抓取等待栈。数据为root私有，`/var/lib/atom/display-health/samples.jsonl*`，单份1MiB、3份轮转，约4MiB上限。采样不会修改显示或主动重启。
- 发现自动校时关闭时 `systemd-time-wait-sync` 无限等待，阻塞部分启动target。用drop-in `atom-bounded-wait.conf` 将等待限为30秒，最后一次重启确认启动job全部结束。该等待服务仍明确报告超时/未同步，未伪造校时成功，也未改变用户NTP选择；这与BSP显示卡住不是同一个问题。
- 一次自动重启循环未观察到boot ID改变，已停止自动重试；随后逐次明确发送重启并核对新boot ID。不能将该次没有观察到重启计为通过。

## 八小时图形测试

2026-10-22 23:30（北京时间）开始，预计10月23日07:30结束。保持光子芯片运行。设备浏览器每分钟记录本地服务状态、版本、页面可见性和iframe每10秒的动画回调计数；内核侧同时每10秒采样显示与资源。

浏览器测试记录在系统页面localStorage `atom.qa.display-soak.v1`（非应用存档，无账号凭据）。`completed`仅代表计时完成，不能单独证明通过；还要检查样本覆盖、帧停滞、显示层、D状态、温度和内存。离开应用或版本变化标记interrupted；浏览器重启导致采样断档也应判为中断。用户存档没有被测试覆盖。

当前测试用CDP 9222仅绑定设备loopback；到本机的临时SSH隧道可关闭，不影响页面内计时。开始脚本留在 `/private/tmp/atom-start-soak.cjs`。脚本注入的计时在设备浏览器运行，不依赖Mac保持连接；整机或浏览器重启仍会中断。

已设本线程一次性跟进：北京时间10月23日07:35检查结果。检查时连接灰板，读取该键及root采样，保存脱敏摘要，再返回桌面、删除测试键、将 `/etc/default/atom-kiosk` 的 `ATOM_DEBUG=0`。只终止带9222参数的主Chromium进程让ATOM会话重新启动浏览器以关闭调试，绝不热重启LightDM。关闭临时隧道。测试结束后可以停用采样：`sudo systemctl disable --now atom-display-recorder`，保留证据供诊断。

## 尚未完成

- 真正断电再上电：等待用户确认可以现场操作，不远程关机后要求无人现场的设备自启。
- 八小时结果已于10月23日核验，见下节；物理冷启动尚未完成。

部署配置源文件：`atom/deploy/display-recorder.py`、`atom-display-recorder.service`、`diagnostics/journald.conf`、`diagnostics/time-wait.conf`。这是灰板维护配置，不自动刷到其他硬件；重启、冷启动和长稳测试应分别记录。

## 2026-10-23 八小时结果

23:30:45 至次日07:30:45，实际8.00002小时，版本始终为 `2026.10.22.10.4`，boot ID始终一致，自动结束后回到桌面。

| 检查 | 结果 |
| --- | --- |
| 浏览器 | 480次采样，最大间隔60.054秒，无服务请求错误、版本变化或隐藏页面 |
| 动画回调 | 每10秒570–599次；只是requestAnimationFrame回调，不是独立测量的实际GPU呈现帧率 |
| 系统采样 | 2,828次，最大间隔10.243秒，首尾覆盖距离测试边界小于3秒 |
| 显示与Xorg | 无显示层缺失、无Xorg缺失、未采样到D状态 |
| 温度 | 50.625–62.222°C |
| 可用内存 | 1513.05–1577.77 MiB；开始/结束10分钟均值1544.60/1521.43 MiB，下降约23.17 MiB，不能仅据此排除慢速泄漏 |
| 内核日志筛查 | 本次boot未检出blocked-for、Call-trace、panic、Oops、OOM或GPU/DRM/VOP故障超时关键词 |

本次单应用持续运行验收通过；采样间隙中的瞬时问题、其他应用和图形会话退出路径不在该结论内。旧BSP卡住根因没有复现或修复证明。

脱敏原始浏览器采样、系统时间序列、摘要和结束桌面截图位于 [endurance-20261023](../artifacts/endurance-20261023/)。已移除浏览器测试键、恢复桌面、设置ATOM_DEBUG=0并仅刷新Chromium、关闭SSH调试隧道；一次性跟进已暂停。限额只读采样与持久日志保留，供未来故障诊断。

## 2026-10-23 用户关闭专项跟进

按用户要求，从当前问题清单和后续计划中移除单次历史 BSP 图形会话退出故障，不再安排专项复现、驱动修复或周期跟进。历史证据及八小时测试结果保留，不将关闭写成已修复。专用显示采样服务停用；一般系统持久日志和已有安全恢复逻辑保留。
