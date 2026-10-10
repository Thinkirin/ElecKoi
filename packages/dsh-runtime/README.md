# @eleckoi/dsh-runtime

`@eleckoi/dsh-runtime` is ElecKoi's DSH Runtime Adapter Package（DSH 运行时适配包）。

## Ownership（职责）

- Own formal Session operations, SessionController integration and controlled session editing.
- Keep Electron Main and the product Renderer independent from DSH package internals.
- Build real ESM/CJS artifacts and declarations in `dist/`; consumers must use the package root export.

## Current capability（当前能力）

- Official DSH Session persistence, projection, streaming, cancellation and restart recovery.
- Same-Session message editing and rewind for deletion and regeneration.
- Startup Session recovery used by the desktop Host; the Host lifecycle and child-process protocol belong to `apps/desktop-host`.
- Trajectory helpers for ElecKoi's request and context presentation.
- Exact, compatibility-batch DSH dependency versions.

The active conversation path starts the official Web profile through `apps/desktop-host/src/desktopPluginHostChild.ts`.
`apps/desktop/resources/dsh/desktop-agent.patch.yml` adds desktop Agent settings; DSH profile bundles add
ElecKoi's roleplay lifecycle and Tavily search provider. `apps/desktop/resources/dsh/cordis.yml` remains an
SDK compatibility composition, not the active desktop conversation tree. The pinned upstream
commit, both composition roles and capability inventory are recorded in
`apps/desktop/resources/dsh/runtime-manifest.json`. Product data and Remote services are owned by
`@eleckoi/dsh-product-data` and `@eleckoi/dsh-product-api`; the DSH Web Client loads ElecKoi's
Client plugins and consumes official Session/Connection projections.

## Upstream update（上游更新）

1. Update all related `@deepseek-ai/dsh-*` packages as one exact-version compatibility batch.
2. Update `runtime-manifest.json` with the reviewed upstream commit and plugin inventory.
3. Run `pnpm check:dsh-versions` and `pnpm check:dsh-runtime`.
4. Run the real runtime handshake test, Electron native smoke check and production build.
5. Merge through a reviewed dependency-update PR; never track a floating upstream branch from the product directory.
