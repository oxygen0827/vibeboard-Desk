# 应用库

已安装应用列表与桌面展示分开：可以搜索、打开应用，将应用放到桌面或移出桌面。移出桌面不会卸载应用，也不会删除数据。应用库自身保留在桌面作为入口。

运行 `python3 atom/library-app/build.py` 生成完整 `atom/examples/app-library.json`。此 ID 是受保护的系统客户端，部署使用 `atom/tools/deploy_app.py update atom/examples/app-library.json`，工具自动走经审核的 `/api/connect/client-update`。普通应用安装与市场源码不能覆盖受保护 ID。

构建后运行 `python3 atom/tools/prepare_icon_bundles.py`；更新必须保留安装时间与现有桌面位置。完整发布时同时构建市场/笔记（`atom/market-app/build.py`）、五个官方样例（`atom/official/build.py`）与电脑客户端（`atom/computer-app/build.py`）。
