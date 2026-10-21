# 来源与运行说明

ATOM 原创小屏界面与逻辑，MIT；不复制下列项目源码。设计研究参考 GitHub 的天气背景模式：
- https://github.com/BrianHepler/MMM-WeatherBackground
- https://github.com/Dangereye/the-weather

天气数据：https://open-meteo.com/en/docs ，CC BY 4.0，界面署名 Open-Meteo。当前使用其无需密钥的非商业原型接口，正式商业发行应配置商业订阅或自托管服务，不把原型免费端点当作生产商用授权。

仅请求手选城市坐标与城市名，不读取 GPS，不发送用户账号。20 分钟刷新一次，12 秒超时；网络失败展示上次天气并明确标记。默认城市上海可修改。七幅天气照片随源码包完整内置，按天气代码和昼夜切换；摄影集独立标注，浏览摄影时不显示虚构温度。照片来源和许可见 PHOTO-LICENSE.md 与 scenes.js。

设置与最近天气通过 AtomApp 保存在本机；读取失败提供重试，不覆盖已有状态。退出释放网络请求和计时器。电脑 Studio 的离线源码预览禁止网络，所以可以看摄影集，但当前天气需安装到设备后联网获取。
