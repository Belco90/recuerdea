# Admin Collection v2 — todo

> Pivot from "admin grid reads memories cache" to "admin grid reads pCloud
> live, browses `PCLOUD_SOURCE_FOLDER_ID`, mutates via a separate
> `PCLOUD_ADMIN_AUTH` (pCloud-native) client". See `tasks/plan.md` for
> rationale.

---

## Phase 1 — Split auth (foundation)

- [x] Add `PCLOUD_ADMIN_AUTH: string` (optional) to `src/env.d.ts`.
- [x] Update `src/lib/admin/collection.ts:makeDeps()` to read
      `PCLOUD_ADMIN_AUTH` (throw if unset) and construct the client with
      `createClient({ token, type: 'pcloud' })`.
- [x] Add `client: Client` to `CollectionOpts` in
      `src/lib/memories/refresh-memories.server.ts`.
- [x] In `refreshCollectionSnapshot`, use `opts.client.call(...)`
      instead of the OAuth-authed `client` for `collection_details`.
- [x] Update `netlify/functions/refresh-memories.ts`: parse +
      validate `PCLOUD_ADMIN_AUTH`; construct
      `adminClient = createClient({ token, type: 'pcloud' })`; pass
      via `collectionOpts.client`. If `PCLOUD_ADMIN_AUTH` is unset,
      log a `collection snapshot skipped: PCLOUD_ADMIN_AUTH unset`
      and omit `collectionOpts` entirely.
- [x] Update `src/lib/memories/refresh-memories.server.test.ts`
      collection-cache block: pass a separate admin-client mock via
      `collectionOpts.client`; assert that the OAuth `client` mock
      is NOT called with `collection_details`.
- [x] `src/lib/admin/collection.server.test.ts` env stubs unchanged —
      raw helpers take the client as a parameter so they don't read
      `PCLOUD_ADMIN_AUTH` directly.
- [x] Document `PCLOUD_ADMIN_AUTH` in `README.md` (prerequisites,
      one-line description, note that it is a pCloud-native token —
      not OAuth — and how to mint one).
- [x] `pnpm type-check && pnpm test && pnpm lint && pnpm format:check`.

### Acceptance — Phase 1

- [x] Admin server fns reach pCloud through the admin client; the
      OAuth client is no longer used for `collection_*`.
- [ ] Cron with both env vars set: `[refresh-memories] collection:
      linked=N alive=M missing=K` still appears.
- [ ] Cron with `PCLOUD_ADMIN_AUTH` unset logs the new skip warning
      and does not crash.

---

## Phase 2 — Decouple admin display from memories cache

- [ ] Define `AdminFileItem = { fileid: number; name: string; kind:
'image' | 'video' | 'other'; thumbUrl: string | null }` in
      `src/lib/admin/collection.server.ts`. Export it.
- [ ] Rewrite `fetchCollectionMedia(client)`:
  - [ ] Call `collection_details({ collectionid, showfiles: 1 })`.
  - [ ] Build a `fileids` array. If non-empty, call
        `client.call<ThumbResult[]>('getthumbslinks', { fileids: csv,
size: '320x320', crop: 1, type: 'jpg' })`.
  - [ ] Return `AdminFileItem[]` keyed by fileid with `thumbUrl` map.
- [ ] Rewrite `linkFilesToCollectionRaw(client, fileids: readonly
number[])` and `unlinkFilesFromCollectionRaw(client, fileids)`:
  - [ ] Empty array → TypeError.
  - [ ] Non-integer entry → TypeError.
  - [ ] CSV join + `client.call('collection_linkfiles' | 'collection_unlinkfiles', ...)`.
- [ ] Update `src/lib/admin/collection.ts`:
  - [ ] Drop the `fileidIndex` + `mediaCache` deps from `makeDeps()`.
  - [ ] Wrappers' input validator now requires
        `{ fileids: readonly number[] }` (positive integers).
