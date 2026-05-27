# Implementation Plan: Admin Collection v2 — split auth, source-folder navigation, decoupled from memories

## Context

v11 shipped a working admin curation panel, but real-world bring-up revealed
three architectural mismatches that this rev addresses:

1. **Auth scope.** The OAuth token used by the cron (`PCLOUD_TOKEN`) was
   provisioned for read-side methods (listfolder, getfilelink, thumbs) and is
   unreliable for `collection_*` mutations — pCloud's `collection_create`
   smoke test returned `result: 1000 "Log in required"` against the OAuth
   token until the curator switched to a pCloud-native auth token. Going
   forward, **all `collection_*` calls** (admin route _and_ cron's
   `collection_details`) must use a separate `PCLOUD_ADMIN_AUTH` token with
   `createClient({ token, type: 'pcloud' })`.
2. **Data source for the admin grid.** The current `/admin/collection`
   reads the public-side `folder/v1` + `media/<uuid>` caches, which are
   populated by the memories cron over `PCLOUD_MEMORIES_FOLDER_ID`. The
   curator wants to add **arbitrary files from a separate, navigable folder
   tree** — `PCLOUD_SOURCE_FOLDER_ID` — that may contain subfolders, may
   include files outside the memories scope, and must work even when the
   cron has not yet run.
3. **Decoupling.** The admin view must not depend on the memories pipeline.
   `collection_details` should return file metadata that the admin renders
   directly (no uuid round-trip), and the source-folder browser should hit
   pCloud live (no Blobs cache reads). The memories cache remains the
   exclusive data source for `/` and the cron's collection-cache.

The home page's read path (cron writes `collection/v1`, `fetchTodayMemories`
intersects with `folder/v1`) is **unchanged in shape** — only the cron's
authorization for `collection_details` shifts to the admin token. Date
filter, fallback behavior, and the empty-collection semantics from §15/§17/§19
are preserved.

## Architecture Decisions

- **Two pCloud clients on the server.** `PCLOUD_TOKEN` (OAuth) continues to
  drive `listfolder`, `getfilelink`, thumb URLs, EXIF extraction — every
  non-collection method. `PCLOUD_ADMIN_AUTH` (pCloud-native `auth=` token,
  `type: 'pcloud'`) drives every `collection_*` call. The two clients live
  side-by-side; the cron creates both and passes them where appropriate.
  Single-token simplicity is sacrificed for a working write path.
- **`AdminFileItem` is keyed by `fileid`**, not `uuid`. The admin route
  speaks pCloud's native id everywhere — collection_details returns
  fileids, link/unlink accept fileids, listfolder returns fileids. The
  uuid is a memories-cache artifact and has no place on the admin route.
- **Source-folder navigation is search-param driven.**
  `/admin/collection?folderid=N` is the deep-linkable state. Default
  (no search param) loads `PCLOUD_SOURCE_FOLDER_ID`. The route's loader
  fetches `listAdminSourceFolder({ folderid: <current> })` which returns
  the breadcrumb chain (walked up the `parentfolderid` chain on the
  server, capped at the source root) + subfolders + files. The route
  component holds selection state as a `Map<fileid, FileSummary>` so it
  survives folder navigation (TanStack Router preserves the component
  instance when only search params change).
- **Breadcrumb walk is server-side and capped at the source root.** Walking
  up `parentfolderid` via N `listfolder({ folderid, nofiles: true })`
  calls is cheap for shallow trees (≤ 5 levels) and avoids leaking
  ancestor names above the source root. The walk stops when
  `folderid === PCLOUD_SOURCE_FOLDER_ID` or `parentfolderid` is undefined.
- **Files in the source folder grid are filtered to image/video** by
  `contenttype.startsWith('image/' | 'video/')`. Subfolders are always
  shown. The curator never needs to see PDFs or archives in the picker.
- **Thumbnails are batched.** Per page load, build a CSV of file
  fileids and call `getthumbslinks(fileids, { size: '320x320', crop: 1 })`
  via the admin client (bypass the kit's wrapper that caps at `120x120` —
  use `client.call<ThumbResult[]>('getthumbslinks', { ... })` so size is a
  free string). One round trip per folder, regardless of file count.
