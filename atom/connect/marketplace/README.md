# ATOM Studio / Marketplace 服务

这是和 ATOM Connect 中继一起运行的可自托管服务。现有中继启动命令不变；`/market/v1/*` 在电脑/设备令牌认证前挂载，使用独立的用户账号与会话。数据库位于中继数据库旁的 `<relay数据库文件名去扩展名>.marketplace.sqlite3`，权限 0600。仅 Python 3.7+ 标准库。

```sh
python3 atom/connect/relay/server.py --host 127.0.0.1 --port 19441 --db /private/path/relay.sqlite3
python3 -m unittest discover -s atom/connect/marketplace -p 'test_*.py' -v
```

`GET /market/v1/health` 返回 `{ok:true}`。生产部署仍需有效 HTTPS、非特权系统用户、磁盘配额、备份和边缘限流；仓库没有开通托管云服务。

## 账号与来源

- 注册/登录使用 username/password，用户名 3–32 位 ASCII 字母数字、下划线或连字符（统一小写），密码 12–256 字符。
- 密码 PBKDF2-HMAC-SHA256，310,000 次迭代、每个账号独立随机盐。随机会话 token 仅返回一次，数据库只保存 SHA-256；有效期 30 天，每账号最多 20 个会话。
- 电脑/设备本地代理保存 token，应用 iframe 不能得到 token 或模型密码。模型账号和市场账号是两回事，账号密码不应放进 AI 修改提示词。
- 公开目录与版本源码无需登录；草稿、保存、分叉、发布和个人数据需要 `Authorization: Bearer <market token>`，不接受 Connect 设备令牌替代。
- 不信任浏览器直接调用写接口：服务拒绝带 Origin 的 POST；应经过已认证的设备或电脑本地代理。
- 注册每连接来源每小时 10 次、登录每来源每 10 分钟 30 次，并有按用户名哈希计数的尝试限制。服务不信任转发 IP；反向代理要单独配置边缘限流。限流桶为内存状态，服务重启会清空。

## API

所有写入为 JSON，HTTP body 最大 2 MiB。错误是 `{error,code?}`，修订冲突还包含 `current`，状态 409。详见 [PRODUCT-CONTRACT.md](../PRODUCT-CONTRACT.md)。

| 路径 | 功能 |
| --- | --- |
| POST register / login / logout | 账号注册、登录、退出当前会话 |
| GET me | 当前用户，不返回 token |
| GET catalog?category=&q= | 公开作品目录，最多 200 项；分类 life/companion/sound/play/connect |
| GET works/:id | 作品、不可变版本列表、公开衍生作品 |
| GET versions/:id | 完整源码 bundle、license、author、parent_id/parent_version_id、official 标记 |
| POST forks | 从指定公开 version_id 创建私人草稿，自动分配新的桌面应用 ID |
| GET/POST drafts | 私人草稿列表或新建 |
| GET drafts/:id | 自己的草稿和完整源码；其他账号看不到 |
| POST drafts/:id/save | revision + 完整 bundle，成功后 revision 增加 |
| POST drafts/:id/publish | revision + changelog + confirm:true，公开新版本 |
| GET/POST notes | 自己的便签；支持修订、置顶、软删除与恢复 |
| GET/POST agenda | 自己的日程/待办；支持修订、完成、软删除与恢复 |

`POST /notes` 接受 `{id?,revision?,text,pinned?,deleted?}`；`POST /agenda` 接受 `{id?,revision?,title,kind,starts_at?,done?,deleted?}`。kind 为 `event` 或 `todo`；starts_at 为 ISO 日期时间或空。离线客户端可先创建 URL-safe id，新建 revision 缺省或 0；更新必须匹配当前 revision。更新时遗漏便签 text、日程 starts_at 会保留已有值，避免勾选/删除操作丢失正文或时间。冲突不自动覆盖，客户端需要保留离线副本并明确让用户处理。

## 版本、分叉和发布

源码包必须完整包含 manifest 和 files，最大 1 MiB、100 个文本文件。入口固定 index.html，路径禁止绝对路径、穿越、隐藏文件、URL 和 manifest.json。图标为静态 currentColor、64×64 viewBox SVG，禁止事件/脚本/外部资源。平台不会运行上传的代码、调用任意构建命令或读取客户端提供的服务器路径。

发布需要显式 `confirm:true` 和准确 revision；生成不可变版本编号与 SHA-256（完整紧凑 UTF-8 JSON 快照）。保存私人草稿不会改变已发布版本；发布后的草稿 revision 会增加，再次发布旧 revision 返回冲突。bundle 同时作为源码和安装包保存，不只保留入口 HTML。