- [ ] Rewrite `src/components/CollectionItemsGrid.tsx`:
  - [ ] Accept `items: readonly AdminFileItem[]`,
        `onRemove: (fileid: number) => void`,
        `pending?: ReadonlySet<number>`.
  - [ ] Render `name` instead of year caption (or no caption — owner
        preference; default to "no caption" for minimal noise).
  - [ ] Fallback box when `thumbUrl` is null.
- [ ] Rewrite `src/components/CollectionItemsGrid.browser.test.tsx`
      for the new shape.
- [ ] Rewrite `src/lib/admin/collection.server.test.ts`:
  - [ ] Drop fileidIndex + mediaCache mocks.
  - [ ] `fetchCollectionMedia`: mock `collection_details` returning N
        files; mock `getthumbslinks` returning N urls; assert
        `AdminFileItem[]` shape and thumb mapping.
  - [ ] `linkFilesToCollectionRaw`: assert CSV; assert TypeError on
        empty / non-integer.
  - [ ] `unlinkFilesFromCollectionRaw`: symmetric.
- [ ] `pnpm test && pnpm type-check && pnpm lint && pnpm format:check`.

### Acceptance — Phase 2

- [ ] `/admin/collection` top section shows the current collection
      contents read live from pCloud — no folder-cache, no media-cache.
- [ ] "Quitar" removes via `collection_unlinkfiles`; UI refreshes via
      `router.invalidate()`.
- [ ] `fileid` (not `uuid`) is the id on the wire and in the UI.

### Checkpoint A — Phases 1 + 2

- [ ] Ship Phases 1 + 2 together OR with Phase 3 — Phase 2 alone
      temporarily removes the "Añadir más" affordance. Owner's call.
- [ ] Trigger cron on deploy preview; smoke top section.

---

## Phase 3 — Source folder navigation

- [ ] Add `PCLOUD_SOURCE_FOLDER_ID: string` (optional) to `src/env.d.ts`.
- [ ] Document `PCLOUD_SOURCE_FOLDER_ID` in `README.md`.
- [ ] New `src/lib/admin/source-folder.server.ts`:
  - [ ] `SourceFolderIdMissingError` + `assertSourceFolderId()`
        (mirror `CollectionIdMissingError`).
  - [ ] `FolderNotPermittedError` for the "outside the source root"
        case.
  - [ ] `AdminFolderListing` type as described in the plan.
  - [ ] `fetchAdminSourceFolder(client, { folderid? })` — defaults to
        source root; lists current via `listfolder({ folderid, noshares:
1 })`; walks parents for breadcrumbs (cap 10); filters files to
        image/video contenttype; batches `getthumbslinks`.
  - [ ] Asserts that the requested folder is the source root or has
        the source root in its ancestor chain; otherwise throws
        `FolderNotPermittedError`.
- [ ] New `src/lib/admin/source-folder.ts`:
  - [ ] `getAdminSourceFolder` createServerFn wrapper, auth + admin
        gated, accepts `{ folderid?: number }`.
  - [ ] Catches `SourceFolderIdMissingError` and
        `FolderNotPermittedError` into tagged result variants.
- [ ] New `src/components/AdminFolderNavigator.tsx`:
  - [ ] Breadcrumb row (first crumb labelled "Raíz") with click →
        `onNavigate(folderid)`.
  - [ ] Subfolder grid (folder icon + name, full tile click =
        navigate).
  - [ ] File grid (square tile, thumb, Play overlay for video, checkbox
        overlay for selection). Disabled when fileid is in
        `blocked: ReadonlySet<number>`.
  - [ ] Sticky footer: `Guardar (N)`, `Cancelar` (clears selection).
        Hidden when N=0.
