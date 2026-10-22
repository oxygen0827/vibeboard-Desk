# 蓝牙配对向导

小电脑「设置 → 蓝牙」先扫描并选择外设，核对名称与地址后点击「确认连接」。全部交互在 ATOM 内完成，不再要求跳转 Debian 桌面。

支持 PIN 字母/数字输入、数字配对码输入、两端六位数字比对、旧键盘 PIN 展示、键盘输入进度、配对授权和服务授权。连接失败、认证拒绝和超时均显示可重试的结果；进入蓝牙页面不会自动连接附近设备。已连接的外设可以断开或忘记。

只有设备列表或确实超长的提示区域允许滚动。向导占用一个 480×360 页面，短按 Home/空格退出遵循系统规则；输入框里的空格仍用于输入。返回设置分类、离开应用或浏览器页面关闭会取消尚未完成的请求。配对已完成后的取消不会擅自删除已经建立的系统配对记录，可以在列表明确选择「忘记」。

## 设备依赖

- BlueZ 5.x，`bluetoothctl`，系统 D-Bus。
- 运行 ATOM 的 Python 3 需安装 `python3-dbus` 和 `python3-gi`（GLib）。Mac 模拟器不会调用宿主机蓝牙。
- 设备用户需具有 BlueZ D-Bus 权限；灰板用户已在 `bluetooth` 组。
- 蓝牙音箱/耳机需要与当前 PulseAudio 匹配的 `pulseaudio-module-bluetooth`，具体灰板版本见 [系统维护说明](system-maintenance.md#灰色板蓝牙音频依赖)。

灰色样机已核实 BlueZ 5.50、python3-dbus 1.2.8、python3-gi 3.30.4 / GLib 2.58，无需在本轮额外安装这些依赖。普通 OTA 包含新 Python 模块，但不会自动运行 apt 或修改 root 授权。

## 协议与生命周期

实现遵循 [BlueZ 5.50 Agent API](https://github.com/bluez/bluez/blob/5.50/doc/agent-api.txt) 和 [Device API](https://github.com/bluez/bluez/blob/5.50/doc/device-api.txt)。每次请求使用独立的 D-Bus 连接与 `KeyboardDisplay` Agent1，只接受 BlueZ 发给用户所选 Device1 的调用。不注册系统默认代理，也不会接受其他设备的配对挑战。

HTTP 调用均要求本机同源、JSON 请求体：

| 接口 | 请求字段 | 用途 |
| --- | --- | --- |
| `POST /api/bluetooth/pair-start` | `id`、`address`、`confirm:true` | `id` 为客户端随机生成的 32 位小写十六进制串；重复请求不会启动第二次配对 |
| `POST /api/bluetooth/pair-status` | `id` | 获取状态并续期页面活动租约 |
| `POST /api/bluetooth/pair-respond` | `id`、`challenge`、`value` | 回答当前挑战；PIN 为字符串，数字输入为数字字符串，确认/授权为布尔值 |
| `POST /api/bluetooth/pair-cancel` | `id` | 幂等取消；先到达的取消也会阻止迟到的开始请求 |

状态为 starting / pairing / connecting / waiting，以及 connected / cancelled / expired / failed。只在 BlueZ 的实际 Connected 属性为真后报告成功，并随后将所选外设设为 Trusted。用户输入的 PIN 经私有子进程管道转交，不回显到状态响应或写入日志、配置；BlueZ 要求展示在屏幕上的配对码仅用于当前挑战。

一次操作最多 180 秒；页面停止续期 20 秒自动取消。正常结束、拒绝或取消均注销代理；超时清理异常进程。`CancelPairing` 撤销待处理配对，正在建立的新连接会执行 Disconnect；不影响之前已经连接的外设。浏览器请求有 8 秒超时，保持输入内容并提供重试反馈。

## 验证

```sh
python3 -m unittest discover -s atom/tests -p 'test_bluetooth*.py' -q
node atom/tests/bluetooth-pairing.ui.cjs
# 在有 dbus / GLib 的 Debian 环境运行；创建私有 dbus-daemon，不访问真实系统蓝牙：
python3 -B -m unittest discover -s atom/tests -p test_bluez_agent_integration.py -v
```

本轮 15 项会话/HTTP 测试通过。真实设置页在 480×360 的隔离 Chromium 验证 PIN、数字输入、数字比对、显示进度、授权、取消、迟到响应清理及页面高度；不存在整页滚动。

在灰板 `/tmp` 的隔离目录使用私有 D-Bus 和 fake BlueZ，运行实际 Agent1 worker 的 11 项集成测试全部通过，包括拒绝未选择的设备、取消挂起挑战、页面进程断开、蓝牙服务连接失败不误报、代理注销，以及连接成功后才设为可信。测试没有连接系统蓝牙总线，没有配对任何附近外设，也没有重启 ATOM 或显示服务。

用户当前没有可供测试的蓝牙外设，真实耳机/音箱/键盘的配对与声音验收留待提供外设后进行；协议模拟通过不等同于全部硬件兼容性测试。
