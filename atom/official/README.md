# ATOM 原创官方作品

这五个作品使用原生 Canvas/HTML/CSS 与 AtomApp v1，无外链、无模型密钥、无复制的第三方素材。每个目录含完整源码、独立 currentColor 图标、MIT 许可（前三个作品另附 `SOURCE.md`），`bundle.json` 是完整可安装/发布快照。

- **云朵伙伴 official-companion**：平滑视线追踪、自然眨眼、轻点回应、粒子与三种心情；遵守减少动态效果，表情偏好可保存。
- **像素实验室 pixel-lab**：80×44 点阵上的真实生命规则、重力沙粒、衰减涟漪。可绘制、添加种子、暂停、清空及撤销五步。没有将预录动画当模拟。
- **任务伙伴 task-pal**：只读系统 `atom:task-state` 状态，呈现实际电脑任务与审批、失败、完成。未连接或断网明确显示，没有假任务、假百分比或假进度。通过「我的电脑」发起和审批。

- **今日 today**：与电脑工作台共享真实日程和待办；离线 pending 持久保存、重连同步、冲突显式保留两份，账号数据隔离。
- **声音实验室 sound-lab**：原生 WebAudio 的四轨十六步节拍编排，速度、音量与节拍可保存，暂停与退出释放音频资源。

运行 `python3 atom/official/build.py` 重新生成五个完整 bundle；之后运行 `python3 atom/tools/prepare_icon_bundles.py`。市场服务将扫描这五个 bundle 作为官方公开作品。导入为不可变版本后，源码改变不会偷偷修改已发布版本，应按市场新版本流程发布。

真实 Chrome + 父桥 fixtures 测试在 `atom/market-app/ui.test.cjs`，覆盖表情互动、物理绘制/撤销与诚实任务状态。真机性能与真实服务器集成须由独立验收记录确认。

`node atom/official/clients.test.cjs` 额外覆盖今日的离线重载、重连、冲突原子保存失败保护与账号隔离；声音实验室使用真实 Chrome 原生 WebAudio 验证启动/暂停、快速启动防重入、保存重载、读取失败保护与退出清理。父桥为测试 fixtures，不冒充真实服务器或扬声器听感。

设备客户端构建还包括 `python3 atom/market-app/build.py`（市场/随手记）、`python3 atom/library-app/build.py`（应用库）与 `python3 atom/computer-app/build.py`（我的电脑）。受保护 ID 必须走经审核的 `client-update`，其余普通作品使用标准安装/更新；更新保留安装时间、桌面位置、原有用户图标和来源记录，应用数据位于独立存储，不随资源更新删除。
