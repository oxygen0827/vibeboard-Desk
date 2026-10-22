# ATOM Connect 公网部署（ldcx.tech/atom）

把中继与市场服务（`connect/relay/server.py`，中继使用 Python 标准库，相册使用 Pillow）部署到阿里云 ldcx 主机，经 Docker 内的 nginx 以 `https://ldcx.tech/atom` 对外提供。设备与电脑端的服务器地址都填 `https://ldcx.tech/atom`。

| 项 | 值 |
| --- | --- |
| 代码 | `/opt/atom/releases/<时间戳>`，`/opt/atom/connect`、`/opt/atom/official`、`/opt/atom/experiences` 为指向当前版本的链接，保留最近 3 个版本 |
| 数据 | `/var/lib/atom/relay.sqlite3`、`relay.marketplace.sqlite3`（目录 0700，属 `atom` 系统用户） |

| 监听 | `172.17.0.1:9092`（Docker 网桥网关），只供 nginx 容器经 `host.docker.internal` 访问，不对公网开放 |
| 真实 IP | nginx 写入 `X-Real-IP`；服务只信任来自 `172.17.0.0/16` 的该请求头（`--trusted-proxy`），用于注册/登录/配对限流 |
| 边缘限流 | nginx `limit_req` 每 IP 10 r/s，突发 40 |
| 备份 | 每天主机时间 04:20 做一致性快照，打包上传 OSS 私有前缀，本地保留 3 份 |
| 监控 | 每 5 分钟检查健康、服务、备份、磁盘、证书，异常时发邮件（需 `smtp.env`） |

### 相册与图片生成

相册需要 Pillow；部署前运行 `python3 -m pip install --target /opt/atom/python-deps -r atom/connect/server/requirements.txt`。服务通过 `PYTHONPATH` 加载，依赖目录保持 root 所有且不可被服务写入。

将 `images.env.example` 复制为 `/etc/atom/images.env`，设为 root 所有、0600，填写方舟 API Key、已开通的模型 ID 和可使用该付费服务的 ATOM 账号 ID 白名单。配置修改后重启 `atom-connect`。服务不会把密钥返回给电脑或设备客户端。

**ATOM 官方 AI**：没填自己模型 Key、但登录了 ATOM 账号的设备走服务器的智谱 Key，按账号每月计次，失败不计：工作坊和 AI 体验生成 30 次；机器人对话 300 次；语音（转写和朗读，机器人每句话朗读一次）1500 次。机器人和语音经 `/market/v1/ai/zhipu/*` 流式透传，设备侧代码不变；额度用完时机器人会自己说出来。服务器只存次数，提示词和结果只在内存里等设备取走。用 `ai.env.example` 写 `/etc/atom/ai.env`（root、0600），Key 在终端里输入、不经过聊天记录：

```sh
umask 077; read -s -p "智谱 API Key: " k; echo; printf 'ATOM_AI_ZHIPU_KEY=%s\nATOM_AI_GENERATE_MODEL=glm-4.5-air\nATOM_AI_QUOTA_GENERATE=30\nATOM_AI_QUOTA_CHAT=300\nATOM_AI_QUOTA_VOICE=1500\n' "$k" > /etc/atom/ai.env; unset k; systemctl restart atom-connect
```

生成是「提交任务 → 轮询」，不受 nginx 30 秒读超时限制。

在现有 TLS server 中合并 `nginx-photos.conf`，`nginx -t` 成功后 reload。只有照片上传精确路径扩到 28 MiB（容纳 20 MiB 图片的 Base64），其他 API 保持原限制。`photo_media` 的原图/预览/缩略图 BLOB、元数据和持久生成任务均在市场 SQLite 中，因此现有备份与恢复流程完整覆盖相册。

照片按账号隔离但服务器可读，只有用户点击生成才将参考预览与提示词发送给模型商；与便签/日程的端到端加密分开说明。单张上传上限 20 MiB / 6400 万像素；每账号 64 MiB，所有相册合计 128 MiB。详细行为见 [相册说明](../../official/photo-album/README.md)。

## 首次部署

1. 本机执行（需已配置 `~/.ssh/ldcx_ed25519` 密钥登录）：

   ```sh
   atom/connect/server/deploy.sh
   ```

   创建 `atom` 系统用户、上传新版本、安装并启动 `atom-connect.service`，输出 `{"ok": true}` 即服务正常。不修改 nginx，不写入任何密钥。

2. nginx：先备份 `/home/lincaigui/nginx/nginx.conf`，按 [nginx-atom.conf](nginx-atom.conf) 把 `limit_req_zone` 放入 `http {}`、两个 `location` 放入 ldcx.tech 的 443 `server {}`，然后：

   ```sh
   docker exec nginx nginx -t && docker exec nginx nginx -s reload
   curl -s https://ldcx.tech/atom/market/v1/health
   ```

