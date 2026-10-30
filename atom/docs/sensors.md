# 共享传感器接口 v1

传感器目前尚未选型。本接口支持后续硬件适配，当前无硬件时如实返回 `unavailable`。不存在自动伪造的传感器数据。

## 应用

清单声明 `"capabilities":["sensors"]`。只有前台已安装应用、用户明确授权后才能收到快照；预览不能读取硬件。无需登录云账号。原始快照不上传或存储历史，第三方应用获得授权后仍能自行使用数据，因此只给信任的应用授权。

```js
const stop = AtomApp.sensors.subscribe(state => {
  if (state.available.motion) setTilt(state.motion.roll, state.motion.pitch);
  if (state.available.presence) showPresence(state.presence.present);
  // null / unavailable 不等于“无人”；继续提供手动控制。
});
AtomApp.onSuspend(stop);
```

返回取消订阅函数，重复调用安全。退出自动取消全部订阅。SDK/宿主中断超过三秒会退回不可用。所有回调数据只表示当前观测，不能推断身份、情绪、人数或工作效率。

```json
{"version":1,"source":"device","available":{"motion":true,"presence":false},"motion":{"roll":0,"pitch":0,"ax":0,"ay":0,"az":9.807,"moving":false},"presence":null,"updated_at":1793400000000}
```

`roll/pitch` 为度，`ax/ay/az` 为 m/s²。由加速度估算的倾角在剧烈运动中不等于精确姿态。`moving` 是加速度变化提示，不是已标定的“拿起”事件。默认坐标采用传感器轴；接入产品必须确认安装方向，必要时由硬件适配器重排/反转轴。

## 硬件适配

`GET /api/sensors` 只读。Linux 自动选择唯一一个提供三轴 `in_accel_*_input` 或 `in_accel_*_raw` 与 scale 的 IIO 设备；没有或多个设备时不猜测。按 [Linux IIO ABI](https://www.kernel.org/doc/html/v6.1/admin-guide/abi-testing.html) 将 `(raw + offset) * scale` 转为 m/s²。不修改采样率、供电和总线。内核驱动为硬件提供新鲜读数是前提。

UART/其他传感器的宿主适配器可原子替换 `/run/atom/sensors.json`。`ATOM_SENSOR_INPUT` 仅用于服务启动时指定另一个受控路径，没有向应用开放写接口。

```json
{"version":1,"updated_at":1793400000000,"presence":true,"acceleration":[0,0,9.80665]}
```

时间戳必须是当前 Unix 毫秒。文件为普通文件、最多 2048 字节，禁止符号链接；超过三秒、缺字段、错误类型或不合理数值均不当作可靠观测。可只提供 presence 或 acceleration；加速度缺省时尝试 IIO。存在输入须连续稳定 250ms 才成为有人，连续两秒才成为无人；失联立即未知。系统采样缓存上限 20Hz，前台按请求完成后 80ms 再读，只有存在信号时 500ms 再读；最终实际速率受驱动和硬件影响。

硬件型号未定前不得编造串口协议或 GPIO 编号。开发演示应由应用内显式标注的手动按钮触发，不能写生产适配器文件制造“真机传感器已通过”的证据。
