# Admin Collection Curation — todo

> Build an admin panel at `/admin/collection` to curate which pCloud files
> participate in the home page's "on this day" view, via a pCloud collection
> bound to `PCLOUD_COLLECTION_ID`. Home keeps its date filter; cron stays the
> only Blobs writer. See `tasks/plan.md` for the full rationale.

---

## Phase 1 — Admin route gate

- [ ] Extend `src/lib/auth/identity-context.tsx`: expose `isAdmin` from
      `useIdentity()` (derive from `app_metadata.roles`).
- [ ] Add admin link in `src/components/Topbar.tsx` (`AccountDrawer`) when
      `isAdmin` — Spanish label "Administración", links to `/admin/collection`.
- [ ] Create `src/routes/admin/collection.tsx`:
  - [ ] `beforeLoad` calls `getServerUser()`; redirect to `/login` if
        unauthenticated, `/` if authenticated but not admin.
  - [ ] Component renders `<AppShell><Topbar />…</AppShell>` with a placeholder
        `<Container><Heading>Curación de colección</Heading></Container>`.
- [ ] Add a colocated `*.browser.test.tsx` for the AccountDrawer admin link
      (renders when `isAdmin`, hidden otherwise).
- [ ] `pnpm type-check && pnpm test && pnpm lint && pnpm format:check`.

### Acceptance — Phase 1

- [ ] Anon visiting `/admin/collection` → redirects to `/login`.
- [ ] Non-admin user → redirects to `/`.
- [ ] Admin user → page renders.
- [ ] Topbar drawer shows "Administración" only for admins.

---

## Phase 2 — Folder media listing

- [ ] Add `src/lib/admin/folder-media.server.ts`:
  - [ ] Pure `fetchAdminFolderMedia(folderCache, mediaCache):
Promise<AdminMediaItem[]>` — no date filter, sort by `captureDate` desc
        then `fileid` asc.
  - [ ] `AdminMediaItem` shape: `{ uuid, kind, name, captureDate, fileid,
thumbUrl }` (thumbUrl built via existing `buildThumbUrl(code, '320x320')`).
- [ ] Add `src/lib/admin/folder-media.ts`: createServerFn wrapper
      `getAdminFolderMedia` with auth + admin gate (mirror
      `pcloud.ts:23-35`).
- [ ] Add `src/components/AdminCollectionGrid.tsx`: square tile grid via
      Chakra `SimpleGrid`, lazy `<img loading="lazy">`, optional capture-year
      caption, optional `selected` + `disabled` props (used in Phase 3).
- [ ] Update `src/routes/admin/collection.tsx` loader → `getAdminFolderMedia`;
      render `<AdminCollectionGrid items={…} />`.
- [ ] Empty state when folder snapshot is missing (cron not run).
- [ ] Unit test `folder-media.server.test.ts`:
  - [ ] Missing snapshot → `[]`.
  - [ ] Snapshot with N uuids, M with captureDate → returns N items, sorted.
- [ ] Browser test `AdminCollectionGrid.browser.test.tsx`: renders grid; lazy
      thumbs; selected state visual.
- [ ] `pnpm test && pnpm type-check && pnpm lint && pnpm format:check`.

### Acceptance — Phase 2

- [ ] Admin route renders a grid of every cached folder item.
- [ ] Items sorted newest-captureDate-first.
- [ ] Empty state shown when cache empty.

### Checkpoint A — open PR for Phases 1 + 2

- [ ] Branch from `main`, push, open PR.
- [ ] Trigger cron once on deploy preview; smoke `/admin/collection`.
- [ ] Human review + merge.

---

## Phase 3 — Collection display + link/unlink

- [ ] Add `PCLOUD_COLLECTION_ID` to `src/env.d.ts` (string).
- [ ] Add `PCLOUD_COLLECTION_ID` to `README.md` prerequisites.
- [ ] `src/lib/admin/collection.server.ts`:
  - [ ] `fetchCollectionMedia(client, fileidIndex, mediaCache):
Promise<AdminMediaItem[]>` — `client.call<…>('collection_details', {
collectionid, showfiles: 1 })`; map fileids → uuids → cached media.
  - [ ] `linkFilesToCollectionRaw(client, mediaCache, uuids:
readonly string[]): Promise<void>` — resolve uuids→fileids, join CSV,
        `client.call('collection_linkfiles', { collectionid, fileids })`.
  - [ ] `unlinkFilesFromCollectionRaw(client, mediaCache, uuids):
Promise<void>` — symmetric.
  - [ ] Read `PCLOUD_COLLECTION_ID` at module-top; export a guard helper
        `assertCollectionId()` that throws a tagged error if unset.
