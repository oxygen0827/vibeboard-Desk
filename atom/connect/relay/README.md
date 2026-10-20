# ATOM Connect relay

Durable authenticated routing between an ATOM device and its paired computer. Python 3.7+ and SQLite from the standard library; no model credentials or local project paths belong here.

```sh
python3 atom/connect/relay/server.py --host 127.0.0.1 --port 8787 --db ~/.local/share/atom-connect/relay.sqlite3
python3 -m unittest discover -s atom/connect/relay -p 'test_*.py' -v
```

The HTTP contract is in [../PROTOCOL.md](../PROTOCOL.md). Responses use UTF-8 JSON; writes require `Content-Type: application/json`. All endpoints except registration require `Authorization: Bearer <token>`. Client token is returned once by registration; only its SHA-256 hash is stored by the relay. Pair codes are random 12 hexadecimal characters (48 bits), expire after five minutes, are stored as hashes, and are consumed when claimed. Device confirmation is still required; generating a replacement invalidates outstanding requests. A known client or task ID never grants access.

Computers publish metadata and heartbeat at least every 15 seconds. The online lease is 45 seconds; reads do not renew a computer lease. Devices renew presence on authenticated requests. Metadata is allowlisted: projects expose IDs/names, agents expose capability state/reason. Paths and provider credentials are discarded from metadata. Publishing credentials in free text remains the client's responsibility.

Task creation deduplicates `(device, request_id)`. Computer events deduplicate `(task, event_id)` and receive monotonic sequence numbers. Commands stay in SQLite until acknowledged and can be delivered again: the companion **must persist its own execution ledger before acknowledging or executing**. Approval responses are single-use and must match an actual pending request. Cancellation only enqueues a request; a computer event provides terminal state. Only `result` declares successful completion. Existing sessions can resume only through a recorded session of the same device, computer, project and agent.

Poll `/v1/computer/commands` and task events every 0.5–2 seconds while active, with backoff when idle/offline. This implementation uses ordinary bounded HTTP polling, not WebSockets. State lists the most recent 100 tasks; event pages contain at most 100 events; command pages contain at most 50 commands. Clients must advance event cursors and acknowledge commands. Requests are limited to 128 KiB, prompts to 16,000 characters, event text to 32,000 characters, projects to 50 and agents to 20. Registration and pairing claims have a per-peer limit of 30 requests/minute.

## Hosting and recovery

Default bind is loopback. For access across machines put it behind a trusted HTTPS reverse proxy; never send bearer tokens across public plaintext HTTP. A private SSH tunnel to loopback is suitable for development. Preserve the SQLite database **and its WAL files**; use SQLite's backup API or stop the service before copying. The database is mode 0600 and default parent directory mode 0700. Prompts and results are durable plaintext in the database: protect the host, backups and TLS termination accordingly. This is not end-to-end encryption.

All mutation requests carrying an `Origin` header are rejected, including same-origin browser calls. Use the authenticated native computer/device proxy, not direct browser fetch. No access logs or request bodies are printed. Errors are safe JSON without stack traces, filesystem paths or request contents. There is no public health endpoint or permissive CORS. Configure reverse-proxy connection and body limits for public hosting. In-memory peer throttling sees the immediate connection peer. Behind a reverse proxy, pass `--trusted-proxy <CIDR>` (repeatable): only connections from those networks may name the client through `X-Real-IP`, which the proxy must overwrite with its own `$remote_addr`; `X-Forwarded-For` is never trusted. Still configure public-edge rate limits. See [../server/README.md](../server/README.md) for the ldcx.tech deployment. Registration is open enrollment, so public multi-tenant operation additionally needs invitation/account quotas, retention policy and operational monitoring. This prototype does not implement account recovery, unpairing/revocation, automatic database pruning, or an account billing system.

Restarting the relay preserves pairings, tasks, events, command acknowledgments and pending approvals. It does not infer failure or success from a missing computer heartbeat. The companion owns recovery of interrupted local agent processes and must publish an honest terminal event after its own restart.


## Prototype resource ceilings

The relay rejects new enrollment at 10,000 clients, task creation at 10,000 total tasks or 1,000 per device, commands at 100,000 total rows, and pending/history pairing requests at 50,000. A task accepts at most 4,096 nonterminal events and 8 MiB of event JSON, reserving space for a terminal event so the companion can report an explicit failure. At a limit, callers receive an actionable error; records are not silently discarded. Command/event delivery dedupe remains valid until an operator deliberately archives/deletes history. SQLite main-database page count is capped at 65,536 (256 MiB with the default 4 KiB page size), WAL auto-checkpoint is 256 pages and journal size limit is 16 MiB. Normal writes are serialized under one relay lock. The WAL limit applies on checkpoints, not a strict per-instant filesystem quota; put the data directory on a quota-controlled volume for hostile public service use.

A waiting approval cannot be bypassed by a running/status/delta/result transition. The computer must first consume an actual device decision; failure, interruption or cancellation can terminate without granting the approval. The relay validates protocol consistency, while the trusted computer companion remains responsible for enforcing its local permission boundaries.

## Paired computer activity

A heartbeat may include one optional `activity` object: `{id,type,status,updated_at}`. IDs are opaque URL-safe identifiers; types are `app-modify` or `notes-organize`; statuses are queued/running/completed/failed/cancelled/interrupted; updated_at is a finite Unix-seconds number. Extra title, prompt, source or account fields are discarded. Only already-paired clients receive this four-field activity summary in `state.paired`; no private Studio content is exposed. Omitting activity or sending null clears the summary. This status is a companion-reported activity, not a substitute for durable relay task events or proof of model success.
