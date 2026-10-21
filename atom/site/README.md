# ATOM 产品与使用指南网站

无构建依赖的静态网站。首页 `/atom/`，使用手册 `/atom/guide/`，所有资源绝对路径 `/atom/assets/`。不能直接双击文件测试，应按下方 base path 提供 HTTP。

文件：`index.html`、`guide/index.html`、`assets/site.css`、`assets/site.js`、`assets/{today,sound-lab,notes}.png`。截图为本仓库官方应用界面，首页设备外观明确标记为概念示意。

## 部署

将本目录的首页、guide 与 assets 复制到 nginx 可读的静态目录 `static/atom/`。只给首页与静态路径建立静态路由；保持现有 `/atom/v1/`、`/atom/market/v1/` 等中继 API 代理，不能把整个 `/atom/` 都改为静态 try_files fallback。

推荐精确匹配 `/atom` 重定向到 `/atom/`，精确首页 `/atom/`，前缀 `/atom/guide/` 与 `/atom/assets/` 静态，其他请求仍由既有反向代理处理。首页与指南禁用长期缓存；assets 按部署策略短缓存即可。

本网站没有收集账号、配对码、邮箱或模型凭据的表单。账号、配对、安装等操作指向真实设备/电脑客户端，不伪造网页后台。没有公开安装包，获取入口指向源码构建说明。实验体验标记为研发方向，不把尚未验收的能力写成量产功能。

## 本地预览与 QA

仓库根目录运行 `python3 atom/site/preview.py --port 18943`，访问 `http://127.0.0.1:18943/atom/`。

`node atom/site/test.cjs` 会启动自有临时 HTTP 预览，检查桌面/手机宽度、资源与内部锚点、搜索、控制台错误、Reduced Motion。截图保存在临时目录，不写入发布资产。

## 当前公网部署

产品入口：https://ldcx.tech/atom/ ，使用指南：https://ldcx.tech/atom/guide/ 。

从仓库根目录执行 `atom/site/deploy/publish.sh`，使用现有服务器的 SSH 密钥。脚本只发布首页、指南和资源，保留历史静态发布目录以便回退，验证 nginx 配置后重载。nginx 配置原文件按发布时间备份；不修改后端服务、数据库与私有凭据。静态资源通过现有只读挂载 `/static` 提供。

发布后确认首页、指南、资源返回 200，并确认 `/atom/market/v1/health` 仍正常。
