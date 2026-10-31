# 应用发布与多端分发

正式交付顺序：**源码开发与测试 → 云端市场发布不可变版本 → 验证公开下载 → Mac 与设备市场读取同一版本 → 用户安装或更新 → 核对安装来源**。

GitHub 保存开发源码；云端应用市场保存用户可获取的作品、版本、完整源码包和封面。推送 GitHub、复制文件到样机、重建 Mac 安装包，都不单独代表市场发布完成。开发阶段可以直接安装测试包，但必须标为开发态，正式交付前回到以上流程。

## 发布步骤

1. 根据来源目录重新构建完整 bundle，包含图标、样式、脚本、许可及所需资源。按应用契约检查生命周期、五向输入、账号加载与返回；检查不含密钥和个人数据。首页封面必须来自真实空白或演示界面的截图。
2. 官方作品由维护者更新云端当前服务实际读取的 official 源目录、catalog 与封面，产生新版本。普通用户在 **ATOM Connect → 我的创作 → 首页截图 → 发布** 操作；未发布草稿保持私有，不能因“云端优先”自动公开用户作品。
3. 以公开市场 API 确认 work ID、最新 version ID、SHA-256、可下载完整包和封面。不要修改既有版本；源码变化应产生新的不可变版本。
4. Mac 的发现页和小电脑应用市场都读取云端目录。测试两端实际接口的返回值，而非只检查仓库 catalog。应用安装/更新必须下载已选 version ID 对应的包；记录 `ATOM-SOURCE.json`，后续更新继续绑定原 work ID。
5. 安装新应用需要用户操作；更新不能静默覆盖用户自己的修改、同名不同来源应用或个人数据。新安装追加桌面，更新保留位置及存档。显示“已上架”“可更新”“已安装”应分别对应真实状态。
6. 分别报告云端发布、Mac 可见/下载、真机安装的完成情况。Mac 内嵌系统工具和运行时属于客户端发行范围，市场上架不会自动替换它们；必要时另行升级客户端并验收。传感器、原生桥等能力有版本依赖时，先提供兼容运行时；没有硬件的预览保留手动玩法，不冒充硬件支持。

## 发布校验

```sh
python3 atom/tools/verify_market_release.py atom/official/focus-garden/bundle.json
python3 atom/tools/verify_market_release.py path/to/bundle.json --work-id COMMUNITY_WORK_ID
python3 -m unittest discover -s atom/tests -p test_market_release.py
```

工具只读公开接口，不登录、不上传、不安装。它拒绝尚未发布、云端落后于待交付源码、摘要不一致、作品归属不匹配和缺失封面的版本。成功只说明云端版本正确；不能替代 Mac/真机交互验收。

本地完整资源库及官网静态目录是发现/兼容资源补充，不能冒充正式版本。使用 `sync_full_library.sh` 时保留完整资源与真实兼容标记；正式作品以市场 works/versions 为准。

## 从开发安装迁移到市场来源

历史开发包没有来源记录时，市场更新应拒绝直接覆盖。维护者可在一次性迁移中，先将本机全部执行资源与公开版本逐项核对，使用设备现有规则规范化 manifest 和主题图标；遇到不同代码、额外文件或其他来源记录立即停止。仅完全匹配的开发包可登记对应公开版本，然后通过正常市场安装接口更新，检查安装时间与用户数据未变。不能仅凭相同应用名或 ID 伪造来源。

## 云端部署路径

部署前解析 `/opt/atom/connect/marketplace/service.py` 的真实路径。市场默认种子目录按其真实文件所在 release 计算；`/opt/atom/official` 的软链接可能仍指向旧 release，不能据此宣称发布成功。修改前核对实际 release 与文件摘要，保留其他开发者的后端改动；发布后必须走公网接口验收。不要为应用发布创建云盘快照或重复数据库备份。

## 2026-10-31 补齐记录

本轮四项公开发布如下，均带首页封面，完整源码与提交 `c1e0ac5` 中的对应 bundle 一致：

| 应用 | 云端作品 | 最新版本 |
| --- | --- | --- |
| Agent 小屋 | official-agent-studio | official-867faed2e3cb63364b175c4f497478fe |
| 相册（感知相框） | official-photo-album | official-01511ac633599a99d930005cbaa3ac05 |
| 专注花园 | official-focus-garden | official-7f6d24d04d9ccbc1ad21c979b45e6c35 |
| 音乐物理沙盒 | official-motion-music | official-c7bce2f96c432730ccec04a34da5e879 |

- 云端：正式 works/versions 可访问，已验证完整包摘要和封面；保留原有社区服务代码。
- Mac：运行中的 ATOM Connect 本地 `/api/studio/catalog` 和 `/api/studio/versions/…` 已读取以上四项并核对源码摘要；本轮没有重新打包 Mac，内嵌相册的界面升级不在此项验证内。
- 灰色板：实际 `/api/market/catalog` 与 Mac 指向同一版本。已核对四个开发包与公开源码一致（manifest 与 SVG 使用设备规范化规则），登记来源后调用正常 `/api/market/install` 完成四项更新；`_installed_at_ns` 未变。
- 尚未声称完成：真实传感器联动、长期性能验收及所有客户端内嵌应用的动态版本切换。
