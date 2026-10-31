# ATOM 开发文档

更新：2026-10-31。当前状态、长期契约和专项实测分开维护；旧计划及重复交付日志已合并，不再作为操作指南。

## 开始开发

| 阅读目的 | 文档 |
| --- | --- |
| 产品、快速启动、代码地图 | [仓库首页](../../README.md) |
| 当前版本、部署范围、待验收 | [研发基线](current-status.md) |
| 核心代码审阅、失败恢复与回归结果 | [2026-10-31 审阅记录](code-review-2026-10-31.md) |
| 分支协作、构建与测试 | [协作开发](collaboration.md) |
| 创建、安装和更新应用 | [开发指南](developer-guide.md) |
| 产品定位 | [定位说明](product-positioning.md) |

## 应用强制契约

| 内容 | 文档 |
| --- | --- |
| 五向输入与共享动画 | [强制规范 v1](input-standard.md)、[实现方案](five-way-navigation.md) |
| 生命周期、存档、暂停 | [AtomApp 协议](app-contract.md) |
| 布局、主题、控件与图标 | [设计规范](design-system.md)、[系统外观](system-appearance.md) |
| 发布截图封面 | [封面规范](market-covers.md) |
| 生成与模型配置 | [工作坊与主题](workshop-and-themes.md)、[工作坊 API](workshop-api.md)、[生成校验](generation-validation.md) |
| 感知应用与可选硬件 | [开发计划](sensor-experiences-plan.md)、[共享传感器接口](sensors.md) |
| 本地设备接口 | [API](api.md) |

## 三端部署与维护

| 内容 | 文档 |
| --- | --- |
| Debian 启动、日志与恢复 | [样机部署](deployment.md) |
| 升级、数据恢复、Mac 发行 | [系统维护](system-maintenance.md) |
| 连接电脑、配对和 Agent | [Connect 指南](../connect/README.md)、[三端产品契约](../connect/PRODUCT-CONTRACT.md)、[通信协议](../connect/PROTOCOL.md) |
| 云端、备份与成本限制 | [服务器运维](../connect/server/README.md) |
| 完整源码库同步与验收 | [全量同步](full-library-sync-2026-10-23.md) |
| 官网与应用目录 | [网站构建发布](../site/README.md) |
| 应用市场与 Studio | [市场服务](../connect/marketplace/README.md)、[Studio 专项记录](studio-delivery.md) |
| 普通用户创作、安装、分享与贡献 | [社区实施计划、操作路径和验收](creation-community-plan.md) |

## 硬件与专项资料

- [硬件能力](hardware-capabilities.md)、[GPU 接入](gpu-enablement.md)、[音频诊断](audio-diagnostics.md)、[智谱语音](voice-zhipu.md)、[蓝牙配对](bluetooth-pairing.md)。
- [显示与八小时运行验收](display-endurance-2026-10-22.md)。
- [灰色板迁移记录](gray-migration.md)：历史迁移与恢复线索，当前版本以研发基线为准。
- [应用上游与许可](../ports/README.md)、[官方应用](../official/README.md)、[生活应用](life-apps-delivery-2026-10-23.md)、[探索应用](oracle-apps-2026-10-23.md)、[点阵](dot-waves.md)、[复杂移植](sandbox-extras.md)。
- [设计研究](design-research.md)、[官方 UI 专项记录](official-ui-refresh.md)、[AI 原生体验](../experiences/README.md)。

阶段记录保留其测量环境，不代表最新版本全部回归通过。更早文档通过 Git 历史查阅；不恢复失效操作说明作为当前规范。上游许可证、源码说明与真实测试证据继续保留。
