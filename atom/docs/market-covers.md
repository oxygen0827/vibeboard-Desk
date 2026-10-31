# 应用市场：首页截图封面

官网应用目录、ATOM Connect「发现」及小电脑「应用市场」使用应用截图作卡片背景。桌面继续使用各应用独立、跟随主题的 SVG 图标，截图不替代图标。

## 用户流程

1. 在电脑端打开 **我的创作**，进入应用草稿。
2. 点击 **首页截图**，或打开 **发布** 窗口中的同名区域。
3. 上传 PNG、JPEG 或 WebP，单文件最多 20 MiB / 6400 万像素。推荐 4:3 横图；预览展示所选截图。不同屏幕上的卡片可能裁切边缘，建议主要内容放在中央。浏览器优化至最多 1280×960，再发给服务器校验和重新编码。
4. 看到“封面已保存到私有草稿”才算保存成功。上传失败或修订冲突保留旧封面。
5. 检查截图和源码不含私人内容，确认发布。当前客户端缺少封面时会提示上传，不会直接发布。

设备工作坊生成完成、安装完成，以及电脑 AI 改造完成后会提示此入口。当前设备工作坊仍是本机生成/安装流程；它不会自动把应用、截图或用户数据上传到市场。

## 数据和接口

- `covers` 表保存独立 JPEG BLOB、原始尺寸、所有者及公开标记，包含在既有 SQLite 一致性备份中。原文件和 EXIF 不保留；不调用生图模型，也不读取私有相册。
- `POST /market/v1/drafts/:id/cover`：携带账号、当前 `revision` 以及优化后的图片 `image` data URL。仅草稿所有者可修改，成功增加修订号。
- `GET /market/v1/covers/:id`：返回 JPEG data URL。公开封面可匿名读；未发布封面仅所属账号可读。
- 草稿、作品和新发布的版本使用 `cover_id`。发布才将封面公开；替换草稿封面不立即改变市场卡片。已发布源码版本不因封面变更而修改。
- 上传原始请求内图片最多 1 MiB，服务端规范化结果最多 512 KiB；客户端先优化，因此不需要放大 nginx 的普通请求上限。每账号封面总量 8 MiB，服务器总量 32 MiB。
- 当前客户端发布时传 `require_cover: true`。为兼容旧客户端，旧协议仍可发布无封面作品；界面保留无封面的回退状态，不能用伪造截图代替。
- 电脑宿主代理持有账号凭据；小电脑通过受限 `cover` bridge 读取公开图片。应用 iframe 不接触市场 token。各端按可见卡片加载图片，目录本身不携带大量 Base64 图片。

## 现有封面和维护

10 个官方作品的封面种子位于 `../official/covers/`，来源记录在 `sources.json`；启动时更新展示元数据，不创建虚假的源码版本。`prepare_market_covers.py` 从已审查官网截图制作种子。官网静态收录的 35 项均有截图，另有 2 个云端公开作品由其公开源码在禁止联网的沙箱中渲染后补齐。

`../artifacts/market-covers/` 内新增截图来自实际 UI。相册、便签、今日采用空白演示账号；连接页为空配置，材料世界为空画布。它们不声称是用户当前数据或真机截图。其余已有截图沿用官网的来源记录。

管理员可对没有封面的历史公开作品进行一次审查后的补录：

```sh
python3 atom/connect/marketplace/ops.py --db /path/to/marketplace.sqlite3 cover \
  --work-id WORK_ID --confirm WORK_ID --image reviewed.png
```

此命令不会覆盖已有封面，也不修改作者、许可、源码或历史版本。封面素材与源码的授权分别检查，天气摄影的素材声明继续保留。

## 验证与部署

```sh
python3 -m unittest discover -s atom/connect/marketplace -p 'test_covers.py'
node --test atom/connect/computer/test/studio.test.mjs
node atom/connect/computer/cover-ui.test.cjs
node atom/market-app/ui.test.cjs
node atom/site/apps.test.cjs
```

Python 图片测试和准备工具需要 Pillow。浏览器截图工具使用隔离的空白/演示状态，不应改成连接用户账号自动截图。`capture_market_screens.cjs` 可通过 `ATOM_IMAGE_PYTHON` 指定带 Pillow 的 Python。

2026-10-21：云端 12 个公开作品均可匿名读取封面，官网 37 项卡片可展示截图；Mac 包已更新并验证实际市场页面。小电脑远程入口仍拒绝连接，因此 `market_client.py`、`static/app.js` 与完整 `examples/market.json` 尚未部署到真机。真机恢复后需保留应用位置、安装时间及有效图标，更新市场并检查 Home 返回行为。验收记录见 `../artifacts/market-covers/verification.json`。

## 共享创作入口（2026-10-31）

Mac 和设备的「我的 → 作品 → 分享作品」均支持真实首页截图上传，上传完成仅保存到私人草稿，点击公开发布后才进入公共目录。Mac 高级工作台「我的创作 → 首页截图」继续可用。详情见 [创作与社区计划](creation-community-plan.md)。
