# Admin Collection Curation — todo

> Build an admin panel at `/admin/collection` to curate which pCloud files
> participate in the home page's "on this day" view, via a pCloud collection
> bound to `PCLOUD_COLLECTION_ID`. Home keeps its date filter; cron stays the
> only Blobs writer. See `tasks/plan.md` for the full rationale.

---

## Phase 1 — Admin route gate

- [x] Extend `src/lib/auth/identity-context.tsx`: expose `isAdmin` from
      `useIdentity()` (derive from `app_metadata.roles`).
- [x] Add admin link in `src/components/Topbar.tsx` (`AccountDrawer`) when
      `isAdmin` — Spanish label "Administración", links to `/admin/collection`.
- [x] Create `src/routes/admin/collection.tsx`:
  - [x] `beforeLoad` calls `getServerUser()`; redirect to `/login` if
        unauthenticated, `/` if authenticated but not admin.
  - [x] Component renders `<AppShell><Topbar />…</AppShell>` with a placeholder
        `<Container><Heading>Curación de colección</Heading></Container>`.
- [x] Add a colocated `*.browser.test.tsx` for the AccountDrawer admin link
      (renders when `isAdmin`, hidden otherwise).
- [x] `pnpm type-check && pnpm test && pnpm lint && pnpm format:check`.

### Acceptance — Phase 1

- [x] Anon visiting `/admin/collection` → redirects to `/login`.
- [x] Non-admin user → redirects to `/`.
- [x] Admin user → page renders.
- [x] Topbar drawer shows "Administración" only for admins.

---

## Phase 2 — Folder media listing

- [x] Add `src/lib/admin/folder-media.server.ts`:
  - [x] Pure `fetchAdminFolderMedia(folderCache, mediaCache):
Promise<AdminMediaItem[]>` — no date filter, sort by `captureDate` desc
        then `fileid` asc.
  - [x] `AdminMediaItem` shape: `{ uuid, kind, name, captureDate, fileid,
thumbUrl }` (thumbUrl built via existing `buildThumbUrl(code, '320x320')`).
- [x] Add `src/lib/admin/folder-media.ts`: createServerFn wrapper
      `getAdminFolderMedia` with auth + admin gate (mirror
      `pcloud.ts:23-35`).
- [x] Add `src/components/AdminCollectionGrid.tsx`: square tile grid via
      Chakra `SimpleGrid`, lazy `<img loading="lazy">`, optional capture-year
      caption, optional `selected` + `disabled` props (used in Phase 3).
- [x] Update `src/routes/admin/collection.tsx` loader → `getAdminFolderMedia`;
      render `<AdminCollectionGrid items={…} />`.
- [x] Empty state when folder snapshot is missing (cron not run).
- [x] Unit test `folder-media.server.test.ts`:
  - [x] Missing snapshot → `[]`.
  - [x] Snapshot with N uuids, M with captureDate → returns N items, sorted.
- [x] Browser test `AdminCollectionGrid.browser.test.tsx`: renders grid; lazy
      thumbs; selected state visual.
- [x] `pnpm test && pnpm type-check && pnpm lint && pnpm format:check`.

### Acceptance — Phase 2

- [x] Admin route renders a grid of every cached folder item.
- [x] Items sorted newest-captureDate-first.
- [x] Empty state shown when cache empty.

### Checkpoint A — open PR for Phases 1 + 2

- [ ] Branch from `main`, push, open PR.
- [ ] Trigger cron once on deploy preview; smoke `/admin/collection`.
- [ ] Human review + merge.

---

## Phase 3 — Collection display + link/unlink

- [x] Add `PCLOUD_COLLECTION_ID` to `src/env.d.ts` (string).
- [x] Add `PCLOUD_COLLECTION_ID` to `README.md` prerequisites.
- [x] `src/lib/admin/collection.server.ts`:
  - [x] `fetchCollectionMedia(client, fileidIndex, mediaCache):
Promise<AdminMediaItem[]>` — `client.call<…>('collection_details', {
collectionid, showfiles: 1 })`; map fileids → uuids → cached media.
  - [x] `linkFilesToCollectionRaw(client, mediaCache, uuids:
readonly string[]): Promise<void>` — resolve uuids→fileids, join CSV,
        `client.call('collection_linkfiles', { collectionid, fileids })`.
  - [x] `unlinkFilesFromCollectionRaw(client, mediaCache, uuids):
Promise<void>` — symmetric.
  - [x] Read `PCLOUD_COLLECTION_ID` at module-top; export a guard helper
        `assertCollectionId()` that throws a tagged error if unset.
