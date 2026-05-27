# Implementation Plan: v13 — Curated collection moves to Netlify Blob

## Overview

Replace the pCloud-collection layer (`PCLOUD_COLLECTION_ID` + `PCLOUD_ADMIN_AUTH` + `collection_linkfiles` / `collection_unlinkfiles` / `collection_details`) with **admin-owned writes directly to the existing `collection-cache` Netlify Blob**. The cron stops touching the collection blob; the admin route becomes its sole writer. Edits land instantly on the home page (no 04:00 UTC wait), the admin "current collection" view becomes a pure blob read (no pCloud calls), and we drop one env var, one auth token, and three pCloud API endpoints from the surface area.

The home-page loader is **unchanged** — `fetchTodayMemories` already reads `collection-cache` first and falls back to `folder/v1` when absent, which preserves §17 behavior on a cold blob and matches §19's "empty collection means show nothing".

## Architecture Decisions

- **Blob storage shape is unchanged** (`collection/v1 = { refreshedAt, uuids: readonly string[] }`). `refreshedAt` now records the last admin edit. The loader-side semantics (`undefined` → fall back to folder; `{ uuids: [] }` → render nothing) are preserved.
- **uuid is the wire id everywhere in the admin surface.** v12 used `fileid` because it was talking to pCloud directly; with the blob as source of truth, uuids match how media-cache, fileid-index, and folder-cache are already keyed. No fileid reaches the browser.
- **Picker is a flat grid of folder-snapshotted items** (v11-style, decision from clarification). This deletes the v12 `AdminFolderNavigator` + `lib/admin/source-folder.*` + `PCLOUD_SOURCE_FOLDER_ID` env var entirely. Trade-off: new pCloud uploads become curatable only after the next 04:00 UTC cron, not within seconds. Acceptable for a single-user "on this day" app — the home page also waits for that cron.
- **Cron stops writing the collection blob.** Single-writer invariant restored, just inverted (admin owns the writer role instead of the cron). The cron continues to own `media/<uuid>`, `fileid-index/<fileid>`, and `folder/v1`.
- **Stale uuids in the blob are not GC'd** (decision from clarification). If the cron sweeps a fileid (deleted in pCloud), its uuid lingers in the collection blob — but `fetchTodayMemories` already filters out uuids whose `mediaCache.lookup(uuid)` returns `undefined`, so the only effect is a tiny harmless accumulation. Pruning is out of scope for v13.
- **PCLOUD_ADMIN_AUTH is dropped.** It existed solely to make `collection_*` work (those endpoints reject OAuth with `result: 1000 "Log in required"`). With no `collection_*` calls anywhere, the OAuth `PCLOUD_TOKEN` covers every remaining pCloud surface (cron `listfolder` + `getfilepublink` + `deletepublink` + `getfilelink`; runtime `getpublinkdownload`).

### What stays vs. what goes

| Surface                                                                          | Status                                                                     |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `collection-cache` blob store + `CollectionCache` / `CollectionCacheStore` types | **Stays.** Same shape, new owner.                                          |
| `fetchTodayMemories` (loader)                                                    | **Stays — unchanged.** Already collection-blob-first with folder fallback. |
| pCloud `collection_details` / `collection_linkfiles` / `collection_unlinkfiles`  | **Gone.** Every call site deleted.                                         |
| `PCLOUD_COLLECTION_ID` env var                                                   | **Gone.**                                                                  |
| `PCLOUD_ADMIN_AUTH` env var                                                      | **Gone.**                                                                  |
| `PCLOUD_SOURCE_FOLDER_ID` env var                                                | **Gone.**                                                                  |
| `lib/admin/source-folder.{ts,server.ts}`                                         | **Deleted.**                                                               |
| `components/AdminFolderNavigator.tsx` + test                                     | **Deleted.**                                                               |
| Cron's `refreshCollectionSnapshot` + `CollectionOpts` + `CollectionStats`        | **Gone.**                                                                  |
| `RefreshResult.collectionStats` + corresponding cron log line                    | **Gone.**                                                                  |
| `AdminFileItem` shape                                                            | **Changed.** `{ fileid, … }` → `{ uuid, … }`.                              |
| "Los cambios aparecerán tras la próxima sincronización (04:00 UTC)" banner       | **Gone.** Edits are instant.                                               |
| `lib/admin/collection.{ts,server.ts}`                                            | **Rewritten.** Blob-backed instead of pCloud-backed.                       |
| `components/CollectionItemsGrid.tsx`                                             | **Updated** to be uuid-keyed.                                              |
| `components/AdminCollectionGrid.tsx` (was deleted in v12)                        | **Reintroduced** as a uuid-keyed multi-select picker.                      |

