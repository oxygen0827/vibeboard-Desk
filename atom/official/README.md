# ATOM 原创官方作品

本目录保留早期五个作品源码，当前上架其中三个；云朵伙伴已退役，任务伙伴已并入 Agent 小屋。早期作品使用原生 Canvas/HTML/CSS 与 AtomApp v1。新增天气应用使用带署名的摄影及外部天气 API，相册使用云端服务；各目录说明其联网和素材边界，全部源码包不含模型密钥。每个目录含完整源码、独立 currentColor 图标、MIT 许可（前三个作品另附 `SOURCE.md`），`bundle.json` 是完整可安装/发布快照。

- **云朵伙伴 official-companion（已退役）**：平滑视线追踪、自然眨眼、轻点回应、粒子与三种心情；遵守减少动态效果，表情偏好可保存。
- **像素实验室 pixel-lab**：80×44 点阵上的真实生命规则、重力沙粒、衰减涟漪。可绘制、添加种子、暂停、清空及撤销五步。没有将预录动画当模拟。
- **任务伙伴 task-pal（已整合至 Agent 小屋）**：只读系统 `atom:task-state` 状态，呈现实际电脑任务与审批、失败、完成。未连接或断网明确显示，没有假任务、假百分比或假进度。通过「我的电脑」发起和审批。

- **今日 today**：与电脑工作台共享真实日程和待办；离线 pending 持久保存、重连同步、冲突显式保留两份，账号数据隔离。
- **相册 photo-album**：照片导入、账号私有云端同步、收藏、全屏轮播、文字生图与照片风格改写。[构建、使用和边界](photo-album/README.md)。新增资源单独运行 `python3 atom/official/photo-album/build.py`，同时更新电脑端嵌入资源。
- **天气之窗 weather-window**：七种内置实拍场景、手选城市与 Open-Meteo 天气；摄影独立许可，原型 API 的商用边界见 [说明](weather-window/README.md)。
- **掌心节拍 clap-stage**：本机 WebAudio 节拍器、点按定速与需明确开启的拍手定速；退出停止声音及收音。[说明](clap-stage/README.md)。
- **声音实验室 sound-lab**：原生 WebAudio 的四轨十六步节拍编排，速度、音量与节拍可保存，暂停与退出释放音频资源。

运行 `python3 atom/official/build.py` 重新生成五个完整 bundle；之后运行 `python3 atom/tools/prepare_icon_bundles.py`。市场服务按 `catalog.json` 导入：跳过退役的云朵伙伴和任务伙伴，并从 `../experiences/` 加入共生世界、语言炼金、合奏伙伴、Agent 小屋。电脑与设备端读取同一目录。导入为不可变版本后，源码改变不会偷偷修改已发布版本，应按市场新版本流程发布。

真实 Chrome + 父桥 fixtures 测试在 `atom/market-app/ui.test.cjs`，覆盖表情互动、物理绘制/撤销与诚实任务状态。真机性能与真实服务器集成须由独立验收记录确认。

`node atom/official/clients.test.cjs` 额外覆盖今日的离线重载、重连、冲突原子保存失败保护与账号隔离；声音实验室使用真实 Chrome 原生 WebAudio 验证启动/暂停、快速启动防重入、保存重载、读取失败保护与退出清理。父桥为测试 fixtures，不冒充真实服务器或扬声器听感。

设备客户端构建还包括 `python3 atom/market-app/build.py`（市场/随手记）与 `python3 atom/computer-app/build.py`（我的电脑）。受保护 ID 必须走经审核的 `client-update`，其余普通作品使用标准安装/更新；更新保留安装时间、桌面位置、原有用户图标和来源记录，应用数据位于独立存储，不随资源更新删除。

## 灰色板作品

新增光子芯片、光子快跑、指尖烟花、迷你钢琴，来自所有者的 GrayOS 原型。已按当前主题、图标、全屏和 AtomApp 生命周期适配；全部离线运行，无需模型服务。完整源码、构建及验证入口见 [gray-ports](gray-ports/README.md)。

## 感知与手持应用（2026-10-31）

- **专注花园 focus-garden**：真实计时、手动确认成长、保存失败保护；存在信号仅建议暂停。
- **音乐物理沙盒 motion-music**：音符／海洋／光容器，鼠标拖抛和五向按钮完整可玩，最长 20 秒旋律录放。
- **Agent 小屋 agent-studio**：保留真实任务，增加房间互动与明确标注的手动演示。
- **感知相框**：在原相册内选择启用；关闭时不采样，未连接不等于无人。

四应用按 [感知计划](../docs/sensor-experiences-plan.md) 验收。硬件型号尚未选定，目前交付手动玩法、共享接口和模拟回归；不可宣称真实 IMU／人体存在传感器已接通。新应用分别运行目录内 build.py；不要用早期五作品构建脚本替代。


正式应用交付遵循 [云端优先分发流程](../docs/app-distribution.md)：先发布带封面的不可变版本，再验证 Mac 与设备端读取、安装同一版本。本地 catalog 或 GitHub 提交不代表云端已经上架。