- **Files already in the collection are visually disabled** in the source
  grid. The route's loader runs `fetchCollectionFileids()` in parallel
  with the folder listing; the navigator receives a `Set<number>` of
  blocked fileids.
- **Selection footer is sticky.** Users navigate across multiple folders
  before saving — they need a persistent "Guardar (N)" affordance.
  When N=0 the footer hides.
- **Cron behavior preserved.** The cron still writes `folder/v1` +
  `media/<uuid>` from OAuth-authed `listfolder`. The collection-cache
  update step now uses the admin client for `collection_details`.
  Everything else is identical.

## Critical Files

**New:**

- `src/lib/admin/source-folder.server.ts` — raw
  `fetchAdminSourceFolder(client, { folderid?, sourceRootId })` →
  `{ current, breadcrumbs, subfolders, files }`. Walks the parent chain
  for breadcrumbs; filters files by image/video contenttype; batches
  `getthumbslinks` for the files in one call. Includes
  `assertSourceFolderId()` mirroring `assertCollectionId()`.
- `src/lib/admin/source-folder.ts` — `getAdminSourceFolder({ folderid? })`
  createServerFn wrapper (auth + admin gate).
- `src/components/AdminFolderNavigator.tsx` — breadcrumb header,
  subfolder tiles, file tiles with checkbox overlay, sticky selection
  footer with `Guardar (N)` + Cancelar. Composes existing Chakra
  primitives.
- `src/components/AdminFolderNavigator.browser.test.tsx` — verifies
  breadcrumb click, subfolder navigation (calls onNavigate), file
  selection toggle, save handler invocation.
- `src/lib/admin/source-folder.server.test.ts` — unit tests for the
  listfolder mapping, breadcrumb walk, image/video filter, thumb batch.

**Modified:**

- `src/env.d.ts` — add `PCLOUD_ADMIN_AUTH: string`,
  `PCLOUD_SOURCE_FOLDER_ID: string`.
- `src/lib/admin/collection.ts` — `makeDeps()` reads `PCLOUD_ADMIN_AUTH`
  (replaces `PCLOUD_TOKEN`); creates client with `type: 'pcloud'`. Drop
  `fileidIndex` and `mediaCache` from the deps. Wrappers' input now
  `{ fileids: readonly number[] }` instead of `{ uuids: readonly string[] }`.
- `src/lib/admin/collection.server.ts` — `fetchCollectionMedia(client)`
  returns `AdminFileItem[]` mapped directly from `collection_details`
  - `getthumbslinks` (no fileidIndex/mediaCache). `linkFilesToCollectionRaw`
    / `unlinkFilesFromCollectionRaw` now accept `fileids: readonly number[]`.
    `AdminFileItem` is defined here and exported.
- `src/routes/admin/collection.tsx` — Zod-validated `validateSearch` for
  `{ folderid?: number }`. Loader fetches `getCollectionMedia()` +
  `getAdminSourceFolder({ folderid })` in parallel. Renders
  `<CollectionItemsGrid>` (top) + `<AdminFolderNavigator>` (bottom).
  Drops the old "Añadir más" toggle — the navigator is always visible.
  Selection state and save handler live in this component.
- `src/components/CollectionItemsGrid.tsx` — adapts to `AdminFileItem`
  (keyed by `fileid`, no `captureDate`, no `uuid`, `onRemove(fileid)`).
  Drops the year caption — collection_details doesn't return capture
  date and we don't need it here.
- `src/components/CollectionItemsGrid.browser.test.tsx` — rewritten for
  the new shape.
- `netlify/functions/refresh-memories.ts` — parse + validate
  `PCLOUD_ADMIN_AUTH`; build a second client with `type: 'pcloud'` when
  set; pass it to `refreshMemories` through `collectionOpts`.
- `src/lib/memories/refresh-memories.server.ts` — `CollectionOpts` grows
  a `client: Client` field (the admin client). `refreshCollectionSnapshot`
  uses `opts.client` instead of the OAuth `client` for
  `collection_details`. Signature change is local; existing tests get a
  one-line update.
- `src/lib/memories/refresh-memories.server.test.ts` — pass an
  admin-client mock through `collectionOpts.client` in the existing
  collection-cache describe block.
