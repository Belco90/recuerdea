# Implementation Plan: v14 — Source-folder navigator for the admin picker

## Overview

v13 shipped the blob-backed curation storage but with the wrong picker — a flat grid of cached memories-folder items. The intended "Añadir más" UX is the v12-style **navigable view of `PCLOUD_SOURCE_FOLDER_ID`**: breadcrumbs, sub-folder grid, file grid, multi-select that survives navigation. v14 restores that navigator on top of v13's storage.

Because the source folder can extend beyond `PCLOUD_MEMORIES_FOLDER_ID`, the picker can offer files the cron has not snapshotted. v14 lazy-mints those on save (`stat(fileid) + getfilepublink(fileid)` → uuid → write `media/<uuid>` + `fileid-index/<fileid>` → append to `collection/v1`). No range-fetch extraction on the save path; the lazy-minted entry's `width / height / location / place` stay `null`. The cron's sweep is updated to spare every uuid currently in the collection blob so lazy-minted-but-non-memories files survive future runs.

The home loader and the curated-grid section are untouched.

## Architecture decisions

- **Two AdminFileItem variants.**
  - `CollectionItem = { uuid, fileid, name, kind, thumbUrl }` — current-collection grid. Carries `fileid` so the route can compute the `blocked` set the navigator needs (intersect "files already in collection" with "files visible in this source-folder page").
  - `SourceFileItem = { fileid, name, kind, thumbUrl }` — source-folder listing. No uuid yet — file may not have been minted.
- **Wire format for save: fileids.** `addToCollection({ fileids: number[] })`. Server resolves each fileid → uuid via `fileid-index`; lazy-mints if missing. The blob still stores uuids — loader path unchanged.
- **Lazy-mint scope.** Two pCloud calls per new file: `stat(fileid)` (hash, contenttype, name, created) and `getfilepublink(fileid)` (code, linkid). No range-fetch extractor → width/height/location stay null; place stays null. Acceptable trade-off — UI degrades gracefully. Geocoding only runs for memories-folder files; curated-outside-memories items will permanently render without a place caption until a future v15 widens cron coverage.
- **Cron sweep reads `collection/v1` (read-only).** After listing the memories folder, the cron unions the curated uuids into the alive set before computing `staleUuids`. Curated-but-non-memories uuids no longer get swept. Reads-only: the admin route remains the sole **writer** of `collection/v1`, preserving the §7 single-writer invariant.
- **`PCLOUD_SOURCE_FOLDER_ID` returns.** Required for the admin route. Loader returns a tagged `{ status: 'source-folder-id-missing' }` result and the route renders a banner.
- **`PCLOUD_TOKEN` covers the navigator's `listfolder` + `getthumbslinks` + lazy-mint `stat` + `getfilepublink` calls.** All work with OAuth. `PCLOUD_ADMIN_AUTH` stays gone.

### What stays vs. what changes vs. what goes

| Surface | Status |
|---|---|
| `collection-cache` blob + storage shape | **Stays.** Same `{ refreshedAt, uuids[] }`. |
| `fetchTodayMemories` (loader) | **Stays — unchanged.** |
| `AdminFileItem = { uuid, name, kind, thumbUrl }` (v13) | **Renamed/split** → `CollectionItem` (uuid + fileid) and `SourceFileItem` (fileid only). |
| `CollectionItemsGrid` | **Stays — minor prop type update** to `CollectionItem`. Still uuid-keyed for React + onRemove. |
| `lib/admin/folder-media.{ts,server.ts}` (v13) | **Deleted.** Superseded by the source-folder navigator. |
| `components/AdminCollectionGrid.tsx` (v13) | **Deleted.** Superseded by `AdminFolderNavigator`. |
| `lib/admin/source-folder.{ts,server.ts}` | **Restored** from the v12 design, with the auth client switched to `PCLOUD_TOKEN`. |
| `components/AdminFolderNavigator.tsx` | **Restored** from the v12 design, with the wire format using `SourceFileItem.fileid`. |
| `collection.ts` `addToCollection` server-fn | **Wire shape: `{ fileids: number[] }`.** Server resolves to uuids (lazy-mint as needed). |
| `collection.ts` `removeFromCollection` server-fn | **Unchanged — still `{ uuids: string[] }`** (removed items always have a uuid). |
| `refreshMemories` cron | **Sweep updated** to spare curated uuids. New 7th optional arg `collectionReader?: { lookup: () => Promise<CollectionSnapshot | undefined> }`. |
| `netlify/functions/refresh-memories.ts` | **Reads `collection-cache`** (read-only) and passes the reader into `refreshMemories`. |
| `PCLOUD_SOURCE_FOLDER_ID` env var | **Restored.** Required for `/admin/collection`. |
| `PCLOUD_ADMIN_AUTH`, `PCLOUD_COLLECTION_ID` env vars | **Stay gone.** Not needed. |