3. 备份凭据：在服务器上以 root 创建 `/etc/atom/oss.env`（`chmod 600`，不进仓库），建议使用只授权备份桶/前缀的 RAM 子账号：

   ```sh
   OSS_ACCESS_KEY_ID=...
   OSS_ACCESS_KEY_SECRET=...
   OSS_BUCKET=...
   OSS_ENDPOINT=https://oss-cn-shanghai.aliyuncs.com
   OSS_REGION=cn-shanghai
   OSS_PREFIX=atom/backups
   ```

   ldcx 主机不能用内网 endpoint：Tailscale 防火墙（`ts-input`）丢弃从 eth0 进入、源地址属于 100.64.0.0/10 的包，而 OSS 内网地址是 100.118.x.x，连接会一直挂起。公网 HTTPS endpoint 上传不收流量费。

   然后 `systemctl enable --now atom-connect-backup.timer`，并用 `systemctl start atom-connect-backup.service && journalctl -u atom-connect-backup -n 20` 验证一次。

## 邮件：账号找回与服务器告警

在服务器上以 root 写入 `/etc/atom/smtp.env`（`chmod 600`，不进仓库），密码在终端里输入、不经过聊天记录：

```sh
umask 077; read -p "SMTP 服务器: " h; read -p "端口(465 或 587): " p; read -p "发信账号: " u; read -s -p "发信密码: " k; echo; read -p "发件地址: " f; read -p "告警收件人: " t
printf "SMTP_HOST=%s\nSMTP_PORT=%s\nSMTP_USER=%s\nSMTP_PASSWORD=%s\nSMTP_FROM=%s\nALERT_TO=%s\n" "$h" "$p" "$u" "$k" "$f" "$t" > /etc/atom/smtp.env
systemctl restart atom-connect
# 只有准备好接收测试邮件时才执行。systemd 从私有文件加载，密码不会出现在进程参数里。
systemd-run --wait --pipe --uid=atom --property=EnvironmentFile=/etc/atom/smtp.env /usr/bin/python3 /opt/atom/connect/server/monitor.py --test-mail
```

- 465 端口使用 SSL，587 使用 STARTTLS。没有这个文件时，绑定邮箱、找回密码会提示「服务器暂未配置邮件发送」，监控照常运行但不发信。
- `atom-connect-monitor.timer` 每 5 分钟检查：公网健康、服务状态、最近一次备份（超过 26 小时算异常）、根分区剩余空间（低于 10%）、HTTPS 证书（14 天内过期）。故障和恢复各发一封，持续故障每 24 小时提醒一次；状态在 `/var/lib/atom/monitor.json`。
- 服务器整机宕机时它发不出邮件。建议在阿里云「云监控 → 站点监控」新建一个 HTTPS 探测：地址 `https://ldcx.tech/atom/market/v1/health`，返回内容包含 `"ok": true`，告警联系人填同一邮箱。

## 端到端加密

- **电脑任务**：配对时双方交换 X25519 公钥，任务内容、过程输出、审批说明和生成的应用在小电脑和电脑之间加密传输。两端「设备与连接」「我的电脑」显示同一组 6 位安全码，可以当面核对。某一方密钥变化后，另一方会停止收发并提示重新配对。
- **随手记与今日**：每个账号一把数据密钥，分别用登录密码和恢复密钥包装后存在服务器。首次登录（或旧会话输入一次密码）时自动启用并把已有明文迁移成密文，同时显示一次恢复密钥。邮件重置密码后需要恢复密钥才能解开原内容；选择「放弃旧内容」会删除服务器上无法解密的旧记录。
- 服务器能看到的只有路由和状态信息：设备与电脑 ID、任务状态和时间、便签置顶/删除、日程类型/完成状态、版本号。市场作品本来就公开源码，不加密。
- 启用加密之前的备份（服务器本地 3 份与 OSS 上的历史备份）仍含明文，可在迁移完成后按需清理 OSS 上的旧备份。

## 更新与回退

更新：再次运行 `deploy.sh`。数据库不随版本变化。

回退：把 `/opt/atom/connect`、`/opt/atom/official`、`/opt/atom/experiences` 链接指回 `/opt/atom/releases/` 下的旧版本，再 `systemctl restart atom-connect`。数据库恢复流程见 [市场运维说明](../marketplace/README.md)，需停服并保留现有数据库与 WAL。

## 运维

```sh
systemctl status atom-connect
journalctl -u atom-connect -n 50          # 服务不打印请求内容与访问日志
sudo -u atom python3 /opt/atom/connect/marketplace/ops.py --db /var/lib/atom/relay.marketplace.sqlite3 stats
```

## 上线前仍需注意

- 注册对公网开放（上限 1,000 用户）。
- 端到端加密之外的元数据（见上文）服务器可读；主机与备份仍要妥善保护。
- `172.17.0.0/16` 内其他容器也能伪造 `X-Real-IP`，这些容器应属可信服务。
- 主机磁盘需要留出余量；SQLite 写满时事务会回滚并返回 503。
