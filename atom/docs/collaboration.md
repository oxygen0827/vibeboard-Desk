# ATOM 协作开发手册

## 从这里开始

本仓库维护当前 ATOM 产品。设备服务、桌面、官方应用、电脑伴侣与中继都在 `atom/`；旧 VibeBoard 网页平台已删除，原始代码可从 Git 历史追溯。

```sh
git clone https://github.com/wangqioo/vibeboard-Desk.git
cd vibeboard-Desk
python3 atom/server.py
```

浏览器打开 `http://127.0.0.1:8770`。设备界面以 480×360 为基准。Python 3.7+，基础桌面使用标准库；加密配对与验签需要 cryptography；Mac/Windows 可开发界面，但驱动、音频、风扇、GPU 的验收必须在 Linux 样机进行。本地空目录没有样机的个人数据和已安装应用，需要按下文构建并安装。

## 分工与代码地图

| 负责内容 | 主要目录 | 注意事项 |
| --- | --- | --- |
| 设备后端与硬件 | `atom/server.py`、`atom/voice.py`、`atom/deploy/` | 同源、权限、凭据隔离；不要顺手重启图形服务 |
| 桌面与系统工具 | `atom/static/` | 大图标分页、滚轮/拖动、五向输入、Home、全屏切换 |
| 官方视觉规范 | `atom/design/device-ui.css` | 统一设计源；修改后重新构建客户端，不只改生成副本 |
| 日用/创作客户端 | `atom/notes-app/`、`market-app/`、`computer-app/`、`library-app/` | 业务源码、私有数据的受控桥、完整安装包 |
| 官方作品与同步应用 | `atom/official/` | 今日、相册、音乐、点阵、天气及生活探索应用 |
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

上述构建只向明确采用共享布局的客户端复制 `device-ui.css`，不会向独立场景应用插入未打包的样式引用。生成包位于 `atom/examples/` 和各官方作品的 `bundle.json`。不要只改 bundle JSON；它会在下次构建被源码覆盖。对特殊上游移植，按各目录的 README/build 脚本操作；`atom/vendor/` 为本地构建缓存，不进入仓库，安装资源在各移植目录中随包保留。

## 本地回归

```sh
# 在独立虚拟环境安装；相册测试需要真实 HEIF 编解码依赖
python3 -m pip install -r atom/connect/server/requirements.txt cryptography
python3 -m unittest discover -s atom/tests
python3 -m unittest discover -s atom/connect/relay -p 'test_*.py'
python3 -m unittest discover -s atom/connect/marketplace -p 'test_*.py'
node --test atom/connect/computer/test/*.test.mjs
node atom/tests/app-host.test.cjs
node atom/tests/app-runtime.test.cjs
npm --prefix atom ci
cd atom
npx playwright install chromium webkit
npm run test:ui
npm run test:community
node ports/navigation-ui.test.cjs
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

首次安装普通应用使用 `install`，已安装时使用 `update`。CLI 会自动让受保护的官方客户端走审核更新接口。完成更新后刷新桌面；校验图标、位置、退出返回页、存储、音频和后台暂停行为。禁止把开发 Mac 的整套空 `apps/`、`state/` 覆盖到样机。修改服务或启动脚本前核对可恢复备份；云端遵守本地/OSS 各三份上限，不为每次代码修改重复创建备份或快照。

电脑伴侣、中继、市场和配对的启动命令见 [Connect 部署指南](../connect/README.md) 与 [市场说明](../connect/marketplace/README.md)。默认云端已上线；本地联调仍不能替代公网验收。自行托管参照服务器指南配置 HTTPS、备份、限流与账号运营。

## 必须遵守的产品规则

- 全屏应用，不保留系统常驻栏；普通操作页固定一屏，只有长列表、正文、源码、结果等必要内容区可滚动，右侧滚动条隐藏。不能用 `overflow:hidden` 把无法操作的内容藏掉。
- 统一主题令牌和字体层级；颜色、按钮主次、内容留白形成整体。音轨、场景、科学数据的颜色有实际意义，应保留。当前系统主题的强制控件样式要通过真机检查，单独浏览器预览不足以发现覆盖问题。
- 每应用独立 `icon.svg`，64×64、透明、单色 `currentColor`，遵循 [AGENTS.md](../../AGENTS.md)。更新保留用户已有合法图标。
- AtomApp v1 做持久化；只有保存确认后才报告成功。失败读取不覆盖旧数据，64 KiB 限额，退出释放音频/GPU/计时器。
- 新应用追加，更新保留位置。退出回打开时的桌面页，Home 在桌面回第一页；方向移动焦点，短按 Space 确认、长按语音，松手结束录音。方向输入隐藏鼠标，鼠标移动/点击恢复。新建/更新/发布必须遵守 [五向规范](input-standard.md)。
- 公共安装资源不携带模型密钥。配对状态、市场账号令牌、工作区和真实个人记录不提交。配置通过文档示例和各自的本地设置复现。

## Git 协作建议

每人建立自己的 `codex/功能名` 或团队约定分支，通过 Pull Request 合并。改动说明包含「解决的问题、真机截图或录屏、实际跑过的测试、剩余限制」。三端接口变更先商定契约；不同人尽量分目录工作，共同修改 `server.py`、`static/app.js` 时先协调。

提交前检查 `git diff --stat` 与 `git diff --cached`。不提交 `atom/apps/`、`atom/state/`、`.env`、本机安装包、数据库、备份或第三方构建缓存。第三方素材与代码保留原许可证；根项目说明不替代各上游授权。

## 工作树与文档维护

一个工作树是同一 Git 仓库的独立检出目录，使用自己的分支和工作文件；提交对象和远端共享，未提交修改不会自动同步。每人/每项任务使用独立分支，先提交再通过 PR 或明确的 cherry-pick 集成，避免两人同时改同一目录。不要复制私人 state 或强制推送覆盖伙伴提交。

当前版本与待验收统一写入 [研发基线](current-status.md)，长期规则写入对应协议；不要再复制一份 README 或用旧阶段计划指导部署。文档修改先检查本地链接和 git diff --check，代码改动按实际影响运行测试。


## 正式应用交付顺序

以上直接安装命令用于开发调试。正式交付必须先发布云端应用市场，再由 Mac 与小电脑的市场客户端下载同一不可变版本；不能只复制到真机就报告多端同步。发布步骤、校验工具、旧开发包来源迁移与分端验收见 [应用发布与多端分发](app-distribution.md)。