## Dependency graph

```
lib/admin/source-folder.server.ts       (restored — listfolder + breadcrumbs)
    └── lib/admin/source-folder.ts      (server-fn; auth-gated; uses PCLOUD_TOKEN)
            └── /admin/collection route loader

collection-cache (blob, read-only by cron) ──┐
                                             │
lib/admin/collection.server.ts (v13)         │
    + lazyMintFile(client, fileid, ...)      │
    + addFileidsToCollection(...)            │
    └── lib/admin/collection.ts              │
            └── /admin/collection route handlers
                                             │
refreshMemories sweep ───────────────────────┘  (reads collection blob to spare curated uuids)
```

## Task list

### Phase 1: Source-folder data path

#### Task 1: Restore `lib/admin/source-folder.{ts,server.ts}` (+ tests)

**Description:** Re-add the v12 source-folder module, lightly adapted: `SourceFileItem = { fileid, name, kind, thumbUrl }` (no uuid yet), and the server-fn uses `PCLOUD_TOKEN` (OAuth) instead of the dropped `PCLOUD_ADMIN_AUTH`.

**Acceptance criteria:**
- [ ] `source-folder.server.ts` exports `fetchAdminSourceFolder(client, { folderid? })`, `assertSourceFolderId()`, `SourceFolderIdMissingError`, `FolderNotPermittedError`, `AdminFolderListing = { folderid, name, breadcrumbs, subfolders, files: SourceFileItem[] }`.
- [ ] `source-folder.ts` exports `getAdminSourceFolder` server-fn: admin-gated; builds the client from `PCLOUD_TOKEN`; returns `{ status: 'ok' | 'source-folder-id-missing' | 'folder-not-permitted', ... }`.
- [ ] Breadcrumb walk stops at source root, pCloud root (folderid 0), or depth 10.
- [ ] Files: media only (`image/*` | `video/*`); thumbs batched via `getthumbslinks` (320x320 jpg, crop=1).
- [ ] Tests cover: empty folder, root listing, nested navigation, breadcrumb walk, FolderNotPermittedError, SourceFolderIdMissingError, thumbs response with missing entries.

**Verification:**
- [ ] `pnpm test -- src/lib/admin/source-folder.server` green.
- [ ] `pnpm type-check` clean.

**Dependencies:** None.

**Files likely touched:**
- `src/lib/admin/source-folder.server.ts` (new — modeled on the v12 deletion)
- `src/lib/admin/source-folder.ts` (new — same)
- `src/lib/admin/source-folder.server.test.ts` (new — based on the v12 deletion, drop any PCLOUD_ADMIN_AUTH refs)

**Estimated scope:** M (3 files, mostly restoration from git history).

---

### Phase 2: Navigator component

#### Task 2: Restore `components/AdminFolderNavigator.tsx` (+ browser test)

**Description:** Re-add the v12 navigator: breadcrumbs row → subfolder grid → file grid → sticky `Guardar (N)` / `Cancelar` footer. Multi-select state lives in the parent route and persists across navigation. Wire format: `fileid: number`.

**Acceptance criteria:**
- [ ] Props: `listing: AdminFolderListing`, `picked: ReadonlySet<number>`, `blocked: ReadonlySet<number>`, `onNavigate: (folderid) => void`, `onToggle: (fileid) => void`, `onSave: (fileids) => void`, `onCancel: () => void`, `saving?: boolean`.
- [ ] Blocked tiles dimmed + `aria-disabled='true'` + non-interactive.
- [ ] Save button: `Guardar (N)`; toggles to `Guardando…` and disables while `saving`.
- [ ] Save/Cancel footer hidden when N=0.
- [ ] Sub-folder tiles trigger `onNavigate(folderid)`; file tiles trigger `onToggle(fileid)`.
- [ ] Browser test asserts: navigation click forwards folderid, file click forwards fileid, blocked tile aria-disabled + ignores click, saving disables Save.

**Verification:**
- [ ] `pnpm test:browser -- AdminFolderNavigator` green.

**Dependencies:** Task 1 (`AdminFolderListing` type).

**Files likely touched:**
- `src/components/AdminFolderNavigator.tsx` (new — modeled on the v12 deletion)
- `src/components/AdminFolderNavigator.browser.test.tsx` (new)

