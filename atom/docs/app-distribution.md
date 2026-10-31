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

## 2026-10-31 全端整合与遗漏修复

钢琴在灰色板已经是新采样版，但云端作品仍指向旧合成音源，Mac 发现因此显示旧版。另有今日、共生世界的正式版本滞后，Mac 种子中的相册、Agent 小屋等资源未随源码更新。仅更新一个安装目录不能证明多端一致。

本次交付：

- 云端三项新不可变版本：钢琴 `official-fca148e47d78e43b4c3d7c5d778794fa`、今日 `official-fa711bacfe8cc0f0d7da0e82513deca4`、共生世界 `official-20b44824c3103915b3c3bc32939a088d`。全部 25 个官方作品下载内容与审阅源码一致，封面可读。
- 完整资源目录由 62 项补齐至 64 项，64 个 ZIP 在服务器逐包验证摘要、路径与文件数；所有应用都有真实首页封面。Mac/官网/设备使用同一目录，普通公开作品与兼容资源仍分别标识。
- 官网静态目录更新为 67 个入口（64 个资源应用及 3 个系统入口），修正旧钢琴说明、截图、旧分支源码链接和旧 ZIP 地址；另从市场读取公开社区作品。目录浏览器回归及公网下载可达性通过。
- 从灰色板收回 14 个既有应用的五向操作、逐级返回和场景暂停代码。保留上游资源、图标和许可，没有将设备账号、模型密钥、存档或私人应用带入仓库。
- Mac 内置 64 项、运行中模拟器 64 项的运行资源与严格构建种子一致；内嵌相册同步更新。修改前确认模拟器资源匹配原种子，未覆盖私人修改；签名校验通过。客户端版本仍为 0.6.4 定向资源更新。
- 灰色板已安装 47 项运行资源核对一致；17 项未安装，继续保持未安装。钢琴先逐文件核对已存在开发包与正式版本相同，再登记来源，随后与今日、共生世界一起走正常市场更新接口；三项版本回读一致且安装时间不变。市场系统客户端从已校验云端完整包更新。
- 修复共享布局构建误改独立场景应用、ZIP 发布器不接受 JPEG 封面和中途重试的问题；QA 报告不再混入模拟器运行资源。没有创建云盘快照或新数据库备份，没有重启设备显示服务或推进核心 OTA。

[脱敏分端校验结果](../artifacts/distribution-20261031/verification.json)只证明源码/运行资源一致，不能替代实体摇杆、扬声器、性能及全部功能验收。保留合法主题图标；非运行说明文件差异另列，不将它们误判为代码降级。

### 后续必须执行的发布检查

先构建并发布官方作品、完整资源目录，再更新客户端。使用新生成的种子作为唯一对照，不能复用旧安装包做“最新”基线：

```sh
python3 atom/tools/simulator.py --build-seed /absolute/build/seed --strict-seed
python3 atom/tools/build_full_library.py --seed /absolute/build/seed --out /absolute/build/public \
  --index atom/official/library-index.json
python3 atom/site/build_apps.py
# 按上文发布作品/资源。设备 inventory 使用同一工具 --inventory --seed <apps> 只读导出。
python3 atom/tools/audit_app_distribution.py --require-all \
  --seed /absolute/build/seed \
  --library /absolute/build/public/catalog.json \
  --mac-seed '/absolute/ATOM Connect.app/Contents/Resources/device/seed-apps' \
  --installed '/absolute/ATOMConnect/simulator/apps' \
  --device-inventory /absolute/build/device-inventory.json \
  --output /absolute/build/distribution-check.json
```

`--require-all` 缺少任何端的证据就失败；源码与云端不同、资源目录摘要不同、内置包遗漏或已安装运行资源过期也失败。离线时必须保留为待验证，不能改成通过。设备清单须本次从真实设备读取；工具不会根据旧报告推断当前在线状态。

此工具只读，不自动发布用户作品、不自动升级或覆盖分支。任何应用交付都要留上述结果，再分别检查 Mac 实际发现详情、设备安装回执及交互。CI 运行静态和隔离浏览器回归；真实部署验收在有访问条件的交付环境执行。

完整库构建时同时更新仓库的 `library-index.json`，官网目录重新生成后发布，避免网站还提供已经被回收的旧 ZIP 链接。`sync_full_library.sh` 已包含本地索引和官网目录重建；它不会替用户提交代码或自动部署整站。

### 本轮验证范围

- 设备 Python：198 项，其中 187 通过、11 项因 macOS 缺少 Debian DBus/GLib 环境跳过；市场 60 项、relay 25 项、Mac/运行时 Node 73 项通过。
- 随后补充分发索引的旧下载链接回归，分发检查 4 项通过；官网目录在 4 种视口完成筛选、详情、ZIP/源码下载与失败重试检查。
- Chromium/WebKit：发现、创作、完整资源交互预览、主题、身份延迟及私有同步故障恢复通过。设备应用、五向输入、同步入口、场景返回与暂停回归通过。
- 正在运行的 Mac 服务实际读取新钢琴；WebKit 验证 5 首曲谱与 32 个解码采样。另有五首自动演奏、鼠标滑奏和离线音频回归。
- 本记录不把浏览器测试等同于实体扬声器听感、摇杆或连续运行性能验收；核心系统 OTA 版本未因应用资源更新而变更。
