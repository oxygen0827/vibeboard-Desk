# ATOM Connect 公网部署（ldcx.tech/atom）

把中继与市场服务（`connect/relay/server.py`，仅 Python 标准库）部署到阿里云 ldcx 主机，经 Docker 内的 nginx 以 `https://ldcx.tech/atom` 对外提供。设备与电脑端的服务器地址都填 `https://ldcx.tech/atom`。

| 项 | 值 |
| --- | --- |
| 代码 | `/opt/atom/releases/<时间戳>`，`/opt/atom/connect`、`/opt/atom/official` 为指向当前版本的链接，保留最近 3 个版本 |
| 数据 | `/var/lib/atom/relay.sqlite3`、`relay.marketplace.sqlite3`（目录 0700，属 `atom` 系统用户） |
| 监听 | `172.17.0.1:9092`（Docker 网桥网关），只供 nginx 容器经 `host.docker.internal` 访问，不对公网开放 |
| 真实 IP | nginx 写入 `X-Real-IP`；服务只信任来自 `172.17.0.0/16` 的该请求头（`--trusted-proxy`），用于注册/登录/配对限流 |
| 边缘限流 | nginx `limit_req` 每 IP 10 r/s，突发 40 |
| 备份 | 每天主机时间 04:20 做一致性快照，打包上传 OSS 私有前缀，本地保留 3 份 |

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

## 更新与回退

更新：再次运行 `deploy.sh`。数据库不随版本变化。

回退：把 `/opt/atom/connect`、`/opt/atom/official` 链接指回 `/opt/atom/releases/` 下的旧版本，再 `systemctl restart atom-connect`。数据库恢复流程见 [市场运维说明](../marketplace/README.md)，需停服并保留现有数据库与 WAL。

## 运维

```sh
systemctl status atom-connect
journalctl -u atom-connect -n 50          # 服务不打印请求内容与访问日志
sudo -u atom python3 /opt/atom/connect/marketplace/ops.py --db /var/lib/atom/relay.marketplace.sqlite3 stats
```

## 上线前仍需注意

- 注册对公网开放（上限 1,000 用户）；如只给自己人用，需要先加邀请码开关。
- 数据库内容是服务器可读明文，不是端到端加密；主机与备份要按此保护。
- `172.17.0.0/16` 内其他容器也能伪造 `X-Real-IP`，这些容器应属可信服务。
- 主机磁盘需要留出余量；SQLite 写满时事务会回滚并返回 503。