**Estimated scope:** M.

---

### Phase 3: Save path — fileid → uuid resolution + lazy-mint

#### Task 3: `collection.server.ts` — `CollectionItem` shape + `addFileidsToCollection` with lazy-mint

**Description:**
1. Update the curated-item type: `CollectionItem = { uuid, fileid, name, kind, thumbUrl }` (was `AdminFileItem` with just uuid). `fetchCuratedItems` populates `fileid` from `media.fileid`.
2. Add `lazyMintFile(client, fileidIndex, mediaCache, fileid): Promise<string>` — server-side helper that returns the uuid (existing or freshly minted). For an unknown fileid: calls `stat(fileid)` + `getfilepublink(fileid)`, mints a uuid, writes `media/<uuid>` (no extraction → `width=height=location=place=null`, `captureDate` parsed from `file.created`) and `fileid-index/<fileid>`.
3. Add `addFileidsToCollection(client, fileidIndex, mediaCache, collectionCache, fileids): Promise<void>` — resolves each fileid via `lazyMintFile`, then read-modify-writes the collection blob with the deduped uuid set.
4. `addUuidsToCollection` is **removed** — the wire shape only takes fileids now.
5. `removeUuidsFromCollection` is unchanged.

**Acceptance criteria:**
- [ ] `CollectionItem` exported with `fileid` field; `fetchCuratedItems` populates it from `meta.fileid`.
- [ ] `lazyMintFile` short-circuits when `fileid-index` already has the fileid (returns the existing uuid; no pCloud calls).
- [ ] On lazy-mint: exactly one `stat({ fileid })` and one `getfilepublink({ fileid })` call; no `getfilelink` or extractor calls.
- [ ] Lazy-minted `CachedMedia`: `fileid/hash/code/linkid/kind/contenttype/name/captureDate` populated; `width=height=null`, `location=null`, `place=null`.
- [ ] `addFileidsToCollection` validates: non-empty array of positive integers; throws `TypeError` otherwise.
- [ ] Tests cover: known-fileid short-circuit, unknown-fileid mint, mixed batch, dedup, validation errors, error when `stat` fails.

**Verification:**
- [ ] `pnpm test -- src/lib/admin/collection.server` green.
- [ ] `pnpm type-check` clean.

**Dependencies:** None (but supersedes some v13 helpers).

**Files likely touched:**
- `src/lib/admin/collection.server.ts`
- `src/lib/admin/collection.server.test.ts`

**Estimated scope:** M.

---

#### Task 4: `collection.ts` server-fn wire-format change

**Description:** `addToCollection` validator switches from `{ uuids: string[] }` to `{ fileids: number[] }`. The handler builds the OAuth pCloud client (from `PCLOUD_TOKEN`) plus the three store wrappers and calls `addFileidsToCollection`. `removeFromCollection` unchanged.

**Acceptance criteria:**
- [ ] `addToCollection` input validator: `{ fileids: readonly number[] }`; rejects empty arrays, non-integers, non-positives.
- [ ] Handler imports `createClient` from `pcloud-kit`, reads `PCLOUD_TOKEN`, wires `fileidIndex`/`mediaCache`/`collectionCache` stores, calls `addFileidsToCollection`.
- [ ] `removeFromCollection` handler unchanged.
- [ ] `CollectionMediaResult` carries the new `CollectionItem[]`.

**Verification:**
- [ ] `pnpm type-check` clean.
- [ ] Manual on `pnpm dev:netlify`: a POST to the add server-fn with a valid fileid succeeds; the file appears in `getCollectionMedia` immediately.

**Dependencies:** Task 3.

**Files likely touched:**
- `src/lib/admin/collection.ts`

**Estimated scope:** S.

---

### Phase 4: Cron sweep protection

#### Task 5: `refreshMemories` sweep reads the collection blob

**Description:** Add an optional `collectionReader?: { lookup(): Promise<CollectionSnapshot | undefined> }` parameter to `refreshMemories`. When provided, the sweep unions curated uuids into the alive set so they're never marked stale. Reads-only: nothing writes to `collection/v1`.

**Acceptance criteria:**
- [ ] New `CollectionReader` type (subset of `CollectionCache` — only `lookup`).
- [ ] `refreshMemories(client, folderId, mediaCache, fileidIndex, folderCache, geocodeOpts?, collectionReader?)` — collection reader is optional 7th arg.
- [ ] Sweep: `protectedSet = new Set([...aliveUuids, ...(curatedUuids ?? [])])`; `staleUuids = allCachedUuids.filter(u => !protectedSet.has(u))`.
- [ ] When `collectionReader` is absent or returns undefined, sweep behavior is identical to v13.
- [ ] Tests cover: no reader → unchanged; reader returns undefined → unchanged; reader returns curated uuids → those uuids are spared from sweep even when not in the memories folder; reader returns empty list → sweep is unchanged.