- `README.md` — add `PCLOUD_ADMIN_AUTH` and `PCLOUD_SOURCE_FOLDER_ID` to
  prerequisites with one-line descriptions and a pointer to
  `scripts/oauth-provision.mjs` (note: admin token is _not_ OAuth — see
  Risks below for provisioning).
- `SPEC.md` — append §21 (v12 acceptance criteria) and §22 (v11 → v12
  diff). Update §7 boundaries to mention the second client.

**Removed (drop all references and tests):**

- `src/lib/admin/folder-media.ts`
- `src/lib/admin/folder-media.server.ts`
- `src/lib/admin/folder-media.server.test.ts`
- `src/components/AdminCollectionGrid.tsx`
- `src/components/AdminCollectionGrid.browser.test.tsx`

**Reusable patterns to lean on:**

- Server-fn auth + admin gate: `src/lib/admin/collection.ts:22-27`.
- Dynamic server-import dance: `src/lib/admin/collection.ts:32-42`.
- `assert*Id()` env-guard pattern: `src/lib/admin/collection.server.ts:7-20`.
- Raw `client.call<T>('method', { ... })` cast at the call site:
  `src/lib/memories/refresh-memories.server.ts:341-344`.
- Route gate with redirect on missing admin:
  `src/routes/admin/collection.tsx:17-22`.
- Search-param validation with TanStack Router: precedent is sparse in
  this repo; mirror the official docs (Zod `validateSearch`) inline.

## Phase Breakdown

### Phase 1 — Split auth (foundation)

**Goal:** All `collection_*` calls (admin route + cron) go through a
client built from `PCLOUD_ADMIN_AUTH` with `type: 'pcloud'`. No UI
changes. Existing /admin/collection still works against the existing
uuid-based collection display.

- Add `PCLOUD_ADMIN_AUTH` to `src/env.d.ts`. Document in `README.md`.
- `src/lib/admin/collection.ts:makeDeps()` reads `PCLOUD_ADMIN_AUTH`
  instead of `PCLOUD_TOKEN`; calls `createClient({ token, type: 'pcloud' })`.
- `netlify/functions/refresh-memories.ts`: when `PCLOUD_ADMIN_AUTH` is
  set, build `const adminClient = createClient({ token: adminToken,
type: 'pcloud' })`. Pass it via `collectionOpts.client`.
- `src/lib/memories/refresh-memories.server.ts:CollectionOpts` grows a
  `client: Client` field. `refreshCollectionSnapshot` uses
  `opts.client.call(...)`. The OAuth-authed `client` param remains for
  the function's other calls.
- Existing tests pass without functional change; mock client in the
  collection-cache test now flows through `collectionOpts.client`.
- VERIFICATION: `pnpm test && pnpm type-check && pnpm format:check`;
  `pnpm invoke:refresh-memories` succeeds with both env vars set and
  reaches the `[refresh-memories] collection: linked=…` log line.

### Phase 2 — Decouple admin collection display from memories cache

**Goal:** `/admin/collection`'s top section ("En la colección") reads
file metadata directly from `collection_details` (via admin client) +
batched thumb URLs. No fileidIndex or mediaCache involvement. Link /
unlink accept `fileids`.

- Define `AdminFileItem = { fileid: number; name: string; kind: 'image'
| 'video' | 'other'; thumbUrl: string | null }` in
  `src/lib/admin/collection.server.ts`. Export it.
- Rewrite `fetchCollectionMedia(client)`:
  1. Call `collection_details({ collectionid, showfiles: 1 })`.
  2. Build `fileids = items.map((f) => f.fileid)`.
  3. If `fileids.length > 0`, call
     `client.call<ThumbResult[]>('getthumbslinks', { fileids:
fileids.join(','), size: '320x320', crop: 1, type: 'jpg' })`.
     Build a `Map<fileid, url>`.
  4. Return `items.map((f) => ({ fileid, name, kind: classify(f.contenttype),
thumbUrl: thumbs.get(f.fileid) ?? null }))`.
- Rewrite `linkFilesToCollectionRaw(client, fileids: readonly number[])`
  / `unlinkFilesFromCollectionRaw(client, fileids)` — no mediaCache
  dependency. Empty input throws TypeError.
