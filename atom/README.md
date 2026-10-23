# ATOM 设备系统源码

本目录包含 Debian 小电脑系统、应用、ATOM Connect 和云端服务。产品介绍、当前版本、快速启动与代码地图统一维护在[仓库首页](../README.md)，避免两份总览产生冲突。

- [当前研发基线与待验收](docs/current-status.md)
- [完整开发文档索引](docs/README.md)
- [团队协作与本地测试](docs/collaboration.md)
- [应用开发](docs/developer-guide.md) · [运行协议](docs/app-contract.md) · [五向输入强制规范](docs/input-standard.md)
- [样机部署](docs/deployment.md) · [Connect 与配对](connect/README.md) · [服务器运维](connect/server/README.md)
- [源码库完整同步](docs/full-library-sync-2026-10-23.md) · [上游来源与许可](ports/README.md)

在仓库根目录运行 `python3 atom/server.py`，打开 `http://127.0.0.1:8770`。需要预装仓库应用时运行 `python3 atom/tools/simulator.py --offline`；模拟器使用独立数据目录及 8790 端口。

设备实机的 `apps/`、`state/` 与凭据不属于源码，不应被开发机空目录覆盖。开发和发布须遵守根目录 [AGENTS.md](../AGENTS.md)。
