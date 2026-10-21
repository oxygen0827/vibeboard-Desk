# 合奏伙伴

原创八键 WebAudio 乐器。鼠标/触摸或 A S D F G H J K 弹奏，记录真实输入的音高、相对时间、时值。最多 64 个输入音符，每句 30 秒。AI 接奏经系统父桥生成，未配置模型时不会用随机音符冒充 AI。

青色时间线是用户演奏，金色是模型回应。播放、停止、草稿清空、保存均显式操作。保存通过 AtomApp ACK；读取失败禁止覆盖，退出停止全部振荡器并关闭 AudioContext。空格保留给系统 Home。

构建：`python3 atom/experiences/duet/build.py`。共享 UI 测试：`node atom/experiences/visual/ui.test.cjs`。
