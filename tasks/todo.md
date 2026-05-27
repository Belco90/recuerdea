# v13 — Curated collection moves to Netlify Blob

> Drop the pCloud collection layer (`PCLOUD_COLLECTION_ID` + `PCLOUD_ADMIN_AUTH`
>
> - `collection_*` API calls). Admin route becomes the sole writer of the
>   existing `collection-cache` Netlify Blob. Edits are instant on the home page;
>   cron stops touching the collection blob. Loader is unchanged. See
>   `tasks/plan.md` for full rationale and dependency graph.

## Phase 1 — Blob-backed storage primitives

- [ ] **T1**: Rewrite `src/lib/admin/collection.server.ts` blob-backed
  - [ ] New `AdminFileItem = { uuid, name, kind, thumbUrl }` (no fileid)
  - [ ] `fetchCuratedItems(collectionCache, mediaCache)` — empty-blob safe; drops missing media entries silently
  - [ ] `addUuidsToCollection(collectionCache, uuids)` — RMW, dedupe, stamp `refreshedAt`
  - [ ] `removeUuidsFromCollection(collectionCache, uuids)` — RMW; no-op on empty
  - [ ] Delete `CollectionIdMissingError`, `assertCollectionId()`
  - [ ] Zero pCloud imports (`Client`, `FileMetadata`) remain in the module
  - [ ] Tests rewritten: empty-blob, normal, dedup, validation throws on bad input

- [ ] **T2**: Rewrite `src/lib/admin/collection.ts` server-fns
  - [ ] Drop `makeClient()` and any `PCLOUD_ADMIN_AUTH` references
  - [ ] `CollectionMediaResult` → `{ status: 'ok'; items: AdminFileItem[] }` (no `unconfigured`)
  - [ ] `getCollectionMedia` wires `getCollectionCacheStore()` + `getMediaCacheStore()`
  - [ ] `addToCollection` / `removeFromCollection` accept `{ uuids: readonly string[] }`; validators reject empty / non-string
  - [ ] Re-export `AdminFileItem`

### Checkpoint A

- [ ] `pnpm test -- src/lib/admin/collection.server` green
- [ ] `pnpm type-check` clean

## Phase 2 — Picker data source

- [ ] **T3**: Add `src/lib/admin/folder-media.{ts,server.ts}` + test
  - [ ] `fetchAdminFolderMedia(folderCache, mediaCache)` reads `folder/v1` + `media/<uuid>`; preserves snapshot order; drops missing
  - [ ] `getAdminFolderMedia` server-fn — admin-gated, blob-store wiring, no pCloud imports
  - [ ] Tests: empty snapshot, normal, missing entries dropped

## Phase 3 — UI components

- [ ] **T4**: Update `src/components/CollectionItemsGrid.tsx` to uuid-keyed
  - [ ] Props use `uuid` instead of `fileid`; React `key` = `item.uuid`
  - [ ] Browser test updated to drive uuid-based interactions

- [ ] **T5**: Add `src/components/AdminCollectionGrid.tsx` (uuid-keyed multi-select)
  - [ ] Props: `items`, `picked`, `blocked`, `onToggle`, `onSave`, `onCancel`, `saving?`
  - [ ] Blocked tiles dimmed + `aria-disabled='true'` + non-interactive
  - [ ] Save shows `Guardar (N)`; Cancel hidden when N=0
  - [ ] Browser test: 3 items, 1 blocked, 1 picked → Save forwards uuids

## Phase 4 — Admin route

- [ ] **T6**: Rewire `src/routes/admin/collection.tsx`
  - [ ] Drop `validateSearch` / `loaderDeps` / `?folderid` plumbing
  - [ ] Loader: `Promise.all([getCollectionMedia(), getAdminFolderMedia()])`
  - [ ] Picker `blocked` set built from `collectionItems`
  - [ ] `handleSave` → `addToCollection({ data: { uuids } })`
  - [ ] `handleRemove(uuid)` → `removeFromCollection({ data: { uuids: [uuid] } })`
  - [ ] Both handlers `router.invalidate()` on success
  - [ ] Delete 04:00 UTC `Alert.Root`
  - [ ] Delete `UnconfiguredBanner`, `SourceFolderMissingBanner`, `FolderNotPermittedBanner`
  - [ ] No references to `getAdminSourceFolder`, `AdminFolderNavigator`, `?folderid`

