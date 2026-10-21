# ATOM AI 原生体验（研发版）

四个原创作品，不是旧游戏的简单缩放。设备负责交互和渲染；世界参数、着色器和音乐由工作坊中配置的真实模型生成。密钥只在 Python 后端使用。

| 应用 | 交互 | AI 与持久化 |
| --- | --- | --- |
| 共生世界 `symbiotic-world` | 等距海岛、咖啡馆、小猫、拖动旋转、昼夜天气 | 一句话修改有界场景；通过校验后替换并确认保存，失败保留原世界 |
| 语言炼金 `language-alchemy` | 320×240 WebGL 材质，鼠标影响运动 | 模型生成 GLSL，实际编译成功才替换上一作品；点击保存 |
| 合奏伙伴 `ai-duet` | 鼠标/键盘弹奏，真实音符时间线和 WebAudio | 根据所弹乐句生成接奏，可回放与保存；不是原始录音转音乐 |
| Agent 小屋 `agent-studio` | 原创等距像素工作室、按电脑筛选、关注与真实任务分页 | 整合任务伙伴的关注保存、任务优先级与回传时间；断线显示上次状态；点任务进入「我的电脑」审批、预览或安装，绝不伪造Agent思考 |

三个创作应用支持长按空格录音、松手转写到需求框；确认后才生成。图形本身不需要麦克风。语言炼金没有音频分析输入，`u_audio` 当前为 0。AI 网络请求需要有效模型服务，已保存作品可以本地运行。任务离开应用后可能继续在后端完成；重启服务不恢复内存中的生成任务，原作品保留。

## 开发和安装

各目录 `build.py` 生成包含所有资源、许可和语义 `icon.svg` 的 `bundle.json`。更新保留桌面顺序；首次安装追加末尾。运行 `python3 atom/tools/prepare_icon_bundles.py` 后再验收图标。

设备后端 `atom/experiences.py` 提供 `/api/experiences/{generate,job,cancel}`，沿用设备同源保护。应用沙箱经 shell 中按应用 ID 白名单的消息桥访问；后端强制限制物体、音符和着色器复杂度。模型回复仍可能无法编译，应用显示真实失败并保留上一份材质，不承诺任意需求都能生成。

## 验证

- `python3 -m unittest discover -s atom/tests -p test_experiences.py`
- `node atom/experiences/world/test.cjs`
- `node atom/experiences/visual/ui.test.cjs`
- `node atom/experiences/agents/ui.test.cjs`

2026-10-21：在真实 RK3566 / Chromium 91 上安装四个应用，验证全屏、实际 Canvas/WebGL 渲染、真实模型世界/着色器/接奏任务完成。旧 Chromium 深拷贝兼容和无 allow-forms 沙箱点击生成问题已修复。这里只记录实际执行的项目，不将桌面浏览器性能视为设备帧率数据。

四个作品已由 `atom/official/catalog.json` 纳入官方市场种子目录，云端部署包含 `experiences` 完整源码。电脑端与设备端共享云端目录，可查看完整源码、安装或派生。
