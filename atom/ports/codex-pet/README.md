# Codex 宠物 · ATOM Debian 移植

480×360 黑底全屏陪伴场景，三只离线宠物、九态动作、默认使用素材自带工作动作、点击/中心键跳跃。
右上角菜单包含换宠物、动作预览和工作状态；五向输入可完成所有操作。
首次打开直接陪伴，点击「工作状态 → 连接工作状态」才请求读取权限。
不叠加小电脑道具；工作与审阅直接播放原素材。默认工作动作属于本地陪伴，不宣称真实任务正在运行。等待有气泡，完成挥手；手动预览有明确标记。
启用同步后每秒读取一次状态；只选择 Codex 桌面来源时不请求 Connect，以免另一条链路拖慢刷新。
支持两个真实数据源：ATOM Connect 已配对任务，以及 Codex 桌面 Hook 状态摘要。
首次读取任务需用户授权；预览不获得能力。没有连接时仍可和宠物互动。
动作预览始终标注“非任务状态”，不伪造任务进度。

## 构建与安装

```sh
python3 atom/ports/codex-pet/build.py
python3 atom/tools/prepare_icon_bundles.py
python3 atom/tools/check_app.py atom/ports/codex-pet/bundle.json
python3 atom/tools/deploy_app.py install atom/ports/codex-pet/bundle.json
```

应用 bundle 包含全部精灵，不需要 BLE、模型服务或运行时下载。新宠物通过
`import-sprites.py` 从本地原项目格式的 8×9/11 精灵表导入，再重建 bundle；换宠物偏好保存
在 AtomApp 中。读取失败时允许重试且不覆盖记录；保存等待设备确认。退出清理所有轮询、
动画和未完成桥请求。减少动态效果或系统禁用动画时显示静态帧。

Connect 状态、来源授权和跳转需要本次更新后的 `static/app.js`；桌面 Hook 还需要
`codex_pet.py` 与 `server.py` 的新路由。不能只安装应用后宣称后端已经更新。

## Codex 桌面 Hooks

此路径复用 SSH，不增加设备监听端口，不更换固件。设备须放置本仓库
`atom/codex_pet.py` 与 `atom/tools/codex_pet_hook.py`。

在电脑 Codex 支持的 Hook 配置中，为 SessionStart、UserPromptSubmit、PreToolUse、
PostToolUse、PermissionRequest、Stop、SubagentStop 选择需要的事件，使用同一命令：

```sh
python3 /ABSOLUTE/REPO/atom/tools/codex_pet_hook.py --ssh-host YOUR_ATOM_SSH_HOST --remote-root /home/linaro/atom
```

Hook JSON 由 stdin 输入。脚本仅传事件名、会话/轮次 ID、项目目录名和发送时间，
绝不传 prompt、tool_input、完整路径。使用 SSH 密钥及已有 known_hosts；BatchMode 禁止
交互密码提示。离线最多等待 5 秒并报告未送达，Hook 不阻断编码任务。
本次不自动修改用户已有 Codex Hooks 配置，不伪造 Hook 安装状态。
非标准 SSH 端口可加 `--ssh-port 6278`，指定现有私钥可加
`--identity-file /PRIVATE/PATH/key`；首次需先核对并建立可信主机记录。

设备原子保存最近十个会话，保留两小时；锁保护并发，旧事件和本轮完成后的迟到工具事件
不会覆盖新状态。Hook 无持续心跳，超过两分钟明确显示“上次状态/当前进度未知”，
不会将长期运行或电脑离线猜成完成。外部桌面审批只提示在电脑处理；
Connect 任务通过“任务详情”进入原有受控审批页。

## 验证与封面

```sh
/usr/bin/python3 -m unittest discover -s atom/tests -p test_codex_pet.py
node atom/ports/codex-pet/scene.test.cjs
node atom/ports/codex-pet/ui.test.cjs
node atom/ports/codex-pet/smoke.test.cjs
```

浏览器测试使用明确的演示任务与模拟父桥，不能替代真实 Codex Hook、SSH、摇杆或设备性能验收。
`smoke.test.cjs` 另启动真实设备后端并安装完整包，使用隔离临时目录，验证真实接收器→设备文件→
API→沙箱显示；Mac 默认用 `/usr/bin/python3`，可用 `ATOM_PYTHON_EXECUTABLE` 指定兼容 Python。
封面取真实空状态渲染。ATOM Connect → 我的创作 → 首页截图可上传首页封面；
当前发布对话框要求封面，公开发布前同时核实 SOURCE.md 的图片授权。