- Update `src/lib/admin/collection.ts` wrappers: accept `{ fileids:
readonly number[] }`. Validate ints > 0.
- Update `CollectionItemsGrid` (and its browser test) to the new shape
  (`onRemove(fileid: number)`).
- Update `src/lib/admin/collection.server.test.ts`: drop mediaCache /
  fileidIndex mocks; assert `getthumbslinks` is called with the right
  CSV and the result is woven into items.
- VERIFICATION: `pnpm test`; load `/admin/collection`; the top section
  renders current collection contents (or empty); per-tile "Quitar"
  invokes `collection_unlinkfiles` and the item disappears after
  `router.invalidate()`.

### Checkpoint A — Phases 1 + 2

- Both phases shippable independently. Phase 1 is a pure refactor;
  Phase 2 changes the admin display shape but the route still
  functions because the bottom "Añadir más" section is gone in Phase 3,
  not here.
- IMPORTANT: between Phase 2 and Phase 3 the route has _no add-files
  affordance_. Either ship Phases 2 + 3 together, or accept that
  Phase 2 alone temporarily turns /admin/collection into a read-only
  view. The latter is fine if Phase 3 lands within hours.

### Phase 3 — Source folder navigation (vertical slice)

**Goal:** Admin can browse `PCLOUD_SOURCE_FOLDER_ID` and its subtree,
multi-select image/video files across folders, and save the selection
into the pCloud collection.

- Add `PCLOUD_SOURCE_FOLDER_ID` to `src/env.d.ts`. Document in `README.md`.
- New `src/lib/admin/source-folder.server.ts`:
  - `assertSourceFolderId(): number` mirrors `assertCollectionId()`.
  - `fetchAdminSourceFolder(client, opts: { folderid?: number; blocked:
ReadonlySet<number> }): Promise<AdminFolderListing>` where
    `AdminFolderListing = { current: { folderid, name }, breadcrumbs:
readonly { folderid: number; name: string }[], subfolders:
readonly { folderid: number; name: string }[], files: readonly
AdminFileItem[], rootFolderid: number }`.
  - `folderid` defaults to `PCLOUD_SOURCE_FOLDER_ID`. If the requested
    `folderid` is not the source root and not a descendant of it, throw
    a tagged error (defense against URL tampering).
  - Listfolder via `client.call<{ metadata: FolderMetadata }>('listfolder',
{ folderid, nofiles: 0, noshares: 1 })`.
  - Split `metadata.contents` into subfolders (`isfolder: true`) and
    files (`isfolder: false` AND contenttype starts with image/ or
    video/). Sort subfolders by name asc; sort files by name asc.
  - Build breadcrumbs by walking `parentfolderid` with
    `listfolder({ folderid: parent, nofiles: 1, noshares: 1 })` until
    the source root or until `parentfolderid` is undefined. Bound the
    walk at 10 levels for safety.
  - Batch `getthumbslinks` for the file ids in one call. Annotate each
    file with thumbUrl (or null on failure).