### Checkpoint B — Admin path end-to-end

- [ ] `pnpm type-check` clean
- [ ] `pnpm test:unit` clean
- [ ] `pnpm test:browser` clean
- [ ] Manual on `pnpm dev:netlify`: empty, pick → Save → top grid updates; Remove → blocked drops
- [ ] Manual on `/`: curated set reflects without invoking cron
- [ ] Manual on `/` after clearing blob: falls back to folder snapshot

## Phase 5 — Cron + scheduled function cleanup

- [ ] **T7**: Strip collection-snapshot pass from `src/lib/memories/refresh-memories.server.ts`
  - [ ] Delete `CollectionOpts`, `CollectionStats`, `refreshCollectionSnapshot`, `CollectionDetailsResponse`
  - [ ] Remove `collectionStats` field from `RefreshResult`
  - [ ] Drop the 7th `collectionOpts` parameter
  - [ ] Update `refresh-memories.server.test.ts` accordingly

- [ ] **T8**: Strip collection wiring from `netlify/functions/refresh-memories.ts`
  - [ ] `getEnvConfig()` returns `{ token, folderId }` only
  - [ ] Drop `createCollectionCache` / `getCollectionCacheStore` imports
  - [ ] Drop the second `createClient({ token: adminToken, type: 'pcloud' })`
  - [ ] Drop the `if (result.collectionStats)` log block
  - [ ] Call `refreshMemories(...)` with the new signature

### Checkpoint C — Cron clean

- [ ] `pnpm test -- src/lib/memories/refresh-memories.server` green
- [ ] `pnpm invoke:refresh-memories` on `pnpm dev:netlify` runs end-to-end; no `collection:` line in summary

## Phase 6 — Demolition

- [ ] **T9**: Delete v12 source-folder + navigator
  - [ ] Remove `src/lib/admin/source-folder.ts`
  - [ ] Remove `src/lib/admin/source-folder.server.ts`
  - [ ] Remove `src/lib/admin/source-folder.server.test.ts`
  - [ ] Remove `src/components/AdminFolderNavigator.tsx`
  - [ ] Remove `src/components/AdminFolderNavigator.browser.test.tsx`
  - [ ] `grep -rn 'source-folder\|AdminFolderNavigator\|PCLOUD_SOURCE_FOLDER_ID\|PCLOUD_ADMIN_AUTH\|PCLOUD_COLLECTION_ID' src/ netlify/ test/ __mocks__/` returns 0 matches in the working tree

- [ ] **T10**: Update `SPEC.md`
  - [ ] Add §23 (v13 Acceptance Criteria) — storage shape, admin-only writer, loader unchanged, picker scope, env-var drops, instant edits
  - [ ] Add §24 (v12 → v13 changes summary)
  - [ ] §7 cron-writer bullet drops `collection/v1`
  - [ ] §7 new bullet: `/admin/collection` is sole writer of `collection/v1`
  - [ ] §7 "Never do": forbid pCloud `collection_*` calls
  - [ ] §4 structure: remove `source-folder.{ts,server.ts}`, `AdminFolderNavigator.tsx`; add `folder-media.{ts,server.ts}`, `AdminCollectionGrid.tsx`
  - [ ] §8 Open Questions: add §8.9 — curation storage = Netlify Blobs (admin-owned), resolved in v13

## Phase 7 — Final verification

- [ ] **T11**: CI gate + deploy-preview smoke
  - [ ] `pnpm install` clean
  - [ ] `pnpm type-check` clean
  - [ ] `pnpm test` (both projects) clean
  - [ ] `pnpm lint` clean
  - [ ] `pnpm format:check` clean
  - [ ] `pnpm build` clean (after `rm -rf dist .netlify/blobs-serve`)
  - [ ] Deploy preview: provision only `PCLOUD_TOKEN` + `PCLOUD_MEMORIES_FOLDER_ID` (+ optional `GEOAPIFY_API_KEY`); trigger cron once; curate; verify `/` reflects without waiting for cron
  - [ ] `curl -I` deploy-preview `/` → `Cache-Control: private` or `no-store`

### Final checkpoint

- [ ] Branch named (e.g. `v13-blob-curation`)
- [ ] PR open targeting `main`
- [ ] SPEC.md matches the working tree
- [ ] All checkpoints A/B/C green
