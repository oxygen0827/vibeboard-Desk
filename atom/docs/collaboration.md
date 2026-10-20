# ATOM 协作开发手册

## 从这里开始

本仓库包含早期 VibeBoard 项目与 `atom/` 独立设备系统。ATOM 的设备服务、桌面、官方应用、电脑伴侣与中继都在 `atom/`，不要用它覆盖仓库其他历史项目。

```sh
git clone https://github.com/wangqioo/vibeboard-Desk.git
cd vibeboard-Desk
python3 atom/server.py
```

浏览器打开 `http://127.0.0.1:8770`。设备界面以 480×360 为基准。Python 3.7+，设备服务无 pip 依赖；Mac/Windows 可开发界面，但驱动、音频、风扇、GPU 的验收必须在 Linux 样机进行。本地空目录没有样机的个人数据和已安装应用，需要按下文构建并安装。

## 分工与代码地图

| 负责内容 | 主要目录 | 注意事项 |
| --- | --- | --- |
| 设备后端与硬件 | `atom/server.py`、`atom/voice.py`、`atom/deploy/` | 同源、权限、凭据隔离；不要顺手重启图形服务 |
| 桌面与系统工具 | `atom/static/` | 大图标分页、滚轮/拖动、Space/Home、全屏切换 |
| 官方视觉规范 | `atom/design/device-ui.css` | 统一设计源；修改后重新构建客户端，不只改生成副本 |
| 日用/创作客户端 | `atom/notes-app/`、`market-app/`、`computer-app/`、`library-app/` | 业务源码、私有数据的受控桥、完整安装包 |
| 五个原创官方作品 | `atom/official/` | 今日、伙伴、音乐、点阵及任务状态 |
| 个人电脑伴侣 | `atom/connect/computer/`、`desktop/` | Node 24+；原生 Mac 外壳；Agent 与 Studio |
| 中继和市场平台 | `atom/connect/relay/`、`marketplace/` | Python/SQLite，账号与配对权限分离，持久化任务/版本 |
| GitHub 移植应用 | `atom/ports/` | 完整资源、许可、上游来源；不要只复制 JSON 入口 |
| 协议与说明 | `atom/docs/app-contract.md`、`atom/connect/PRODUCT-CONTRACT.md` | 改接口前先更新契约，避免三端各自猜测 |

## 构建官方应用

在仓库根目录执行：

```sh
python3 atom/market-app/build.py
python3 atom/computer-app/build.py
python3 atom/library-app/build.py
python3 atom/official/build.py
python3 atom/tools/prepare_icon_bundles.py
```

上述构建会自动把统一 `device-ui.css` 复制进九个完整的离线源码目录。生成包位于 `atom/examples/` 和各官方作品的 `bundle.json`。不要只改 bundle JSON；它会在下次构建被源码覆盖。对特殊上游移植，按各目录的 README/build 脚本操作；`atom/vendor/` 为本地构建缓存，不进入仓库，安装资源在各移植目录中随包保留。

## 本地回归

```sh
python3 -m unittest discover -s atom/tests
python3 -m unittest discover -s atom/connect/relay -p 'test_*.py'
python3 -m unittest discover -s atom/connect/marketplace -p 'test_*.py'
node --test atom/connect/computer/test/*.test.mjs
node atom/tests/app-host.test.cjs
node atom/tests/app-runtime.test.cjs
npm --prefix atom ci
cd atom
npx playwright install chromium
npm run test:ui
```

浏览器测试优先使用仓库的 npm 依赖。在 Mac 上可使用已安装 Chrome，也可设置 `ATOM_CHROME_EXECUTABLE` 指向浏览器。`ATOM_PLAYWRIGHT_MODULE` 可指定已有 Playwright 模块。测试使用明确的父桥/服务 fixtures；不能把通过 fixtures 当成真实推理、录音质量或真机性能证明。

## 部署到样机

先在设备设置中打开开发模式。使用自己的 SSH 别名和密钥，通过隧道连接：

```sh
ssh -N -L 127.0.0.1:8770:127.0.0.1:8770 YOUR_ATOM_SSH_HOST
python3 atom/tools/deploy_app.py list
python3 atom/tools/deploy_app.py update atom/examples/quick-notes.json
python3 atom/tools/deploy_app.py update atom/official/sound-lab/bundle.json
```

首次安装普通应用使用 `install`，已安装时使用 `update`。CLI 会自动让受保护的官方客户端走审核更新接口。完成更新后刷新桌面；校验图标、位置、退出返回页、存储、音频和后台暂停行为。禁止把开发 Mac 的整套空 `apps/`、`state/` 覆盖到样机。先备份，再修改设备服务或启动脚本。

电脑伴侣、中继、市场和配对的启动命令见 [Connect 部署指南](../connect/README.md) 与 [市场说明](../connect/marketplace/README.md)。本机联调不代表公网服务已上线。云部署另需 HTTPS、备份、限流与账号运营。

## 必须遵守的产品规则

- 全屏应用，不保留系统常驻栏；普通操作页固定一屏，只有长列表、正文、源码、结果等必要内容区可滚动，右侧滚动条隐藏。不能用 `overflow:hidden` 把无法操作的内容藏掉。
- 统一主题令牌和字体层级；颜色、按钮主次、内容留白形成整体。音轨、场景、科学数据的颜色有实际意义，应保留。当前系统主题的强制控件样式要通过真机检查，单独浏览器预览不足以发现覆盖问题。
- 每应用独立 `icon.svg`，64×64、透明、单色 `currentColor`，遵循 [AGENTS.md](../../AGENTS.md)。更新保留用户已有合法图标。
- AtomApp v1 做持久化；只有保存确认后才报告成功。失败读取不覆盖旧数据，64 KiB 限额，退出释放音频/GPU/计时器。
- 新应用追加，更新保留位置。退出回打开时的桌面页，已在桌面时 Space/Home 回第一页；鼠标正常显示，左右方向键翻页。已取消上下行键盘选择和自动隐藏鼠标。
- 公共安装资源不携带模型密钥。配对状态、市场账号令牌、工作区和真实个人记录不提交。配置通过文档示例和各自的本地设置复现。

## Git 协作建议

每人建立自己的 `codex/功能名` 或团队约定分支，通过 Pull Request 合并。改动说明包含「解决的问题、真机截图或录屏、实际跑过的测试、剩余限制」。三端接口变更先商定契约；不同人尽量分目录工作，共同修改 `server.py`、`static/app.js` 时先协调。

提交前检查 `git diff --stat` 与 `git diff --cached`。不提交 `atom/apps/`、`atom/state/`、`.env`、本机安装包、数据库、备份或第三方构建缓存。第三方素材与代码保留原许可证；根项目说明不替代各上游授权。
