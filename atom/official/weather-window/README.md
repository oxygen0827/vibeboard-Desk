# 天气之窗

一屏天气，七种实拍风景。默认上海，点击城市可选择常用城市或搜索其他城市；点击「风景」浏览晴天、云海、雨窗、森林雾气、雪景、雷雨、星夜。风景模式明确标注非实时画面，不伪造地点实拍或气温。

天气由 Open-Meteo 根据手选城市坐标提供，每 20 分钟刷新；网络错误显示上次天气和错误状态。照片随源码完整内置，不靠外部图片热链。API 原型与商用授权、照片署名见 [SOURCE.md](SOURCE.md) 和 [PHOTO-LICENSE.md](PHOTO-LICENSE.md)。

设置使用 AtomApp 保存；保存得到确认后才切换城市。串行写入和请求代次隔离，避免旧天气请求覆盖新城市。读取失败提供重试，退出中止请求及计时器。界面适配 480×360，无整页滚动；控件随系统外观，摄影颜色不反相。

```sh
python3 atom/official/weather-window/build.py
python3 atom/tools/prepare_icon_bundles.py
node atom/official/ambient-apps.test.cjs
```

完整 bundle 小于 1 MiB，包含全部七张图片。已上架云端源码市场；当前浏览器验证使用天气响应 fixture，样机因关机尚未安装和实测。联网安装后才有实时天气；电脑 Studio 的隔离预览不允许外网请求。
