# 像素办公室（agent-office）

普通用户请看 [使用说明](使用说明.md)。

四名原创像素员工组成的综合助理小队。用户下达目标 → 协调员拟定分工（真实模型调用）→ 用户确认 → 员工回工位执行真实 Connect 任务 → 完成后走到老板面前汇报。

实现参考 DeskRPG 的交互机制，代码、地图、人物全部独立绘制（`office-art.js` 逐像素生成），不含其代码、素材或品牌。

## 结构

| 模块 | 职责 | 禁止 |
|---|---|---|
| `office-map.js` | 30×22 网格、家具占位、交互点、BFS 寻路 | I/O |
| `office-art.js` | 原创像素绘制：地图、人物、状态气泡 | 读取任务 |
| `office-domain.js` | 存档校验、提示词、严格分工解析、工作包状态、员工活动投影 | DOM、时钟、网络 |
| `office-runner.js` | 方案 → 确认 → 工作包 → 综合报告；请求 ID 先落盘再发送 | 绘制 |
| `office-client.js` | `host`：系统 `atom:office` 能力桥；`demo`：标注“演示”的模拟器 | — |
| `office-scene.js` | 走位、汇报排队预约、空闲小动作（20–45 秒一次）、减少动态 | 创建/修改任务 |
| `office-render.js` | 240×180 低分辨率 Canvas，静态地图预渲染，按纵向遮挡 | 读时钟/任务 |
| `office-ui.js` | 生命周期、确认式保存、轮询节奏、DOM 与返回栈 | — |

## 设备能力 `office-control`

清单声明 `capabilities:["office-control"]`。系统外壳（`atom/tools/patch_office_shell.py` 加入 `static/app.js` 与 `server.py`）：

- 首次使用弹出授权，按安装实例记录；预览不获得权限。
- 只代理 `state / create-task / task-events / cancel-task / approve-task`，复用现有配对与端到端加密。
- 请求 ID 加私有前缀；任务归属记录在外壳，只能查看、审批、取消本应用创建的任务。
- 不向 iframe 传令牌、本地路径或其它任务。

## 当前边界（如实）

- **顺序执行**：Mac 端 `companion.mjs` 目前同时只运行一个任务，工作包按依赖顺序逐个执行。三路并行需要改造 Mac 伴侣并重新打包。演示模式会模拟并行，并标注“演示”。
- **不应用文件改动**：工作包提示要求只以文本交付；没有隔离工作目录和“应用成果”服务。可写项目中 Codex 仍可能请求改文件，审批卡会照实显示。
- 编排在设备应用内进行：退出应用后，已派出的任务继续在电脑执行；后续工作包在下次打开时继续派发。
- 中继无需改动；`/v1/office/*` 协议未实现。云端市场 `service.py` 尚未加入 `office-control`，发布到市场前需同步。

## 验证

```sh
node atom/official/agent-office/office.test.cjs
node atom/official/agent-office/ui.integration.cjs [截图目录]   # opaque iframe 480×360：演示流程、五向可达、首次授权超时自恢复
python3 atom/official/agent-office/build.py
python3 atom/tools/check_app.py atom/official/agent-office/bundle.json
sh atom/tools/deploy_office.sh   # 部署到灰色小电脑（备份 → 打补丁 → 仅重启后端与浏览器 → 安装/更新）
```

## 灰色小电脑部署记录 · 2026-10-31

- `taishan-gray`（核心 2026.10.23.2）已打 `office-control` 外壳补丁并安装本应用；补丁前备份为 `static/app.js.before-office-20261031-152145`、`server.py.before-office-20261031-152145`。未改动 `state/`、未重启 LightDM。
- 真机五向验证通过：桌面打开、授权弹窗（默认“暂不允许”）、办公室先渲染后检查连接、选择电脑/项目/执行器并保存、派任务输入、Esc 退出回到打开时的桌面页。该桌面按使用频率排序，图标位置会随打开次数变化。
- 真机发现并已修复：首次授权停留超过 9 秒误报“需升级系统”（现自动重试）；设置页两列布局与固定底栏导致电脑选项五向不可达（改为单列、操作按钮随内容滚动）；选择电脑后焦点丢失；对话框程序化聚焦未同步五向光标（改用 `AtomInput.focus`）。均有 `ui.integration.cjs` 回归。
- 「开发用 Mac」的 Codex 进程反复“Agent 连接中断”（直接经设备 Connect 接口发的诊断任务同样失败），与本应用无关，未复验。
- **真实闭环已在「拍照测试 Mac」跑通**：经用户同意新建隔离目录 `~/ATOM-office-test`（两份测试资料），以**只读**方式授权为「办公室联调项目」。在灰色小电脑上仅用五向键：选择该电脑 → 派任务“阅读资料A和资料B两份文档，比较它们的结论，并写一份简短说明” → 协调员真实调用 Codex 拟定分工（简单任务只派给小研）→ 确认开工 → 小研回工位执行（界面依次显示排队/执行中）→ 完成后走到老板身边、汇报未读 1 → 阅读成果。成果含对比、依据，并如实写明“未进行外部文献核验”。单工作包按设计不额外生成协调员汇总；三路并行、隔离成果与“应用成果”仍未实现（见上文边界）。
- 真机复验又修复：汇报正文五向无法滚动（改为按段落可聚焦，Down 逐段前进并滚动，渲染标题/列表/加粗）；汇报列表打开时焦点停在返回键；分工说明句号重复；Codex 在汇报里写出电脑绝对路径（提示词改为只写项目内相对路径，显示时链接只保留文字）。