- New `src/lib/admin/source-folder.ts`: `getAdminSourceFolder` server-fn
  wrapper. Input validator: `{ folderid?: number }`. The wrapper also
  fetches the blocked set (current collection's fileids) — see Phase 2
  side effect — by reading `collection_details` lightly. Actually:
  loader composes both, so the source-folder fn does NOT take a
  blocked set; the route's loader returns both and the navigator
  receives the blocked set as a prop. (Simpler; one fetch per concern.)
- New `src/components/AdminFolderNavigator.tsx`:
  - Top: breadcrumb row `<Wrap>` of `<Button variant="ghost">`s; the
    root breadcrumb says "Raíz".
  - Middle: subfolder grid (square tiles with folder icon + name,
    `onClick={() => onNavigate(folderid)}`).
  - Middle: file grid (square tiles, image thumb, lucide `Play` overlay
    for video, checkbox overlay; disabled tiles for blocked fileids).
  - Bottom: sticky footer with `Guardar (N)` + `Cancelar` (resets
    selection). Hidden when N=0.
- New `src/components/AdminFolderNavigator.browser.test.tsx`:
  - Renders breadcrumbs in order; clicking one calls `onNavigate`.
  - Subfolder click calls `onNavigate(folderid)`.
  - File click toggles selection; selected count shown in footer.
  - "Guardar" calls `onSave` with the selected fileids array.
  - Blocked files are not toggleable; have `aria-disabled="true"`.
- Update `src/routes/admin/collection.tsx`:
  - `validateSearch: (s) => ({ folderid: typeof s.folderid === 'string'
|| typeof s.folderid === 'number' ? Number(s.folderid) : undefined })`.
  - Loader: `Promise.all([getCollectionMedia(), getAdminSourceFolder({
data: { folderid: search.folderid } })])`.
  - Component: holds `const [picked, setPicked] = useState<Map<number,
AdminFileItem>>(new Map())`. Provides `onNavigate` that calls
    `navigate({ search: { folderid } })`, `onToggle` mutating picked,
    `onSave` that calls `linkFilesToCollection({ data: { fileids: [...
picked.keys()] } })` then clears picked and invalidates.
  - The "Cancelar" button in the footer just clears `picked`.
- Source-folder unit tests cover the listfolder mapping + breadcrumb
  walk + image/video filter + thumb-batch wiring.
- VERIFICATION: `pnpm test`; navigate into a subfolder; select 2 files
  in folder A, navigate to folder B, select 1 more; save; the
  collection top section refreshes to N+3; pCloud web UI confirms; an
  already-collected file in folder A appears disabled.

### Checkpoint B — Phases 3 (open PR)

- Trigger `pnpm invoke:refresh-memories` in the deploy preview after
  setting `PCLOUD_ADMIN_AUTH` + `PCLOUD_SOURCE_FOLDER_ID` in Netlify
  env. Verify the cron log line still appears with `linked=N alive=N`.
- Smoke the source-folder picker end-to-end with a file matching
  today's date — confirm it lands on `/` after the next cron.
- Human review + merge.

### Phase 4 — Cleanup

**Goal:** Drop the now-unused folder-media surface; document v12.

- Delete `src/lib/admin/folder-media.{ts,server.ts}` + tests.
- Delete `src/components/AdminCollectionGrid.tsx` + test.
- Remove all imports of the above.
- Update `SPEC.md` §21 (v12 acceptance criteria) and §22 (v11 → v12
  diff). Key edits: write boundaries gain the second client; project
  structure swaps folder-media for source-folder + navigator.
- `pnpm test && pnpm type-check && pnpm lint && pnpm format:check`.

## Risks and Mitigations

| Risk                                                                                                                                                                                                              | Impact                                                              | Mitigation                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PCLOUD_ADMIN_AUTH` is a different auth scheme — provisioning isn't covered by `scripts/oauth-provision.mjs`                                                                                                      | Medium                                                              | Add a README note pointing at pCloud's `/userinfo?getauth=1&username=…&password=…` endpoint (the canonical way to mint a pCloud-native token). Optional follow-up: add `scripts/admin-auth-provision.mjs`. Not blocking this rev; the owner already minted one for testing. |
| Walking the parent chain for breadcrumbs is N round-trips                                                                                                                                                         | Low                                                                 | Trees are shallow (≤ 5 typical). Cap at 10 levels. Stop early at the source root. Acceptable for an admin route hit < 10× per session.                                                                                                                                      |
| `getthumbslinks` with `size: '320x320'` may not be honored by pCloud (kit's typed wrapper caps at `120x120`)                                                                                                      | Medium                                                              | Call via `client.call<>('getthumbslinks', ...)` raw with `size: '320x320'`. If pCloud rejects, fall back to `'120x120'` (looks worse but works). Resolve in Phase 2 smoke; if rejected, document the cap in code and accept it.                                             |
| `validateSearch` mistypes `folderid` (URL strings vs numbers) — TanStack Router gives strings                                                                                                                     | Low                                                                 | Explicit `Number(s.folderid)` + `Number.isFinite` guard in validator. Component never reads the search value raw; always via the validated loader argument.                                                                                                                 |
| Selection state lost on browser refresh / back                                                                                                                                                                    | Low                                                                 | Accept for v1. Document in §21. If it becomes a real annoyance, persist `picked` in `sessionStorage` as a follow-up.                                                                                                                                                        |
| `PCLOUD_SOURCE_FOLDER_ID` not set in prod after deploy                                                                                                                                                            | High                                                                | The route's loader catches the tagged `SourceFolderIdMissingError` and renders an `UnconfiguredBanner` mirroring the existing `PCLOUD_COLLECTION_ID` banner. Tests cover both unconfigured paths.                                                                           |
| User tampers with the `folderid` search param to navigate outside the source root                                                                                                                                 | Medium                                                              | The server-fn walks parents and asserts the chain terminates at `PCLOUD_SOURCE_FOLDER_ID`. If it doesn't, throw a tagged error → route loader maps to a "Carpeta no permitida" banner.                                                                                      |
| pCloud collections may treat type-`generic` differently for non-audio files (the v11 audio-typed test collection accepted photo linkfiles without complaint, but type=2 hasn't been smoke-tested for link/unlink) | Low (downgraded after curator manually created a type=2 collection) | Smoke link + unlink in Phase 2 verification before declaring Phase 3 ready.                                                                                                                                                                                                 |
| Removing `AdminCollectionGrid` + folder-media breaks orphan imports                                                                                                                                               | Low                                                                 | grep for both names in Phase 4; tests will fail loudly if anything still depends on them.                                                                                                                                                                                   |

## Open / Out-of-scope

- **Searching inside the source folder tree** (e.g., "find file by name
  across all subfolders") — out of scope. Navigation is by tree only.
- **Bulk operations** beyond multi-select link — no rename, no move, no
  reorder.
- **Persisting the in-progress selection** across page reloads — accept
  the loss; revisit if real curators complain.
- **Provisioning `PCLOUD_ADMIN_AUTH` from the app** — manual via the
  pCloud auth API.
- **Showing capture dates** in the admin view — `collection_details`
  doesn't return them and pulling EXIF here would couple back to the
  memories pipeline. The admin doesn't need this; they curate by
  filename / thumbnail.
- **Multi-collection support** — single collection per env var.

## Verification (end-to-end)

1. `pnpm install` (no new deps).
2. Set in Netlify env (and `.env.local` for dev):
   - `PCLOUD_TOKEN` (existing, OAuth)
   - `PCLOUD_MEMORIES_FOLDER_ID` (existing)
   - `PCLOUD_COLLECTION_ID` (existing — currently `4557946`)
   - `PCLOUD_ADMIN_AUTH` (new, pCloud-native auth token)
   - `PCLOUD_SOURCE_FOLDER_ID` (new — currently `13906280502`)
3. `pnpm dev:netlify`, log in as admin, open `/admin/collection`.
4. Phase 2 acceptance: top section shows current collection items
   (empty initially), each with a "Quitar" affordance. Add a file via
   pCloud web UI; refresh; the item appears.
5. Phase 3 acceptance:
   - The navigator renders at the source folder root. Breadcrumb shows
     only "Raíz".
   - Subfolders render as folder-icon tiles; click one — URL updates
     to `?folderid=N`, breadcrumb appends, navigator shows that
     folder's contents.
   - Select 2 image files in folder A. Navigate into a subfolder;
     select 1 video file. Footer shows "Guardar (3)". Save.
   - Top section refreshes to include all 3. pCloud web UI confirms.
   - Click "Quitar" on one. It disappears. pCloud confirms.
6. Cron / home acceptance (Checkpoint B):
   - `pnpm invoke:refresh-memories`. Cron log:
     `[refresh-memories] collection: linked=3 alive=N missing=M`. The
     `missing` count surfaces fileids that aren't in
     `PCLOUD_MEMORIES_FOLDER_ID` (expected — source folder is wider).
   - Pick a file in the source folder whose capture date matches today;
     link it; cron again; load `/`; the item appears (assuming it's
     also under `PCLOUD_MEMORIES_FOLDER_ID`, since the home page
     intersects with `folder/v1`).
7. Negative paths:
   - `PCLOUD_ADMIN_AUTH` unset → admin route shows tagged banner; cron
     still runs but logs `collection snapshot skipped`.
   - `PCLOUD_SOURCE_FOLDER_ID` unset → admin route shows tagged banner
     for the source section (collection section still loads).
   - `?folderid=999999999` (folder not under source root) → route
     shows "Carpeta no permitida".
8. `pnpm test && pnpm type-check && pnpm lint && pnpm format:check`
   clean.