- [ ] `src/lib/admin/collection.ts`: three createServerFn wrappers
      (`getCollectionMedia`, `linkFilesToCollection`,
      `unlinkFilesFromCollection`) — auth + admin gate, dynamic-import the
      server file, instantiate pCloud client (mirror
      `refresh-memories.ts` instantiation).
- [ ] Update `src/routes/admin/collection.tsx`:
  - [ ] Loader fetches both `getCollectionMedia` + `getAdminFolderMedia` in
        parallel; computes the "available to add" set.
  - [ ] Top section `<Heading>En la colección (N)</Heading>` + grid with per-tile
        "Quitar" button (calls `unlinkFilesFromCollection({ uuids: [uuid] })`
        then `router.invalidate()`).
  - [ ] "Añadir más" button → toggles a section with the available-folder
        grid, multi-select via local state, "Guardar (M)" submits
        `linkFilesToCollection({ uuids })` then invalidates.
  - [ ] Persistent notice: "Los cambios aparecerán en la página principal tras
        la próxima sincronización (04:00 UTC)."
  - [ ] Banner when `PCLOUD_COLLECTION_ID` unset (server fn surfaces tagged
        error).
- [ ] Tests:
  - [ ] `collection.server.test.ts`: `linkFilesToCollectionRaw` builds CSV
        correctly; rejects empty uuids; missing fileid in cache → throws.
  - [ ] Auth-gate tests on each server fn wrapper (non-admin → throws).
- [ ] `pnpm test && pnpm type-check && pnpm lint && pnpm format:check`.

### Acceptance — Phase 3

- [ ] Top section lists current pCloud collection items.
- [ ] "Añadir más" reveals folder grid; items in collection visually marked
      and non-selectable.
- [ ] Save links selected uuids → fileids → pCloud `collection_linkfiles`; UI
      refreshes.
- [ ] "Quitar" removes via `collection_unlinkfiles`; UI refreshes.
- [ ] pCloud web UI mirrors changes.

---

## Phase 4 — Home reads collection

- [ ] Add `src/lib/cache/collection-cache.ts` (mirror `folder-cache.ts` shape:
      `{ refreshedAt, uuids }`).
- [ ] Add `src/lib/cache/collection-cache.server.ts` (mirror
      `folder-cache.server.ts`; store name `collection-cache`, key
      `collection/v1`, no-op fallback).
- [ ] Extend `src/lib/memories/refresh-memories.server.ts`:
  - [ ] `refreshMemories(...)` accepts `collectionCache: CollectionCache` and
        an optional `collectionId: string | null`.
  - [ ] After `folderCache.remember(...)`, when `collectionId` is set: call
        `client.call('collection_details', { collectionid, showfiles: 1 })`,
        map fileids → uuids via fileid-index, intersect with the alive uuid
        set, `collectionCache.remember({ refreshedAt, uuids })`.
  - [ ] Log a count of "collection fileids not in folder" (no ids).
- [ ] Update `netlify/functions/refresh-memories.ts` to wire `collectionCache` + `PCLOUD_COLLECTION_ID`.
- [ ] Update `src/lib/memories/pcloud.server.ts` `fetchTodayMemories`:
  - [ ] Look up `collectionCache.lookup()` first; if present use those uuids.
  - [ ] Else fall back to `folderCache.lookup()` (current behavior).
  - [ ] Date-match + sort logic unchanged.
- [ ] Tests:
  - [ ] `pcloud.server.test.ts` (or extend existing): only folder snapshot →
        same behavior as today; both snapshots → narrows to collection uuids;
        empty collection → empty result.
  - [ ] `refresh-memories.server.test.ts`: collection_details mock returns 2
        fileids, one known to fileidIndex, one unknown → collectionCache
        receives exactly the one known uuid.
- [ ] Update `SPEC.md` with §18 (collection curation model, env var, cron
      extension, fileid-exposure boundary nuance for admin route).
- [ ] `pnpm test && pnpm type-check && pnpm lint && pnpm format:check`.

### Acceptance — Phase 4

- [ ] With empty collection: home shows nothing.
- [ ] With items in collection but no date match: home shows nothing.
- [ ] With items in collection where date matches: home shows only those.
- [ ] With `PCLOUD_COLLECTION_ID` unset: home falls back to folder snapshot
      (no regression).

### Checkpoint B — open PR for Phases 3 + 4

- [ ] Branch, push, PR.
- [ ] Set `PCLOUD_COLLECTION_ID` in Netlify deploy preview env.
- [ ] Trigger cron; smoke end-to-end (link an item matching today → home shows
      it).
- [ ] Human review + merge.