- [x] `src/lib/admin/collection.ts`: three createServerFn wrappers
      (`getCollectionMedia`, `linkFilesToCollection`,
      `unlinkFilesFromCollection`) — auth + admin gate, dynamic-import the
      server file, instantiate pCloud client (mirror
      `refresh-memories.ts` instantiation).
- [x] Update `src/routes/admin/collection.tsx`:
  - [x] Loader fetches both `getCollectionMedia` + `getAdminFolderMedia` in
        parallel; computes the "available to add" set.
  - [x] Top section `<Heading>En la colección (N)</Heading>` + grid with per-tile
        "Quitar" button (calls `unlinkFilesFromCollection({ uuids: [uuid] })`
        then `router.invalidate()`).
  - [x] "Añadir más" button → toggles a section with the available-folder
        grid, multi-select via local state, "Guardar (M)" submits
        `linkFilesToCollection({ uuids })` then invalidates.
  - [x] Persistent notice: "Los cambios aparecerán en la página principal tras
        la próxima sincronización (04:00 UTC)."
  - [x] Banner when `PCLOUD_COLLECTION_ID` unset (server fn surfaces tagged
        error).
- [x] Tests:
  - [x] `collection.server.test.ts`: `linkFilesToCollectionRaw` builds CSV
        correctly; rejects empty uuids; missing fileid in cache → throws.
  - [x] Auth-gate tests on each server fn wrapper (non-admin → throws).
- [x] `pnpm test && pnpm type-check && pnpm lint && pnpm format:check`.

### Acceptance — Phase 3

- [x] Top section lists current pCloud collection items.
- [x] "Añadir más" reveals folder grid; items in collection visually marked
      and non-selectable.
- [x] Save links selected uuids → fileids → pCloud `collection_linkfiles`; UI
      refreshes.
- [x] "Quitar" removes via `collection_unlinkfiles`; UI refreshes.
- [x] pCloud web UI mirrors changes.

---

## Phase 4 — Home reads collection

- [x] Add `src/lib/cache/collection-cache.ts` (mirror `folder-cache.ts` shape:
      `{ refreshedAt, uuids }`).
- [x] Add `src/lib/cache/collection-cache.server.ts` (mirror
      `folder-cache.server.ts`; store name `collection-cache`, key
      `collection/v1`, no-op fallback).
- [x] Extend `src/lib/memories/refresh-memories.server.ts`:
  - [x] `refreshMemories(...)` accepts `collectionCache: CollectionCache` and
        an optional `collectionId: string | null`.
  - [x] After `folderCache.remember(...)`, when `collectionId` is set: call
        `client.call('collection_details', { collectionid, showfiles: 1 })`,
        map fileids → uuids via fileid-index, intersect with the alive uuid
        set, `collectionCache.remember({ refreshedAt, uuids })`.
  - [x] Log a count of "collection fileids not in folder" (no ids).
- [x] Update `netlify/functions/refresh-memories.ts` to wire `collectionCache` + `PCLOUD_COLLECTION_ID`.
- [x] Update `src/lib/memories/pcloud.server.ts` `fetchTodayMemories`:
  - [x] Look up `collectionCache.lookup()` first; if present use those uuids.
  - [x] Else fall back to `folderCache.lookup()` (current behavior).
  - [x] Date-match + sort logic unchanged.
- [x] Tests:
  - [x] `pcloud.server.test.ts` (or extend existing): only folder snapshot →
        same behavior as today; both snapshots → narrows to collection uuids;
        empty collection → empty result.
  - [x] `refresh-memories.server.test.ts`: collection_details mock returns 2
        fileids, one known to fileidIndex, one unknown → collectionCache
        receives exactly the one known uuid.
- [x] Update `SPEC.md` with §11/§19/§20 (collection curation model, env var, cron
      extension, fileid-exposure boundary nuance for admin route).
- [x] `pnpm test && pnpm type-check && pnpm lint && pnpm format:check`.

### Acceptance — Phase 4

- [x] With empty collection: home shows nothing.
- [x] With items in collection but no date match: home shows nothing.
- [x] With items in collection where date matches: home shows only those.
- [x] With `PCLOUD_COLLECTION_ID` unset: home falls back to folder snapshot
      (no regression).

### Checkpoint B — open PR for Phases 3 + 4

- [ ] Branch, push, PR.
- [ ] Set `PCLOUD_COLLECTION_ID` in Netlify deploy preview env.
- [ ] Trigger cron; smoke end-to-end (link an item matching today → home shows
      it).
- [ ] Human review + merge.
