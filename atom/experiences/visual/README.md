# 语言炼金

原创 WebGL 1 材质工作台。默认月银 shader 是本地原创预设，不假称 AI 生成。320×240 内部分辨率、30 fps 上限；减少动态效果时静止。光标扰动物质，不申请麦克风；u_audio 在无真实音频时为零。

输入需求后调用父层 atom:experience generate/job；仅完成的真实模型结果才编译，编译失败保留之前可用材质。长按语音由系统处理，识别结果填入输入框后用户确认。保存通过 AtomApp ACK，读取失败不允许写入，退出释放 WebGL。

构建：`python3 atom/experiences/visual/build.py`。测试：`node atom/experiences/visual/ui.test.cjs`。测试使用真实 Chrome WebGL / WebAudio 与模拟父桥，不代表模型或真机性能验收。
