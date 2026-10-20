# ATOM Connect v1 shared implementation contract

All agents share this workspace. Implement only assigned files; do not commit/push or touch unrelated UI/data. Root owns server.py, static/app.js, relay_bridge.py, deployment and integration.

## Architecture

A self-hostable relay with durable state; computer companion runs local agents and outbound HTTP JSON polling; device Python bridge also uses outbound HTTP. No inbound PC ports or public Codex app-server. HTTP long polling is an initial transport; do not claim WebSocket or end-to-end encryption is implemented. HTTPS required except loopback development/tunnel. Credentials are opaque random bearer tokens, stored privately by clients; relay stores token hashes. Public enrollment creates an isolated unpaired client; knowing another client ID grants no access. Bind clients through random short-lived device pair codes and explicit device confirmation. Local companion dashboard must be loopback-only with same-origin authenticated writes.

## Relay endpoints (implement exactly)

POST /v1/clients/register unauthenticated {role:"computer"|"device",name} -> {client_id,token}. Bearer auth thereafter.
GET /v1/state -> {client_id,role,paired:[{client_id,name,online,projects:[],agents:[]}],pair_requests:[{request_id,computer_id,computer_name}],tasks:[]}.
POST /v1/pair/code device -> {code,expires_at}.
POST /v1/pair/claim computer {code} -> {request_id,device_id,device_name} pending until device confirm.
POST /v1/pair/confirm device {request_id,accept:boolean} -> {ok:true}.
POST /v1/computer/state computer {projects:[{id,name}],agents:[{id,name,available,authenticated,reason}]} -> {ok:true}; also heartbeat. Never publish local filesystem paths or credentials.
POST /v1/tasks device {request_id,computer_id,project_id,agent_id,prompt,session_id?} -> {task:task}; idempotency by device+request_id. Verify binding and published project/agent; reject offline computer with409. task = {id,device_id,computer_id,project_id,agent_id,prompt,status,session_id?,last_seq,...}.
GET /v1/computer/commands computer -> {commands:[{id,type:"task.start"|"task.cancel"|"approval.response",task_id,payload:{...}}]}; includes unacked commands. payload for task.start contains full task.
POST /v1/computer/commands/ack {command_id} -> {ok:true}.
POST /v1/tasks/:id/events computer {event_id,type:"status"|"delta"|"approval"|"result"|"error",status?,text?,session_id?,approval?} -> {event}; idempotent event_id per task. relay assigns increasing seq. Approval {request_id,title,detail,choices:["accept","decline"]}. status lifecycle queued/running/waiting_approval/completed/failed/cancelled/interrupted. No success inferred from mere process exit/HTTP200; adapter must use protocol result.
GET /v1/tasks/:id/events?after=0 device/owncomputer -> {task,events:[{seq,...event}]}; paired other clients cannot inspect tasks owned by someone else.
POST /v1/tasks/:id/cancel device -> enqueue task.cancel; terminal cancellation comes from computer ack/event.
POST /v1/tasks/:id/approve device {request_id,decision:"accept"|"decline"} -> enqueue approval.response. Reject unknown/duplicate approvals and unauthorized task. Durable event log and commands; validate sizes; safe error JSON {error:"message",code:"optional"}.

## Computer companion

Node.js built-ins, package directory atom/connect/computer. Its config maps opaque project IDs to explicitly authorized absolute local folders. CLI/wizard must never allow relay-provided paths to override this map. Credentials private. Codex adapter stable stdio app-server initialize/thread/start or resume/turn/start, deltas, completion, approval requests and interrupts. Model account stays computer-side. Optional Claude adapter only official supported SDK/API auth; show unavailable until actually configured. No mocked agent by default. Provide fake-process adapters ONLY for tests. Durable execution ledger and dedupe; on process restart mark unresolved execution interrupted, never silently execute twice. Host disconnect lease expires: online false. Read-only state available even if provider missing. Project chooser and pairing UI.

## Device app UI (sub-agent owns only atom/computer-app and example bundle)

Installed app id my-computer, name 我的电脑, own currentColor icon.svg. Follows existing system CSS, 480x360 fullscreen, no permanent Home chrome. Root bridge:
postMessage({type:"atom:connect",id:uniqueRequestId,action,data},"*")
response from parent: {type:"atom:connect-result",id,result?,error?}.
Actions: state, configure {relay_url,name?}, pair-code, pair-confirm {request_id,accept}, create-task {request_id,computer_id,project_id,agent_id,prompt,session_id?}, task-events {task_id,after}, cancel-task {task_id}, approve-task {task_id,request_id,decision}.
state result combines relay state with {configured,relay_url,device_name,connection_error?}; relay state task statuses as above. Empty config renders setup form. No tokens ever sent to iframe. Device UI should retain prompt via AtomApp load/save with retry behavior, poll state/events only while mounted, clean up on suspend. List hosts/projects/agents, explicit task submit, real progress, approval accept/decline, cancellation, result text and reconnect/expired task handling. Pair code displayed on device and entered in computer dashboard; explicit pending pair confirm on device. Root will implement long-Space support when app active: parent sends {type:"atom:computer-voice",state:"starting"|"recording"|"transcribing"|"done"|"error",text?,error?}; app displays states and appends transcript to prompt, no automatic submit.

## Scope and quality

No cloud credentials available for public relay deployment. Root will validate real device -> SSH reverse localhost tunnel -> local relay -> actual local Codex installation. Clearly distinguish real protocol smoke tests, test-fake generation, and real inference. No claim current Codex GUI sessions are automatically controlled. Optional Claude failures honest. Preserve existing apps, drafts and keys. Do not log prompts/tokens by default.

## Application delivery extension

Create-task accepts kind:"task" (default) or "app". App tasks wrap the request in the ATOM bundle contract. On authoritative completed only, computer validates and sends result with artifact:{manifest,files}, <=96 KiB UTF-8. Invalid app output becomes failed. Relay persists artifact with owner checks and returns artifact_available in state summaries. GET /v1/tasks/:id/artifact -> {artifact}; only task device/computer owners, completed app with artifact.

Device bridge action artifact proxies the endpoint. Shell-owned preview-app and install-app fetch only persisted task artifact and revalidate through device installer. preview-app returns {bundle}; install-app returns {ok,app} only after developer-mode gate and explicit device UI confirmation; no automatic overwrite. Ordinary app iframes do not receive Connect capabilities.