- [ ] New `src/components/AdminFolderNavigator.browser.test.tsx`:
  - [ ] Breadcrumb click fires `onNavigate`.
  - [ ] Subfolder click fires `onNavigate`.
  - [ ] File click fires `onToggle(fileid)`; footer count updates.
  - [ ] Save calls `onSave([...fileids])`; Cancel calls `onCancel`.
  - [ ] Blocked file has `aria-disabled` and ignores clicks.
- [ ] New `src/lib/admin/source-folder.server.test.ts`:
  - [ ] Lists current folder: filters image/video correctly.
  - [ ] Breadcrumbs: walks N parents, stops at source root.
  - [ ] `getthumbslinks`: batched once with full CSV; thumbs mapped
        by fileid.
  - [ ] `FolderNotPermittedError` when requested folderid not in
        source-root chain.
  - [ ] `SourceFolderIdMissingError` when env unset.
- [ ] Update `src/routes/admin/collection.tsx`:
  - [ ] `validateSearch: (s) => ({ folderid: Number.isFinite(Number(
s?.folderid)) ? Number(s.folderid) : undefined })`.
  - [ ] Loader: `Promise.all([getCollectionMedia(),
getAdminSourceFolder({ data: { folderid: search.folderid } })])`.
  - [ ] Component state: `picked: Map<number, AdminFileItem>`.
  - [ ] Renders `<CollectionItemsGrid>` for the top section.
  - [ ] Renders `<AdminFolderNavigator>` with: - `listing` from loader data - `blocked` = Set of collection items' fileids - `picked` = selection state - `onNavigate` = router.navigate({ search: { folderid } }) - `onToggle` = mutate picked - `onSave` = call `linkFilesToCollection({ data: { fileids:
[...picked.keys()] } })` → reset picked → router.invalidate() - `onCancel` = reset picked
  - [ ] Add tagged banner branches for `source-folder-id-missing`
        and `folder-not-permitted`.
- [ ] `pnpm test && pnpm type-check && pnpm lint && pnpm format:check`.

### Acceptance — Phase 3

- [ ] `/admin/collection` renders the navigator at the source root by
      default.
- [ ] Breadcrumb + subfolder navigation updates the URL
      (`?folderid=…`) and the listing.
- [ ] Files filtered to image/video; subfolders always shown.
- [ ] Already-collected files appear disabled.
- [ ] Multi-select across folder navigation persists.
- [ ] Save links the selected fileids → pCloud
      `collection_linkfiles`; top section refreshes.
- [ ] URL tampering (folder outside source root) → banner.

### Checkpoint B — open PR for Phase 3 (or Phases 2 + 3)

- [ ] Branch, push, PR.
- [ ] Set `PCLOUD_ADMIN_AUTH` and `PCLOUD_SOURCE_FOLDER_ID` in
      Netlify deploy preview.
- [ ] Trigger cron; verify `[refresh-memories] collection: linked=N
alive=M missing=K` still emits.
- [ ] Smoke end-to-end: select today-dated file → save → cron →
      home shows it.
- [ ] Human review + merge.

---

## Phase 4 — Cleanup

- [ ] Delete `src/lib/admin/folder-media.ts`.
- [ ] Delete `src/lib/admin/folder-media.server.ts`.
- [ ] Delete `src/lib/admin/folder-media.server.test.ts`.
- [ ] Delete `src/components/AdminCollectionGrid.tsx`.
- [ ] Delete `src/components/AdminCollectionGrid.browser.test.tsx`.
- [ ] grep for `AdminCollectionGrid`, `fetchAdminFolderMedia`,
      `getAdminFolderMedia`, `AdminMediaItem` — no remaining
      references.
- [ ] Update `SPEC.md`: add §21 (v12 acceptance criteria — split
      auth, source-folder navigation, decoupling) and §22 (v11 → v12
      diff). Update §7 boundaries with the two-client model.
- [ ] `pnpm test && pnpm type-check && pnpm lint && pnpm format:check`.

### Acceptance — Phase 4

- [ ] No orphan references to the removed surface.
- [ ] SPEC reflects the new architecture.
