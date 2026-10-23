# 智谱语音接入与真机验证

官方文档：

- [语音转文本](https://docs.bigmodel.cn/api-reference/模型-api/语音转文本)：POST https://open.bigmodel.cn/api/paas/v4/audio/transcriptions，Bearer认证，multipart file+model，glm-asr-2512，同步stream=false，WAV/MP3，最长30秒。
- [文本转语音](https://docs.bigmodel.cn/api-reference/模型-api/文本转语音)：POST https://open.bigmodel.cn/api/paas/v4/audio/speech，Bearer认证，glm-tts，input/voice，response_format=wav，stream=false，文本最多1024字；默认彤彤tongtong。

官方Markdown版本经llms.txt索引获取并核对。没有部署大型本地语音模型，语音服务需要网络。应用生成模型继续使用已配置的DeepSeek。

## 使用入口

工作坊→模型配置→录音转写/语音播报；播报页可选择7个官方音色，进入“试听 / 朗读”编辑文本。长按空格进入语音需求；松手自动停止并转写，可编辑再生成。短按空格确认焦点控件；Home 退出至原桌面页并停止播报，在桌面按 Home 回第一页。设置→陪伴与交互可关闭语音完成提示。

## 状态与退出

录音准备阶段直到麦克风输出PCM后才显示倾听；50ms采集缓冲，降低漏字风险，停止后保证实际WAV不超过30秒。转写使用云端结果；转写成功才更新需求草稿。朗读分“准备语音”和“正在朗读”，后者由paplay实际播放状态驱动。录音会停止朗读，录音期间拒绝启动播报，避免回声。播报可取消；过期的生成结果不会在取消后播放；完成后删除临时播报文件。

密钥只在设备受限配置中保存，API返回key_set标志而不是明文；不把密钥放入应用、截图或日志。

## 测试证据

- 云端合成测试：24kHz、单声道WAV，5.848秒音频，约1.99秒生成。
- 云端转写同一测试音频：约0.52秒，正确识别测试句。
- 真机麦克风16kHz单声道录音，经扬声器播放测试句，工作坊转写得到17字，包含“这是一段语音测试”。现场有一处同音词误识别，转写内容可在编辑页修改；不承诺所有环境下零误差。
- 真机朗读、完成状态、Home取消播放、长按录音、停止转写和声音提示均已验证，页面无脚本错误。
- 扬声器monitor采样验证非零输出，RMS1257、峰值23570。monitor只用于输出验证，没有充当麦克风。
- 45项Python测试与两组JavaScript协议测试通过；30秒WAV截断、凭据隐藏、异步取消和独立保存均有验证。

记录：artifacts/zhipu-voice-verification.json，相关真机截图以zhipu-开头。具体耗时为本次测试结果，不是延迟保证。
