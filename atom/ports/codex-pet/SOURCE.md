# 来源与迁移边界

迁移对象：用户提供的 `huangshan-pi-sf32-dev/codex-pet-companion`，以及相邻
`scripts/codex_pet_hook.py`、`codex_pet_monitor.py`、`petdex_state_contract.json`。
本实现重写为 ATOM Web 应用及 Python 标准库接收器，沿用九态动画行顺序和 Hook 状态语义。
原 SF32 固件、Lua、BLE 配对、RGB、VBPC RGB565A 解码和 macOS 辅助功能审批不在 Debian 上运行。
SubagentStop 只表示子任务返回，不将整个父任务标为完成。

宠物取自原项目配置的 Petdex：Boba / Boxcat（railly）、Shinchan（adamholter）。
各项来源地址与原始图 SHA-256 位于 pets.js；从公开原图截取前九行、缩小并压缩为 WebP，
保留透明背景、所有非空帧、120ms 动画间隔。方向观察的后两行不属于本应用九态动作。

- https://petdex.dev/pets/boba
- https://petdex.dev/pets/boxcat
- https://petdex.dev/pets/shinchan

Petdex 声明这些是用户提交的 fan art，不主张底层角色 IP。未发现本次三张图片的独立
商业再分发授权；本移植保留原作者和来源，不将图片重新标为本仓库 MIT，未自动公开到市场。
公开/商业分发前需核实各图片及角色授权，或替换为自有素材。

没有读取 Codex 数据库、对话日志或模型凭据；只接收用户主动配置的 Hook 元数据。
SSH 身份和授权由用户现有配置提供，应用包不包含 SSH 密钥、账号令牌、项目完整路径和提示词。