**Verification:**
- [ ] `pnpm test -- src/lib/memories/refresh-memories.server` green.

**Dependencies:** None.

**Files likely touched:**
- `src/lib/memories/refresh-memories.server.ts`
- `src/lib/memories/refresh-memories.server.test.ts`

**Estimated scope:** M.

---

#### Task 6: Scheduled function wires the collection reader

**Description:** `netlify/functions/refresh-memories.ts` builds a `CollectionCache` (via the existing factories) and passes its `lookup` into `refreshMemories` as the read-only collection reader.

**Acceptance criteria:**
- [ ] Imports `createCollectionCache` + `getCollectionCacheStore` again (removed in v13 T8).
- [ ] `refreshMemories(...)` call passes a `{ lookup: collectionCache.lookup }` 7th arg.
- [ ] No writes to `collection/v1` from this file (no `remember` call).

**Verification:**
- [ ] `pnpm invoke:refresh-memories` against `pnpm dev:netlify` runs end-to-end. Spec-required log lines unchanged.
- [ ] `pnpm build` clean (after `rm -rf dist .netlify/blobs-serve`).

**Dependencies:** Task 5.

**Files likely touched:**
- `netlify/functions/refresh-memories.ts`

**Estimated scope:** XS.

---

### Phase 5: Admin route rewires

#### Task 7: `/admin/collection.tsx` uses the navigator with `?folderid=` search param

**Description:** Loader fan-outs to `getCollectionMedia` + `getAdminSourceFolder({ folderid })`. Drop the v13 flat-grid path. Add the v12 `validateSearch` + `loaderDeps` for `?folderid`. Picker state holds `picked: Map<fileid, SourceFileItem>` so navigation across folders preserves picks. Handlers send fileids to `addToCollection`; remove still sends uuid via `removeFromCollection`. Compute `blocked: Set<fileid>` from `collectionItems.map(m => m.fileid)`.

**Acceptance criteria:**
- [ ] Search param: `?folderid=N` (validated as non-negative integer, default unset).
- [ ] Loader: `Promise.all([getCollectionMedia(), getAdminSourceFolder({ data: { folderid: deps.folderid } })])`.
- [ ] `blocked` is `new Set(collectionItems.map(m => m.fileid))`.
- [ ] `handleNavigate(folderid)` → `router.navigate({ to, search: { folderid } })`.
- [ ] `handleToggle(fileid)` flips Map entry using metadata from `source.listing.files`.
- [ ] `handleSave(fileids)` → `addToCollection({ data: { fileids } })` + `setPicked(new Map())` + `router.invalidate()`.
- [ ] Banners restored: `SourceFolderMissingBanner` / `FolderNotPermittedBanner`.
- [ ] Banner "Los cambios aparecen inmediatamente en la página principal" replaces the dropped 04:00 UTC banner (v13 made edits instant — copy reflects that).

**Verification:**
- [ ] `pnpm dev:netlify` smoke: navigate folders, pick across folders, save, current-collection grid updates without a full reload; remove tile drops it from the blocked set.

**Dependencies:** Tasks 1, 2, 3, 4.

**Files likely touched:**
- `src/routes/admin/collection.tsx`

**Estimated scope:** M.

---

### Checkpoint: end-to-end navigator path

- [ ] `pnpm type-check` clean.
- [ ] `pnpm test:unit` green.
- [ ] `pnpm test:browser` green.
- [ ] Manual: `/admin/collection` loads source root; navigating into a subfolder updates the URL `?folderid=…`; picks survive navigation; Save adds them to the curated grid; Remove drops a curated tile.
- [ ] Manual: a file outside `PCLOUD_MEMORIES_FOLDER_ID` can be picked → save succeeds → file appears on the curated grid → cron run does not sweep it.

---

### Phase 6: Demolition

#### Task 8: Delete v13's flat-grid path

**Description:** Remove the v13 picker pieces that are now superseded.

**Acceptance criteria:**
- [ ] Deleted: `src/lib/admin/folder-media.ts`, `src/lib/admin/folder-media.server.ts`, `src/lib/admin/folder-media.server.test.ts`.
- [ ] Deleted: `src/components/AdminCollectionGrid.tsx`, `src/components/AdminCollectionGrid.browser.test.tsx`.
- [ ] `grep -rn 'folder-media\|AdminCollectionGrid\|addUuidsToCollection' src/ netlify/ test/ __mocks__/` returns nothing.

