# ATOM Studio / Marketplace implementation contract

Current sprint implements a local-deployable product slice across the existing relay (19441), native Mac companion, and RK3566 device. Production hosting is not claimed. Root owns device server.py/relay_bridge.py/static and integration. Agents own their assigned directories. Never print/save credentials in source, screenshots, logs or commits.

## Marketplace service (platform agent)
Mounted before existing relay authentication at /market/v1. Public GET catalog/source; account bearer for private content/writes. Routes:
POST /market/v1/register {username,password} -> {token,user:{id,username}}
POST /market/v1/login {username,password} -> same
POST /market/v1/logout -> {ok:true}
GET /market/v1/me -> {user}
GET /market/v1/catalog?category=&q= -> {works:[{id,title,description,category,author,license,parent_id,parent_version_id,latest_version_id,...}]}
GET /market/v1/works/:id -> {work,versions:[{id,number,created_at,changelog}],derivatives:[work]}
GET /market/v1/versions/:id -> {version:{id,work_id,number,...},bundle:{manifest,files},license,author,parent_id,parent_version_id}
POST /market/v1/forks {version_id,title?} -> {draft}
GET /market/v1/drafts -> {drafts:[{id,title,category,license,parent_id,parent_version_id,revision,...}]} (own only)
GET /market/v1/drafts/:id -> {draft,bundle}
POST /market/v1/drafts {title,description,category,license,bundle} -> {draft}
POST /market/v1/drafts/:id/save {revision,bundle,title?,description?} -> {draft}; optimistic revision reject409
POST /market/v1/drafts/:id/publish {revision,changelog,confirm:true} -> {work,version}; immutable source+install bundle, publish scanner, permissions, quota. Parent/license attribution preserved.
GET /market/v1/notes -> {notes:[{id,text,pinned,deleted,revision,updated_at}]}
POST /market/v1/notes {id?,revision?,text,pinned?,deleted?} -> {note}; conflict409 with current; soft-delete restore. Root/PC clients retain pending offline entries and surface conflict without overwrite.
GET /market/v1/health -> {ok:true}
JSON errors {error,code?} status400/401/403/404/409. Body max2MiB for market (relay existing event limits remain). IDs URL-safe. categories life/companion/sound/play/connect; account password never sent model. DB private. Public source never includes private drafts. No arbitrary filesystem paths/URLs, no arbitrary server-side builds. Account sessions hashed, password PBKDF2, rate limit, safe publish scans basic accidental secrets (honest not exhaustive).

## PC workbench (computer agent)
Own computer/** and desktop if needed. Main.mjs adds authenticated same-origin /api/studio proxy routes:
GET /api/studio/catalog etc mirrors /market/v1/* including source/drafts/notes; POST /api/studio/register/login/logout stores market token PRIVATELY in store (not config identity, do not expose via state). GET /api/studio/me returns user only, configured bool useful. Use existing relay URL, never arbitrary inputproxyURL.
Native creation workspaces below state-dir/workspaces/<draftid>, complete source snapshot, no relay paths. UI source view/edit, version snapshots/restore, preview, fork, publish confirmation/license/source list. AI modify runs in a dedicated local Studio job with complete bundle text, original app ID (forks receive a distinct ID) and the requested change. The actual model transport strips tools, forces tool_choice=none, and rejects tool-call output. It does not use the general project-task tool execution path. Preferred companion local API endpoint /api/studio/ai-modify {draft_id,prompt}: execute real Codex through companion managed pipeline in read-only project, app prompt seeded with full source, result validated before draft save. No arbitrary tools/files from public source; avoid expanding project auth silently. Status is actual executing/failed/completed and save conflicts preserved. Alternative run via existing task owners if coherent but inform root.
Dashboard add Market/My creations/Notes panels maintaining fixed window, only explicit regions scroll. Keep existing connection/task UX. All task/source credentials private. Source publishing explicit confirm, full install resources.

## Device client (device UI agent)
Own atom/market-app/**, atom/notes-app/**, examples bundle(s), and official samples folder atom/official/**. Root deploys. App IDs market, quick-notes, purpose icon currentColor64. Use parent postMessage {type:'atom:market',id,action,data} result {type:'atom:market-result',id,result?,error?,status?,code?}. Actions:
state -> {configured,authenticated,user?,connection_error?}
register/login {username,password}; logout
catalog {q?,category?}; work {work_id}; source {version_id}; drafts; draft {draft_id}; fork {version_id,title?}
preview {version_id}; install {version_id} root validates+explicit UI confirmation; second click only, existing ID conflict no overwrite.
notes -> {notes}; save-note {id?,revision?,text,pinned?,deleted?}
Public catalog categories and work detail source/lineage, install, base-on-create (fork) links user to PC My creations. No need device source editor. Notes locally durable pending sync, conflict copy/retry explicit; AtomApp ack, 64KiB; plain notes capped4000 chars+max12 cached. voice root sends atom:market-voice or atom:notes-voice same states if implemented root.
Official seed samples are complete ATOM bundles with manifest.entry index.html, icon.svg, theme controls appropriate, AtomApp lifecycle/persistence/fullscreen rules. Three selected apps: official-companion (interactive face), pixel-lab (interactive pixel simulation), task-pal (computer task states via generic capability unavailable -> explicit honest demo/local state, do NOT fake integration). Platform seed imports these sources as official works (agent coordinate filenames). No copied unlicensed assets.

## Full acceptance
Two isolated user accounts, private draft access denied across accounts, official work -> fork -> AI source change -> true device preview/install -> explicit publish with provenance -> second user fork -> install. Offline note edits recover and conflicts do not overwrite. Public artifact hashes/immutable versions; desktop icons and order retained. Document hosted/account production limits truthfully. Root records actual model/device vs fixture checks.