分叉固定保留 license、父作品和父版本归属，生成 `fork-<随机ID>` 避免覆盖原作。继承源码中的 LICENSE/COPYING/NOTICE 文件不可删除或改写，父信息不能通过 save 或 publish 请求篡改。版权许可枚举包括 MIT、Apache-2.0、BSD-2-Clause、BSD-3-Clause、CC0-1.0、MPL-2.0、GPL-3.0-only、GPL-3.0-or-later。当前分叉保持父许可，不提供自动重新授权。

发布时做保守的意外密钥扫描（常见 token、private key、明文口令/授权字面量）。它**不能证明内容无秘密、无恶意代码或具备完整商业授权**；作者仍需审核源码与来源。私人草稿允许尚未整理完的源码，但不应放入真实凭据。

## 官方初始作品

启动时读取仓库 `atom/official/*/bundle.json` 和 `atom/official/*.json`，并按 `atom/official/catalog.json` 的相对路径导入额外完整资源包。额外路径必须落在同一应用源码树内。完整快照改变时追加新版本；未改变时不会重复导入。

- official-companion：已退役，目录下架，历史版本和已有派生保持可追溯。
- symbiotic-world、language-alchemy：play。
- ai-duet：sound。
- agent-studio：connect。
- pixel-lab：play。
- task-pal：connect。
- today：life。
- sound-lab：sound。

只有本地 seed 导入能产生 `official:true`；用户作品提交该字段会被忽略。普通草稿禁止 my-computer/market/quick-notes/today/task-pal 等带系统能力的保留 ID。官方 today/task-pal 可以保留原 ID，分叉则获得普通独立 ID，不继承系统私有桥权限。manifest 可保留窄能力声明 capabilities，唯一且最多三个，只接受 notes、agenda、task-state；安装后仍需设备系统首次明确授权，预览不授予，不能声明市场登录、电脑配置或管理员能力。初始作品采用原创 MIT 来源；根服务安装时另外保存可追溯的来源 sidecar。

## 配额与运营边界

当前上限：1,000 用户，每用户 50 草稿、200 便签（含软删除）和 200 日程项，每作品 100 版本、服务总计 10,000 版本。SQLite 主文件最多 65,536 页，默认页大小下约 256 MiB；WAL 有自动 checkpoint 和压缩限制，但不能代替磁盘级硬配额。容量不足时事务回滚，不悄悄删掉历史。

没有邮箱验证、忘记密码、账号合并、内容举报/审核后台、生产多副本共享限流或付费体系。持久化的作品、草稿和便签是服务器可读明文，不是端到端加密。上线前应补齐保留/归档政策、服务运维和安全审核，不把当前本地验证当成正式云端验收。

## 运维命令：备份、健康与目录下架

这些命令是**拥有服务器数据库文件权限的管理员本地操作**，不提供给设备 iframe 或普通用户。请传市场数据库路径，而非 Connect 任务中继数据库。

```sh
python3 atom/connect/marketplace/ops.py --db /private/path/relay.marketplace.sqlite3 health
python3 atom/connect/marketplace/ops.py health --url https://connect.example.com
python3 atom/connect/marketplace/ops.py --db /private/path/relay.marketplace.sqlite3 stats
python3 atom/connect/marketplace/ops.py --db /private/path/relay.marketplace.sqlite3 backup --output /private/backups/market-2026-10-20.sqlite3
```

`backup` 使用 SQLite backup API 取得包括已提交 WAL 内容的一致快照，再执行 quick_check，输出文件为 0600，拒绝覆盖已有文件。备份包含私人源码、便签和会话哈希，仍需离线保护与加密存储。`stats` 仅输出行数、目录可见数量和数据库大小，不输出用户名、作品正文、源码或 token。数据库 `health` 做 quick_check；HTTP health 检查部署可达性，两个检查不能互相替代。

显式从目录下架或恢复同一个作品：

```sh
python3 atom/connect/marketplace/ops.py --db /private/path/relay.marketplace.sqlite3 unlist --work-id WORK_ID --confirm WORK_ID
python3 atom/connect/marketplace/ops.py --db /private/path/relay.marketplace.sqlite3 restore --work-id WORK_ID --confirm WORK_ID
```

必须在 `--confirm` 再输入准确作品 ID。此处 `restore` 只恢复目录展示，**不是还原数据库备份**。下架状态独立持久化：后续发布新版本或重新导入官方 seed 不会自动恢复。目录与公开衍生列表不再展示下架作品，但已有作品链接、不可变版本源码仍可访问，已安装副本不会被删除；这属于 unlist，不是安全撤回或内容删除机制。需要全面法律/安全撤回时，应另设经过审核的访问与保留流程。

恢复数据库备份需在维护窗口停服务，保存现有数据库及 WAL，再由管理员核验并替换正确数据库路径，确认权限后重启。工具故意不提供一键覆盖正在运行数据库的命令。