**Verification:**
- [ ] `pnpm type-check` clean.
- [ ] `pnpm test` green.

**Dependencies:** Task 7.

**Files likely touched:** 5 files deleted.

**Estimated scope:** S.

---

### Phase 7: SPEC + verification

#### Task 9: SPEC.md — add §25 (v14 AC) + §26 (v13 → v14 diff)

**Description:** Document v14: navigator restored, fileid wire format, lazy-mint, cron sweep protection. Update §7 boundaries: the cron is now a reader of `collection/v1` but still not a writer.

**Acceptance criteria:**
- [ ] §25 covers: navigator shape, source-folder env var restored, fileid wire format on `addToCollection`, lazy-mint behavior + skipped extraction, cron sweep union, single-writer invariant preserved (admin route is sole writer).
- [ ] §26 diff vs. v13: picker scope flipped (was flat memories-cache grid, now source-folder navigator); `addToCollection` wire shape switched from uuids to fileids; `PCLOUD_SOURCE_FOLDER_ID` env var returns.
- [ ] §7 "Always do" — clarify cron is **sole writer** of `media/*` + `fileid-index/*` + `folder/v1` and a **read-only consumer** of `collection/v1`.
- [ ] §7 "Never do" — keep the "no pCloud `collection_*`" rule from v13.
- [ ] §23 (v13) annotated as superseded by §25 for the picker scope; the storage portion of v13 is still current.

**Verification:**
- [ ] SPEC reads top-to-bottom; file paths cross-check against the working tree.

**Dependencies:** Tasks 1–8.

**Files likely touched:**
- `SPEC.md`

**Estimated scope:** S.

---

#### Task 10: CI gate + deploy-preview smoke

**Description:** Full local gate + deploy-preview confirmation.

**Acceptance criteria:**
- [ ] `pnpm type-check`, `pnpm test`, scoped `oxlint`, `pnpm format:check`, `pnpm build` all clean.
- [ ] Deploy preview: provision `PCLOUD_TOKEN`, `PCLOUD_MEMORIES_FOLDER_ID`, `PCLOUD_SOURCE_FOLDER_ID` (+ optional `GEOAPIFY_API_KEY`). Trigger the cron once. Navigate `/admin/collection`, pick from a subfolder outside memories, save, confirm `/` shows it immediately (no cron required).
- [ ] After save, manually run the cron a second time — confirm the curated-outside-memories uuid survives the sweep.
- [ ] `curl -I` the deploy-preview `/` → `Cache-Control: private` or `no-store`.

**Dependencies:** Tasks 1–9.

**Estimated scope:** XS.

---

### Final checkpoint

- [ ] All checkpoints passed.
- [ ] PR open targeting `main`.
- [ ] SPEC.md matches the working tree.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Lazy-mint races with the cron (both write `media/<uuid>` for the same fileid at once) | Med | Single-user app; concurrent admin save + cron is extremely unlikely. If it happens, last-write-wins on the per-uuid blob; cron pass would just overwrite with extracted dimensions/location. Not data-loss; just timing. |
| Lazy-minted files outside the memories folder never get extracted | Low | Spec'd as a v14 limitation. UI handles null fields. v15 can widen cron coverage. |
| Cron sweep reads collection blob, breaking the "cron doesn't touch collection" rule from v13 | Low | The rule was "doesn't **write**"; read-only is fine. Spec §25 updates §7 wording to make this explicit. |
| User picks a fileid that no longer exists in pCloud (deleted between listfolder and save) | Low | `stat()` returns an error → lazy-mint throws → the admin save reports a server error. Acceptable for the rare edge case. |
| `getthumbslinks` rate limit on large source folders | Low | pCloud's documented threshold is high; the v12 navigator already batched. Same behavior in v14. |
| v13 `AdminFileItem` references in other files | Low | Type rename surfaces every consumer via type-check; fix progressively. Two known consumers: `CollectionItemsGrid` (route loader output → prop type) and the route itself. |

## Parallelization

- Phases 1, 2, 3 are mostly independent; can be developed in parallel branches but committed in dependency order.
- Phase 4 (cron) is fully independent of Phases 1–3; can land any time.
- Phases 5, 6, 7 are sequential.

## Open questions

- **None.** Both clarifying questions (lazy-mint vs reject; cron coverage for curated-outside-memories) were answered before the plan was finalized.
