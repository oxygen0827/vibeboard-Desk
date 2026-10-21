# 共生世界

原创建筑几何与等距海岛绘制，无外部资源、无 CDN、无第三方素材。480×360 全屏；水平拖动旋转，轻触建筑、小猫、树木显示回应；右上角昼暮夜与晴雨雪即时改变氛围。底部输入框提交真实模型任务，成功后更新世界并等待设备存储确认。语音转写只填入输入框，不会自行提交。

运行 `python3 atom/experiences/world/build.py` 构建完整 `bundle.json`。`node atom/experiences/world/test.cjs` 用真实 Chromium Canvas 渲染及模拟设备桥验证布局、旋转、天气、模型失败保留与持久化确认。

## 桥接

向父窗口发送 `{type:'atom:experience',id,action:'generate',data:{kind:'world',prompt,state}}`，父窗口回 `{id,result:{job:{id,status}}}`；轮询 `action:'job',data:{job_id}` 返回 `result.job`。完成后的 `job.result` 是完整 scene，也兼容 `{scene}`。错误用顶层 `error`。仅接受父窗口消息；父窗口必须自行验证 iframe 来源与请求权限。模型凭据不进入应用。

scene 为 `{title,sky,weather,atmosphere,objects}`，对象支持 cafe/house/tree/cat/lamp/boat/mountain/flower，最多 32 个，范围 ±4、scale .4–2。只接收声明式数据，不执行生成的代码。

持久化使用 AtomApp.load/save；读取失败保护已有数据并提供重试。保存失败保留当前画面但显示真实失败，禁止继续模型生成直到成功保存。无独立浏览器存储。暂停停止渲染与轮询，减少动态效果时只在交互时重绘。Canvas 最高 2× 分辨率、30fps 上限。
