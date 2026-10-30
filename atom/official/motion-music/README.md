# 音乐物理沙盒

在一个全屏容器中切换音符沙盒、瓶中海洋和光之容器。五个小球随重力与碰撞发出五声音阶，鼠标拖动松手可以抛掷；五向输入通过方向按钮改变重力，使用「拨动」演奏，无须精确点中画布。

## 使用

- 默认静音，点击「开启声音」才建立音频输出；最多 8 个同时发声音符。
- 场景操作不拦截方向键或空格，交给系统五向焦点与长按语音。
- 「录一段」记录最长 20 秒、最多 240 个音符事件（不录麦克风），再次点击完成。「回放」播放记录，「保存」等待设备确认后才提示成功。
- 最后一首作品包含场景、时间和音符；读取失败提供重试并锁定录制/保存，保护旧数据。不会往 localStorage 写入。
- 「重置场景」只重置小球与重力，不删除作品。返回按钮集成在标题栏，调用系统返回原桌面页。
- 默认明确显示「手动把玩 · 未连接惯性传感器」。鼠标与语义按钮可完整体验所有核心功能。

## 传感器与资源

可选 `AtomApp.sensors.subscribe(callback)` 接收共享事件 v1。只有设备明确报告 motion 可用后，点击底部传感器状态按钮才启用真实倾斜。roll/pitch 单位为度，限定 ±45° 后映射重力；手动操作立即切回手动模式。数据超过 2.5 秒未更新会回到手动模式，不伪造读数。当前灰板尚无可验收的惯性硬件，真实握持方向/滤波/延迟仍待选型校准。

一个 Canvas、5 个刚体、最多 20 条消散波纹，DPR ≤ 1.5；画面约 30fps，减少动态效果时 10fps，无 WebGL 依赖。隐藏页面暂停动画并停止回放/完成录制，恢复后需重新确认开启声音；退出取消 RAF、传感器订阅、ResizeObserver 并关闭 AudioContext。

## 构建与检查

```sh
python3 atom/official/motion-music/build.py
python3 atom/tools/check_app.py atom/official/motion-music
node --test atom/official/motion-music/physics.test.cjs
node atom/official/motion-music/browser.test.cjs
```

浏览器测试使用真实共享五向运行时、480×360 视口、模拟设备存储（仅测试），输出真实 UI 截图到 `/tmp/atom-motion-music-*.png`。不等于真机的 IMU、扬声器和持续帧率验收。作品的首页截图可经 ATOM Connect → 我的创作 → 首页截图上传，发布前须人工审核。
