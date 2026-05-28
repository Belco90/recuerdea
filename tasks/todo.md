# v14 — Source-folder navigator for the admin picker

> Restore the v12-style navigable view of `PCLOUD_SOURCE_FOLDER_ID` as the
> "Añadir más" picker on top of v13's blob-backed storage. Save accepts
> fileids; server resolves to uuids (lazy-minting via `stat` +
> `getfilepublink` when fileid is unknown). Cron sweep reads `collection/v1`
> read-only to spare curated-but-non-memories uuids. See `tasks/plan.md`
> for full rationale and risks.

## Phase 1 — Source-folder data path

- [ ] **T1**: Restore `src/lib/admin/source-folder.{ts,server.ts}` + tests
  - [ ] `SourceFileItem = { fileid, name, kind, thumbUrl }` (no uuid yet)
  - [ ] `fetchAdminSourceFolder(client, { folderid? })` + `assertSourceFolderId()` + `SourceFolderIdMissingError` + `FolderNotPermittedError`
  - [ ] Breadcrumb walk capped (source root / pCloud root / depth 10)
  - [ ] Files: `image/*` | `video/*`, batched `getthumbslinks` (320x320 jpg, crop=1)
  - [ ] Server-fn uses `PCLOUD_TOKEN` (no `PCLOUD_ADMIN_AUTH`)
  - [ ] Tests: empty folder, root listing, nested navigation, breadcrumb walk, FolderNotPermitted, missing env var, missing thumbs

## Phase 2 — Navigator component

- [ ] **T2**: Restore `src/components/AdminFolderNavigator.tsx` + browser test
  - [ ] Props: `listing`, `picked` (fileid set), `blocked` (fileid set), `onNavigate`, `onToggle`, `onSave`, `onCancel`, `saving?`
  - [ ] Breadcrumbs row → subfolder grid → file grid → sticky `Guardar (N)` / `Cancelar`
  - [ ] Blocked tiles dimmed + `aria-disabled='true'`
  - [ ] Browser test: nav click → folderid, file click → fileid, blocked tile aria-disabled + ignores click, saving disables Save

## Phase 3 — Save path (fileid → uuid with lazy-mint)

- [ ] **T3**: `collection.server.ts` rewrites
  - [ ] `CollectionItem = { uuid, fileid, name, kind, thumbUrl }`; `fetchCuratedItems` populates `fileid`
  - [ ] New `lazyMintFile(client, fileidIndex, mediaCache, fileid): Promise<string>` — short-circuit on known fileid; on unknown: `stat` + `getfilepublink`, write media-cache (no extraction → null dims/location/place), write fileid-index, return new uuid
  - [ ] New `addFileidsToCollection(client, fileidIndex, mediaCache, collectionCache, fileids)` — dedup + RMW + stamp refreshedAt
  - [ ] Remove `addUuidsToCollection`
  - [ ] Tests: short-circuit, lazy-mint pCloud-call shape, mixed batch, dedup, validation, `stat` failure

- [ ] **T4**: `collection.ts` server-fn rewires
  - [ ] `addToCollection` validator: `{ fileids: readonly number[] }` (positive integers, non-empty)
  - [ ] Handler builds OAuth client from `PCLOUD_TOKEN`, wires `fileidIndex` + `mediaCache` + `collectionCache`, calls `addFileidsToCollection`
  - [ ] `removeFromCollection` unchanged
  - [ ] Re-export `CollectionItem`

### Checkpoint A

- [ ] `pnpm test -- src/lib/admin/collection.server` green
- [ ] `pnpm type-check` clean

## Phase 4 — Cron sweep protection

- [ ] **T5**: `refreshMemories` sweep reads collection blob
  - [ ] New optional 7th param: `collectionReader?: { lookup(): Promise<CollectionSnapshot | undefined> }`
  - [ ] Sweep: `protectedSet = new Set([...aliveUuids, ...(curated ?? [])])`
  - [ ] Tests: no reader (unchanged), reader returns undefined (unchanged), reader returns curated uuid outside memories (spared), reader returns empty (unchanged)

