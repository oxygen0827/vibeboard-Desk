# 2026-10-31 installed-app product review

This is a three-pass, device-specific review, not a certification of every legacy app.

- `collect.py` creates an immutable source/hash inventory from the gray device. It reads installed application resources only; it does not read the state directory. Existing baselines are never overwritten.
- `browser.cjs` serves the installed scripts in opaque 480×360 iframes with the device SDK, an actual theme, and isolated account/storage/hardware fixtures. Large/binary resources are fetched through a read-only SSH tunnel at localhost:18770. Wait for full resource load before reviewing a page.
- `flows.cjs` exercises named per-app actions with the shared short-Space activation handler. `round3.cjs` explores the shared directional-navigation graph, checks dialogs, reduced motion and suspend.
- `regression.cjs`, `notes-regression.cjs`, `launch-focus.cjs` cover failed storage, preserved legacy scores, local audio cleanup, real lifecycle registration, notes navigation and initial iframe focus. `system.cjs` tests the device's actual shell scripts against isolated APIs in three passes.
- `scene-session.js` is the source of the explicitly consumed scheduling adapter. It does not replace browser globals. `scene-controls.js` owns semantic scene controls and delegates navigation/focus to AtomApp/AtomInput. Per-app copies are bundled resources.
- `round1.py`, `round2.py` and follow-up scripts document the patches applied to the immutable starting point. They are not general-purpose generators and must not be reapplied to an already patched tree.
- `export.py` updates source files and bundles while rejecting concurrent source edits. Quick Notes has a newer installed account-handling implementation: its device patch preserves that implementation, and the same navigation callback is inserted into the local source without replacing its account logic.
- `deploy-device.py` verifies every installed file against the source inventory, stages a complete copy including binary assets, overlays reviewed files, preserves installation metadata and atomically swaps each app directory. It never touches `/state`. It retains one scoped original release and rejects repeated deployment over that backup.

Reports and actual rendered screenshots are in `atom/artifacts/product-audit-2026-10-31/`. Device screenshots are under `device/`; browser screenshots use isolated data and are labeled separately. No real model generation or account mutation is required by this suite.

Full ports must be distributed as complete folders, including their binary resources. The compatibility `bundle.json` is not a replacement for the complete folder. Run `python3 atom/tools/check_app.py <folder> --full-port` for directory admission and `python3 atom/tools/prepare_icon_bundles.py` after regenerating bundles. Legacy source generators can overwrite reviewed wrappers; use the reviewed app folders as authoritative sources.