## Dependency Graph

```
collection-cache (blob store, unchanged)
    │
    ├── lib/admin/collection.server.ts (rewritten — blob CRUD)
    │       │
    │       └── lib/admin/collection.ts server-fns (rewritten — uuid wire shape)
    │               │
    │               └── /admin/collection route (loader + handlers updated)
    │                       │
    │                       ├── CollectionItemsGrid (uuid-keyed)
    │                       └── AdminCollectionGrid (new — uuid-keyed multi-select)
    │
    └── lib/admin/folder-media.server.ts (new — reads folder/v1 + media-cache)
            │
            └── lib/admin/folder-media.ts (new — server-fn wrapper)
                    │
                    └── /admin/collection route loader
```

Independent demolition track (no dependencies on the above):

- Remove cron collection-snapshot pass
- Delete source-folder + AdminFolderNavigator
- Update SPEC

## Task List

### Phase 1: Storage primitives (blob-backed CRUD)

#### Task 1: Rewrite `lib/admin/collection.server.ts` to be blob-backed

**Description:** Replace the pCloud `Client`-shaped helpers with blob-shaped helpers. The new module talks only to `CollectionCache` + `MediaCache` — no pCloud import. `AdminFileItem` switches from `{ fileid, … }` to `{ uuid, … }`.

**Acceptance criteria:**

- [ ] `AdminFileItem = { uuid: string; name: string; kind: 'image' | 'video' | 'other'; thumbUrl: string | null }` (fileid removed).
- [ ] `fetchCuratedItems(collectionCache, mediaCache)`: reads `collection-cache` blob; returns `[]` when the blob is empty/missing; for each uuid in the snapshot, reads `mediaCache.lookup(uuid)` and builds an `AdminFileItem` using `buildThumbUrl(meta.code, '320x320')`; silently drops uuids whose media entry is missing.
- [ ] `addUuidsToCollection(collectionCache, uuids: readonly string[])`: read-modify-write — reads the current snapshot (or `{ uuids: [] }` if missing), merges in the new uuids (dedupe, preserve insertion order), writes back with `refreshedAt: new Date().toISOString()`. Validates: every uuid is a non-empty string; throws `TypeError` otherwise.
- [ ] `removeUuidsFromCollection(collectionCache, uuids: readonly string[])`: read-modify-write — reads current snapshot, removes the given uuids, writes back. No-ops on empty snapshot. Validation same as above.
- [ ] `CollectionIdMissingError` and `assertCollectionId()` deleted.
- [ ] Module imports zero pCloud types (no `Client`, no `FileMetadata`).

**Verification:**

- [ ] `pnpm test -- src/lib/admin/collection.server` — new unit tests cover: empty-blob path, normal fetch, addUuids dedup, addUuids on empty blob, removeUuids on missing, removeUuids stable order, validation throws on bad input.
- [ ] `pnpm type-check` passes.

**Dependencies:** None.

**Files likely touched:**

- `src/lib/admin/collection.server.ts` (rewritten)
- `src/lib/admin/collection.server.test.ts` (rewritten)

**Estimated scope:** M (2 files, behavioral rewrite + new tests).

---

#### Task 2: Rewrite `lib/admin/collection.ts` server-fns to wire blob stores

**Description:** Drop the pCloud client builder and `PCLOUD_ADMIN_AUTH` lookup. Server-fns wire `getCollectionCacheStore()` + `getMediaCacheStore()` into the new helpers. Input validators switch from `{ fileids: number[] }` to `{ uuids: string[] }`.

**Acceptance criteria:**