- [ ] **T6**: Scheduled function wires the collection reader
  - [ ] Re-add `createCollectionCache` + `getCollectionCacheStore` imports
  - [ ] Pass `{ lookup: collectionCache.lookup }` as 7th arg to `refreshMemories`
  - [ ] No writes to `collection/v1`

### Checkpoint B — Cron clean

- [ ] `pnpm test -- src/lib/memories/refresh-memories.server` green
- [ ] `pnpm invoke:refresh-memories` end-to-end OK

## Phase 5 — Admin route

- [ ] **T7**: Rewire `src/routes/admin/collection.tsx`
  - [ ] `validateSearch` + `loaderDeps` for `?folderid` (non-negative integer)
  - [ ] Loader: `Promise.all([getCollectionMedia(), getAdminSourceFolder({ data: { folderid } })])`
  - [ ] Picked state: `Map<fileid, SourceFileItem>` so picks survive navigation
  - [ ] `blocked` = `new Set(collectionItems.map(m => m.fileid))`
  - [ ] `handleSave(fileids)` → `addToCollection({ data: { fileids } })`
  - [ ] `handleRemove(uuid)` → `removeFromCollection({ data: { uuids: [uuid] } })`
  - [ ] Banners: `SourceFolderMissingBanner` / `FolderNotPermittedBanner` restored
  - [ ] Replace v13's no-banner with: "Los cambios aparecen inmediatamente en la página principal."

### Checkpoint C — End-to-end

- [ ] `pnpm type-check` clean
- [ ] `pnpm test:unit` / `test:browser` green
- [ ] Manual `pnpm dev:netlify`: navigate folders, pick across folders, save, current-collection grid updates without reload
- [ ] Manual: pick a file outside memories folder → save → `/` shows it immediately → cron runs → file survives sweep

## Phase 6 — Demolition

- [ ] **T8**: Delete v13 flat-grid path
  - [ ] Remove `src/lib/admin/folder-media.{ts,server.ts,server.test.ts}`
  - [ ] Remove `src/components/AdminCollectionGrid.{tsx,browser.test.tsx}`
  - [ ] `grep -rn 'folder-media\|AdminCollectionGrid\|addUuidsToCollection' src/ netlify/ test/ __mocks__/` returns nothing

## Phase 7 — SPEC + verification

- [ ] **T9**: SPEC.md
  - [ ] Add §25 (v14 Acceptance Criteria) — navigator restored, lazy-mint, cron sweep union, single-writer preserved
  - [ ] Add §26 (v13 → v14 changes summary)
  - [ ] §7 "Always do": clarify cron is **sole writer** of `media/<uuid>` + `fileid-index/<fileid>` + `folder/v1` and a **read-only consumer** of `collection/v1`
  - [ ] Annotate §23 (v13) picker scope as superseded by §25
  - [ ] Restore `PCLOUD_SOURCE_FOLDER_ID` in `src/env.d.ts`

- [ ] **T10**: CI gate + deploy-preview smoke
  - [ ] `pnpm type-check` clean
  - [ ] `pnpm test` (both projects) green
  - [ ] `pnpm exec oxlint src/ netlify/ test/ __mocks__/ scripts/` clean
  - [ ] `pnpm format:check` clean
  - [ ] `pnpm build` clean (after `rm -rf dist .netlify/blobs-serve`)
  - [ ] Deploy preview: provision env vars; trigger cron; smoke admin route navigation + cross-folder pick + sweep survival
  - [ ] `curl -I` deploy-preview `/` → `Cache-Control: private`/`no-store`

### Final checkpoint

- [ ] All checkpoints A/B/C green
- [ ] PR open targeting `main`
- [ ] SPEC.md matches the working tree
