# ATOM 开源小游戏移植：任务交接

状态（2026-10-21）：第一步（调研与挑选）已完成两版候选，**等待用户最终勾选**；第二步（移植、安装、真机验证）尚未开始，仓库代码未改动。

- 候选清单：[candidates.md](candidates.md)（含原作者截图、许可证、风险）
- 可视化挑选页：`game-picks.html`（单文件，图片内嵌；浏览器打开后可勾选并复制回复）
- 结构化数据：`candidates.json`；截图：`img/`（每张图的出处写在清单里）

## 背景

ATOM 运行在 RK3566 小电脑上（Debian 10，480×360 屏幕，带键盘，GPU Mali-G52）。本地 Python 服务 + Chromium 全屏外壳，每个应用在沙箱 iframe 里运行（`sandbox="allow-scripts"`，**没有 allow-same-origin、没有 pointer lock**）。应用规范见仓库根目录 `AGENTS.md`，以及 `atom/docs/app-contract.md`。

**这把键盘带惯性传感器**：倾斜/晃动键盘会移动鼠标光标。用户希望多选体感玩法、画面有趣的游戏，所以第二版把体感游戏放在前面，键盘游戏也逐个写了可以加的体感操作。

## 移植前需要向用户确认

1. 倾斜键盘时，光标是“停在与倾斜角对应的位置”，还是“朝倾斜方向持续移动”（倾斜角对应速度）？
   - 前者：飞机/冰球/准星直接用光标位置。
   - 后者：游戏内把 mousemove 位移积分成“倾斜量”，并做自动回中。
2. 键盘有没有鼠标左键？没有的话开火/发射统一映射到回车。
3. 最终移植哪些游戏（用户在挑选页勾选后回复）。

因为没有 pointer lock，光标到屏幕边缘就停住：体感游戏一律以光标位置为准，或者带回中逻辑。

## 推荐首批

体感：The Aviator、Air Hockey 3D、Radius Raid、Astray（改为倾斜控制）
键盘（可加体感）：Hextris、T-Rex Runner、Clumsy Bird、Bombergirl

## 已排除

- 切水果 ChineseDron/fruit-ninja：玩法最适合体感，但无许可证且使用 Fruit Ninja 原版美术。可考虑原创实现同类玩法。
- JavaScript Racer（音乐不可再分发、精灵借自世嘉 OutRun）、Space Invaders（画面太朴素）、Tower Building（竖屏、仅点击）。
- Space Huggers（作者声明不得再分发）；react-tetris、Jump n Bump、Cube Slam 镜像（无许可证）；LittleJS 3D 示例（WebGL 太重）。

## 第二步待办（用户确认后）

每个选中的游戏做成一个独立应用：

- [ ] 按 `AGENTS.md` 规范：语义化单色 `icon.svg`（64×64 viewBox、`currentColor`），`manifest.icon="icon.svg"`；全屏，无常驻系统界面。
- [ ] 保留空格/Home 返回桌面。原版用空格的游戏（T-Rex 跳、Clumsy Bird 拍翅、Bombergirl 放炸弹、Duck Hunt 等）改成 ↑/回车/X，参考 `atom/static/home-key.js` 和 `atom/docs/app-contract.md`。
- [ ] 用 AtomApp v1（`AtomApp.load/save`，64 KiB 限额）保存最高分/进度，替换原来的 localStorage。
- [ ] `onSuspend` 时暂停游戏、停止音频和 requestAnimationFrame 循环。
- [ ] 体感适配：按上面确认的光标行为实现（位置跟随 / 位移积分+回中 / 甩动手势识别）。
- [ ] 参考已有移植 `atom/ports/` 和 `atom/ports/README.md`：记录上游地址、固定提交、改动和许可证；完整复制资源，保留原 LICENSE；GPL 游戏（Hextris、Clumsy Bird）移植版同样以 GPL 发布。
- [ ] 去掉外链、社交按钮、统计、外部字体，保证完全离线。
- [ ] 480×360 下重排布局（多数原版是竖屏或 800×600）。
- [ ] 打包，用 `atom/tools/deploy_app.py` 安装到小电脑（设备服务只监听 127.0.0.1:8770，通过 SSH 隧道访问；SSH 连接信息找用户要，不写进这个公开仓库）。新应用追加到桌面末尾。SSH 连续建连容易被断，尽量一次连接做完多步。
- [ ] 真机验证：能玩、帧率（WebGL 游戏重点测 Mali 上的 FPS）、无 pageerror、scrollHeight=360、空格返回桌面、存档正常。
- [ ] 在 `atom/ports/README.md` 记录每个游戏的操作方式、改动、许可证和实测结果，然后提交。

## 注意

- 另一个会话正在改机器人眼睛/语音对话（robo-face 等、`voice.py`、`tts.py`、`stt.py`），不要改这些文件。
- The Aviator 的 Codrops 许可允许修改后用于项目，但不得原样再发布；Duck Hunt 的美术和音效是任天堂原版素材，只适合用户自己设备上玩。