- [ ] `makeClient()` and any `PCLOUD_ADMIN_AUTH` references removed from `collection.ts`.
- [ ] `CollectionMediaResult` simplifies to `{ status: 'ok'; items: AdminFileItem[] }` (the `unconfigured` variant is gone — there's no env var to misconfigure anymore).
- [ ] `getCollectionMedia` handler: admin-gated; wires `createCollectionCache(getCollectionCacheStore())` + `createMediaCache(getMediaCacheStore())`; returns `{ status: 'ok', items: await fetchCuratedItems(...) }`.
- [ ] `linkFilesToCollection` renamed → `addToCollection` (or kept as alias). Input: `{ uuids: readonly string[] }`. Validator rejects empty arrays or non-string entries. Handler calls `addUuidsToCollection`.
- [ ] `unlinkFilesFromCollection` renamed → `removeFromCollection` (or kept as alias). Same input/validator/handler shape.
- [ ] Re-export type stays `AdminFileItem` (new uuid-keyed shape).

**Verification:**

- [ ] `pnpm type-check` passes.
- [ ] `pnpm lint` passes.
- [ ] Call sites in `/admin/collection.tsx` compile against the new shape (Task 6).

**Dependencies:** Task 1.

**Files likely touched:**

- `src/lib/admin/collection.ts` (rewritten)

**Estimated scope:** S (single file, mechanical rewire).

---

### Phase 2: Picker data source (cached-folder grid)

#### Task 3: Add `lib/admin/folder-media.{ts,server.ts}` — flat picker source

**Description:** Replace the v12 source-folder navigator with a flat read over `folder/v1` + `media/<uuid>`. The picker grid shows every file the cron has snapshotted in `PCLOUD_MEMORIES_FOLDER_ID`, keyed by uuid; the route filters out items already in the curated collection at render time. Zero pCloud calls.

**Acceptance criteria:**

- [ ] `lib/admin/folder-media.server.ts` exports `fetchAdminFolderMedia(folderCache, mediaCache): Promise<AdminFileItem[]>`. Reads `folder/v1` (returns `[]` if missing), iterates uuids in parallel via `mediaCache.lookup`, drops missing entries, returns items in folder-snapshot order.
- [ ] Each item carries `thumbUrl = buildThumbUrl(meta.code, '320x320')`; `kind` derived from `meta.kind` (image/video — `'other'` not possible here because the cron filters non-media). Reuse the existing `AdminFileItem` shape.
- [ ] `lib/admin/folder-media.ts` exports `getAdminFolderMedia` createServerFn — admin-gated, wires stores, returns `{ status: 'ok', items }`.
- [ ] No pCloud imports anywhere in the module.

**Verification:**

- [ ] `pnpm test -- src/lib/admin/folder-media.server` — covers: empty folder snapshot, normal fetch, missing media-cache entries dropped silently.
- [ ] `pnpm type-check` passes.

**Dependencies:** Task 1 (shares `AdminFileItem`).

**Files likely touched:**

- `src/lib/admin/folder-media.server.ts` (new)
- `src/lib/admin/folder-media.ts` (new)
- `src/lib/admin/folder-media.server.test.ts` (new)

**Estimated scope:** S (3 small files, pure blob reads).

---

### Phase 3: UI components

#### Task 4: Update `CollectionItemsGrid` to uuid-keyed shape

**Description:** Switch from fileid-keyed to uuid-keyed. Caller passes `pending: ReadonlySet<string>` and `onRemove: (uuid: string) => void`.

**Acceptance criteria:**

- [ ] Component prop types use `uuid` (string) instead of `fileid` (number) for the per-item key and the remove callback.
- [ ] React `key` prop is `item.uuid`.
- [ ] No fileid in the rendered DOM (the new AdminFileItem shape has no fileid, so this is structural).
- [ ] Existing browser test (`CollectionItemsGrid.browser.test.tsx`) updated to assert uuid-based interactions.

**Verification:**

- [ ] `pnpm test:browser -- CollectionItemsGrid` passes.

**Dependencies:** Task 1 (new AdminFileItem shape).

**Files likely touched:**

- `src/components/CollectionItemsGrid.tsx`
- `src/components/CollectionItemsGrid.browser.test.tsx`

**Estimated scope:** S.

---

#### Task 5: Add `AdminCollectionGrid.tsx` — uuid-keyed multi-select picker

**Description:** Re-introduce the v11-style multi-select grid component (deleted in v12). Renders `AdminFileItem[]` as square tiles with check-overlay; tiles already in the collection are `aria-disabled` and excluded from selection; sticky footer with `Guardar (N)` / `Cancelar` (hidden when N=0). Selection state lives in the parent route.

**Acceptance criteria:**

- [ ] Props: `items: readonly AdminFileItem[]`, `picked: ReadonlySet<string>`, `blocked: ReadonlySet<string>` (uuids already in collection), `onToggle: (uuid: string) => void`, `onSave: (uuids: readonly string[]) => void`, `onCancel: () => void`, `saving?: boolean`.
- [ ] Blocked tiles render dimmed + `aria-disabled='true'` + non-interactive (no onClick).
- [ ] Save button shows `Guardar (N)` where N = picked.size; disabled when N=0 or `saving`.
- [ ] Cancel clears `picked` via `onCancel`; hidden when N=0.
- [ ] Browser test: render with 3 items, 1 blocked, 1 picked → assert picked count=1, blocked has aria-disabled, Save click forwards uuids.

**Verification:**

- [ ] `pnpm test:browser -- AdminCollectionGrid` passes.

**Dependencies:** Task 1, Task 4.

**Files likely touched:**

- `src/components/AdminCollectionGrid.tsx` (new)
- `src/components/AdminCollectionGrid.browser.test.tsx` (new)

**Estimated scope:** M.

---

### Phase 4: Admin route

#### Task 6: Rewire `/admin/collection.tsx` to the blob-backed surface

**Description:** Loader drops `getAdminSourceFolder` and any `?folderid=` search param. Calls `getCollectionMedia()` + `getAdminFolderMedia()` in parallel. Renders `CollectionItemsGrid` (uuid-keyed) on top and `AdminCollectionGrid` (flat picker) below. Save/remove handlers call the renamed server-fns with `{ uuids }`. Removes the "04:00 UTC" banner and the `UnconfiguredBanner` (no env var to misconfigure).

**Acceptance criteria:**

- [ ] `validateSearch` and `loaderDeps` removed (route no longer takes search params).
- [ ] Loader: `Promise.all([getCollectionMedia(), getAdminFolderMedia()])`.
- [ ] Picker filters out uuids already in `collectionItems` via the `blocked` set.
- [ ] `handleSave` calls `addToCollection({ data: { uuids } })`.
- [ ] `handleRemove(uuid)` calls `removeFromCollection({ data: { uuids: [uuid] } })`.
- [ ] Both handlers `router.invalidate()` on success.
- [ ] `Alert.Root` with the "04:00 UTC" copy is gone.
- [ ] `UnconfiguredBanner`, `SourceFolderMissingBanner`, `FolderNotPermittedBanner` are gone.
- [ ] No references to `getAdminSourceFolder`, `AdminFolderNavigator`, `?folderid` anywhere in the file.

**Verification:**

- [ ] `pnpm dev:netlify` → `/admin/collection` renders without errors. Picking a tile and clicking Save updates the top grid on `router.invalidate()`. Removing a tile updates the picker's blocked set on next invalidate.
- [ ] `pnpm type-check` passes.

**Dependencies:** Tasks 2, 3, 4, 5.

**Files likely touched:**

- `src/routes/admin/collection.tsx` (substantially rewritten — likely shorter)

**Estimated scope:** M.

---

### Checkpoint: Admin path end-to-end

- [ ] `pnpm type-check` clean.
- [ ] `pnpm test:unit` clean.
- [ ] `pnpm test:browser` clean.
- [ ] Manual: `pnpm dev:netlify`, log in as admin, navigate to `/admin/collection`. Empty state renders without crashes. Pick a tile, Save → top grid shows it within a render cycle. Remove → top grid drops it, picker's blocked set drops it.
- [ ] Manual: open `/` — surfaced memories now respect the curated set immediately (no need to invoke cron).
- [ ] Manual: clear the blob via Netlify Blobs UI → `/` falls back to folder snapshot (v17 cold-blob behavior preserved).

---

### Phase 5: Cron + env cleanup

#### Task 7: Strip the collection-snapshot pass from `refreshMemories`

**Description:** Remove the optional 7th `collectionOpts` parameter, the `refreshCollectionSnapshot` helper, the `CollectionOpts` / `CollectionStats` / `CollectionDetailsResponse` types, and the `collectionStats` field on `RefreshResult`. The function signature drops to its v11-minus shape.

**Acceptance criteria:**

- [ ] `refreshMemories(client, folderId, mediaCache, fileidIndex, folderCache, geocodeOpts?)` is the new signature.
- [ ] `RefreshResult` has no `collectionStats` field.
- [ ] All references to `CollectionCache`, `CollectionOpts`, `CollectionStats`, `collection_details` in `refresh-memories.server.ts` are deleted.
- [ ] No import of `pcloud-kit`'s `FileMetadata` solely for collection contents.

**Verification:**

- [ ] `pnpm test -- src/lib/memories/refresh-memories.server` — update existing tests; ensure no collection assertions remain.
- [ ] `pnpm type-check` passes.

**Dependencies:** None (independent of admin path).

**Files likely touched:**

- `src/lib/memories/refresh-memories.server.ts`
- `src/lib/memories/refresh-memories.server.test.ts`

**Estimated scope:** S–M.

---

#### Task 8: Strip collection wiring from the Netlify scheduled function

**Description:** Drop the `collectionId` / `adminToken` env-var reads, the `collectionCache` construction, the second pCloud client built from `PCLOUD_ADMIN_AUTH`, the `collectionOpts` argument, and the `collection: linked=… alive=… missing=…` log line.

**Acceptance criteria:**

- [ ] `getEnvConfig()` returns `{ token, folderId }` only.
- [ ] `createCollectionCache` / `getCollectionCacheStore` imports gone.
- [ ] Second `createClient({ token: adminToken, type: 'pcloud' })` gone.
- [ ] The `if (result.collectionStats)` log block gone.
- [ ] `refreshMemories(...)` is called with the new 5/6-arg signature.

**Verification:**

- [ ] `pnpm build` succeeds (delete `dist/` and `.netlify/blobs-serve` before re-running per CLAUDE.md).
- [ ] `pnpm invoke:refresh-memories` against `pnpm dev:netlify` runs end-to-end and logs the trimmed summary (no `collection:` line).

**Dependencies:** Task 7.

**Files likely touched:**

- `netlify/functions/refresh-memories.ts`

**Estimated scope:** S.

---

### Phase 6: Demolition

#### Task 9: Delete v12 source-folder navigator + related code

**Description:** Remove every file whose sole purpose was the v12 navigator. Verify no remaining references via grep.

**Acceptance criteria:**

- [ ] Deleted: `src/lib/admin/source-folder.ts`, `src/lib/admin/source-folder.server.ts`, `src/lib/admin/source-folder.server.test.ts`.
- [ ] Deleted: `src/components/AdminFolderNavigator.tsx`, `src/components/AdminFolderNavigator.browser.test.tsx`.
- [ ] `grep -rn 'source-folder\|AdminFolderNavigator\|PCLOUD_SOURCE_FOLDER_ID\|PCLOUD_ADMIN_AUTH\|PCLOUD_COLLECTION_ID' src/ netlify/ test/ __mocks__/` returns nothing in the working tree.
- [ ] `routeTree.gen.ts` does not need regen (no route deleted); `pnpm dev` will surface any leftover imports if present.

**Verification:**

- [ ] `pnpm type-check` passes.
- [ ] `pnpm lint` passes (no unused imports).
- [ ] `pnpm test` passes.

**Dependencies:** Task 6 (route no longer references the deleted modules).

**Files likely touched:**

- 5 files deleted; no new files.

**Estimated scope:** S.

---

#### Task 10: Update `SPEC.md` with v13

**Description:** Append §23 (v13 Acceptance Criteria) and §24 (v12 → v13 changes summary). Update §7 Boundaries: the cron is no longer the writer of `collection/v1`; the admin route is. Update §4 Project Structure to reflect the deleted + new files.

**Acceptance criteria:**

- [ ] §23 covers: storage shape unchanged; admin-only writer; loader unchanged; picker scope (flat over folder snapshot); env-var cleanup; UTC banner removed; no `collection_*` calls anywhere.
- [ ] §7 "Always do" bullet about cron writers no longer lists `collection/v1` — only `media/<uuid>`, `fileid-index/<fileid>`, `folder/v1`.
- [ ] §7 "Always do" gets a new bullet: the admin route at `/admin/collection` is the sole writer of `collection/v1`.
- [ ] §7 "Never do": tighten to "never call any pCloud `collection_*` endpoint — the curated set lives in Netlify Blobs."
- [ ] §4 reflects: removed `source-folder.{ts,server.ts}`, `AdminFolderNavigator.tsx`; added `folder-media.{ts,server.ts}`, `AdminCollectionGrid.tsx`. `collection.{ts,server.ts}` description updated.
- [ ] §8 Open Questions: add a §8.9 noting curation storage = Netlify Blobs (admin-owned), resolved in v13.

**Verification:**

- [ ] Read SPEC.md top-to-bottom; cross-reference paths against actual files in `src/`.

**Dependencies:** Tasks 1–9 (so the doc matches reality).

**Files likely touched:**

- `SPEC.md`

**Estimated scope:** S.

---

### Phase 7: Final verification

#### Task 11: Full CI gate + smoke

**Description:** Run the full CI matrix locally, then smoke the deploy preview.

**Acceptance criteria:**

- [ ] `pnpm install` clean (no env var warnings about `PCLOUD_ADMIN_AUTH` / `PCLOUD_COLLECTION_ID` / `PCLOUD_SOURCE_FOLDER_ID`).
- [ ] `pnpm type-check` passes.
- [ ] `pnpm test` (both projects) passes.
- [ ] `pnpm lint` clean.
- [ ] `pnpm format:check` clean.
- [ ] `pnpm build` succeeds (run `rm -rf dist .netlify/blobs-serve` first per CLAUDE.md).
- [ ] On the deploy preview: provision `PCLOUD_TOKEN` + `PCLOUD_MEMORIES_FOLDER_ID` (+ optional `GEOAPIFY_API_KEY`). Confirm no `PCLOUD_ADMIN_AUTH` / `PCLOUD_COLLECTION_ID` / `PCLOUD_SOURCE_FOLDER_ID` are referenced. Trigger the cron once; visit `/admin/collection`; curate; visit `/` — curated items render without waiting for the cron.

**Verification:**

- [ ] `curl -I` the deploy-preview `/` and confirm `Cache-Control: private` (or `no-store`) is still set — unchanged invariant from §7.

**Dependencies:** Tasks 1–10.

**Files likely touched:** None (verification only).

**Estimated scope:** XS.

---

### Checkpoint: Ready for merge

- [ ] All tasks complete.
- [ ] Manual smoke on deploy preview passes (curate → home page reflects immediately).
- [ ] `pnpm test` / `type-check` / `lint` / `format:check` / `build` all green locally and on CI.
- [ ] SPEC.md v13 section reads accurately against the working tree.
- [ ] Branch is `v13-blob-curation` (or similar), targets `main` via PR.

## Risks and Mitigations

| Risk                                                                                                                            | Impact | Mitigation                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing `collection/v1` in production blob is stale (last written by the v12 cron sync)                                        | Med    | First admin save overwrites it via read-modify-write; old uuids that are no longer alive get filtered out by the loader. Optionally clear via Netlify Blobs UI pre-merge, not required. |
| Stale uuids accumulate in blob after pCloud file deletions                                                                      | Low    | Loader filters silently; SPEC documents the trade-off. If it ever matters, add an opt-in admin "limpiar" action later.                                                                  |
| Browser test for `AdminCollectionGrid` is the first new browser test for v13 — could break Vitest browser project config        | Low    | Mirror the existing `CollectionItemsGrid.browser.test.tsx` setup; no new tooling.                                                                                                       |
| Cron's `refreshMemories` test file is wide — risk of accidentally breaking unrelated assertions while stripping collection bits | Med    | Run `pnpm test -- src/lib/memories/refresh-memories.server` after every edit; review the diff before commit.                                                                            |
| `pcloud-kit` `Client` type still imported by some collection-adjacent code                                                      | Low    | Final grep step in Task 9; type-check would also surface dangling references.                                                                                                           |
| Admin user expects "Añadir más" to navigate folders (v12 muscle memory)                                                         | Low    | v13 is a deliberate UX reset to the v11 shape; user already confirmed the picker scope.                                                                                                 |

## Open Questions

- **None.** The three clarifying questions (picker scope, stale GC, UTC banner) were answered before the plan was finalized.

## Parallelization

- **Sequential within Phase 1 / 2 / 3**: each task in a phase consumes the previous task's output types.
- **Phase 5 (cron cleanup)** is independent of Phases 1–4 and can be done in parallel — same branch, separate commits. The build only fails together at integration time.
- **Phase 6 (demolition)** must be last (Tasks 9, 10) — depends on Tasks 6 and 8 to no longer reference the deleted code.
