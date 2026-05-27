# Implementation Plan: Admin Collection Curation

## Context

Today the home page surfaces every photo/video in `PCLOUD_MEMORIES_FOLDER_ID`
whose capture date matches today's month/day. The folder holds ~1000 files and
growing — the owner wants curation: pick which items participate in "on this
day", leaving the rest as raw archive. pCloud has a native **collections**
primitive (`collection_list`, `collection_details`, `collection_linkfiles`,
`collection_unlinkfiles`) that pcloud-kit exposes via `client.call()`. We'll
bind one collection id to an env var and build an admin-only panel that
links/unlinks files into it; the home loader then reads from the collection's
uuid set instead of the folder snapshot, with the existing date filter intact.

**Decisions confirmed with the owner:**

1. Home page **keeps the date filter** — the collection is a curated whitelist,
   not a replacement view. SPEC.md §1/§2 are preserved verbatim.
2. **Cron stays the only writer** of Netlify Blobs. Admin actions call pCloud
   directly; the new `collection-cache` is populated by the cron on its next
   04:00 UTC run. Admin UI shows a "will appear after next refresh" notice.
3. Admin lives at a **separate route** `/admin/collection`, gated in
   `beforeLoad`. Topbar's account drawer gains an "Administración" link for
   admins.

## Architecture Decisions

- **`PCLOUD_COLLECTION_ID`** — new server-only env var (numeric pCloud
  collection id). Documented in `README.md`, typed in `env.d.ts`. Missing/empty
  value ⇒ home loader falls back to the existing folder snapshot (safe rollout).
- **New cache: `collection-cache`** — Blobs store `collection-cache`, key
  `collection/v1`, shape `{ refreshedAt: string, uuids: readonly string[] }`.
  Mirrors `folder-cache.{ts,server.ts}` line-for-line (pure abstraction +
  server store-getter with no-op fallback).
- **pCloud collection calls go through `client.call<T>('collection_*', ...)`** —
  pcloud-kit lists these methods in `PcloudMethodName` but has no typed
  wrappers. Cast return types at the call site (the same pattern
  `refresh-memories.server.ts:154` uses for `getfilepublink`).
- **Folder listing for admin reuses the existing cache.** `getAdminFolderMedia`
  reads `folder/v1` + `media/<uuid>` — same data the home loader uses, just
  without the date filter. New folder additions surface after the next cron
  run (consistent with the rest of the app).
- **Selection state is local UI state** — no draft / pending writes. The "Save"
  button issues one `collection_linkfiles` call (CSV of fileids) and one
  navigate-refresh.
- **`isAdmin` reaches Topbar via the existing `useIdentity()` hook**, not new
  prop drilling. The identity context already wraps the Netlify Identity user
  object; extend the hook to expose `isAdmin` derived from
  `app_metadata.roles`.

## Critical files to be modified

**New files:**

- `src/routes/admin/collection.tsx` — route component + `beforeLoad` admin gate
  - loader.
- `src/lib/admin/folder-media.ts` — `getAdminFolderMedia` createServerFn
  wrapper.
- `src/lib/admin/folder-media.server.ts` — raw `fetchAdminFolderMedia()` (reads
  `folder/v1` + `media/<uuid>`, no date filter, returns `AdminMediaItem[]`).
- `src/lib/admin/collection.ts` — server-fn wrappers: `getCollectionMedia`,
  `linkFilesToCollection`, `unlinkFilesFromCollection`.
- `src/lib/admin/collection.server.ts` — raw helpers that talk to pCloud via
  `client.call('collection_details' | 'collection_linkfiles' |
'collection_unlinkfiles', ...)`. Reads `PCLOUD_COLLECTION_ID` from env.
- `src/lib/cache/collection-cache.ts` +
  `src/lib/cache/collection-cache.server.ts` — mirror
  `folder-cache.{ts,server.ts}`. Store name `collection-cache`, key
  `collection/v1`.
- `src/components/AdminCollectionGrid.tsx` — selectable tile grid (square crop,
  checkbox overlay, lazy thumb).
- Colocated tests: `*.test.ts` for pure helpers, `*.browser.test.tsx` for new
  components.

**Modified files:**

- `src/routes/index.tsx` loader — no change to the call site; the swap happens
  inside `fetchTodayMemories`.
- `src/lib/memories/pcloud.server.ts` — `fetchTodayMemories` reads
  `collectionCache.lookup()` first; falls back to `folderCache.lookup()` when
  collection snapshot is absent. Date-match + sort logic unchanged.
- `src/lib/memories/refresh-memories.server.ts` — after
  `folderCache.remember(...)`, when `PCLOUD_COLLECTION_ID` is set, fetch
  `collection_details`, intersect with the alive uuids via the fileid-index,
  and `collectionCache.remember(...)`.
- `netlify/functions/refresh-memories.ts` — pass `collectionCache` into
  `refreshMemories(...)`.
- `src/lib/auth/identity-context.tsx` — extend `useIdentity()` return to
  include `isAdmin`.
- `src/components/Topbar.tsx` (AccountDrawer) — add "Administración" link when
  `isAdmin`.
- `src/env.d.ts` — declare `PCLOUD_COLLECTION_ID` (optional string).
- `README.md` — add the new env var under prerequisites + a short admin-panel
  section.
- `SPEC.md` — append §18 documenting the collection curation model, env var,
  cron extension, fallback behavior.

**Reusable patterns to lean on:**

- Auth gate: `pcloud.ts:26-29` (dynamic import of `loadServerUser`, throw
  `'unauthenticated'`). Repeat in every new server fn.
- Admin gate: `getServerUser()` + `if (!user?.isAdmin) throw redirect({ to:
'/' })` in `beforeLoad` (mirrors `index.tsx:46-51`).
- Cache pair shape: `folder-cache.{ts,server.ts}` is the template (49 LOC
  combined).
- pCloud raw call: `refresh-memories.server.ts:154` (`client.call<T>('method',
{ params })`).
- UI tile: `Polaroid.tsx` for square thumbs; admin grid is a leaner square tile
  with checkbox overlay since the polaroid aesthetic is for the public-facing
  site.
- Server-only wrapper convention: type-only import at top + dynamic
  `await import('./*.server')` inside `.handler`.

## Phase Breakdown

### Phase 1 — Admin route gate (Foundation)

**Goal:** A live `/admin/collection` page that loads only for admins, with the
existing visual shell.

- Add `src/routes/admin/collection.tsx` with `beforeLoad` that calls
  `getServerUser()` and redirects non-admin (or unauth) to `/`.
- Render an `AppShell` + `Topbar` + a placeholder Container/Heading ("Curación
  de colección").
- Extend `useIdentity()` to expose `isAdmin`.
- Add admin link to `Topbar`'s `AccountDrawer`.
- Smoke: anon → `/admin/collection` → redirected; non-admin user → redirected;
  admin user → page renders.

**Verification:** `pnpm type-check` + `pnpm lint` clean; manual smoke on
`pnpm dev:netlify`.

### Phase 2 — Folder media listing (vertical slice)

**Goal:** Admin sees every cached folder item, regardless of date.

- `getAdminFolderMedia` server fn + raw helper. Returns `{ uuid, kind, name,
thumbUrl, captureDate (nullable ISO), fileid }[]`. **`fileid` is intentionally
  exposed to the admin route only** — the SPEC's "fileid stays server-side"
  boundary (§7) applies to the public app; admin pCloud mutations need the id
  round-trip. Document this nuance in SPEC §18.
- Sort: newest captureDate first, fileid asc tiebreak.
- Admin route loader calls it; route renders a grid via a new
  `AdminCollectionGrid` component (square tile, lazy `<img>` from `thumbUrl`,
  capture-year caption).
- Empty state if snapshot is missing (cron not run).
- Unit test on the raw helper: empty snapshot → `[]`, snapshot with N uuids →
  N items in correct order.

**Verification:** `pnpm test`; manual smoke renders thumbs in the grid.

### Checkpoint A — Phases 1 + 2

- Both phases shippable independently (Phase 2 is read-only).
- Open a PR; let Netlify spin a deploy preview; trigger cron once; load
  `/admin/collection`.
- Human review.

### Phase 3 — Collection display + link/unlink (vertical slice)

**Goal:** Admin sees the current collection contents at the top and can toggle
items in/out via the folder grid.

- Add `PCLOUD_COLLECTION_ID` to `env.d.ts` + `README.md` (and provision in
  Netlify env).
- `getCollectionMedia` server fn — calls `client.call<{ collection: {
contents?: FileMetadata[] } }>('collection_details', { collectionid, showfiles:
1 })`, maps each `fileid` → uuid via `fileidIndex.lookup`, then uuid →
  `media/<uuid>`, returns the same `AdminMediaItem[]` shape as Phase 2.
- `linkFilesToCollection({ uuids })` — maps uuids → fileids via media-cache,
  builds CSV, calls `client.call('collection_linkfiles', { collectionid,
fileids: csv })`.
- `unlinkFilesFromCollection({ uuids })` — symmetric, calls
  `collection_unlinkfiles`.
- UI on `/admin/collection`:
  - Top section: "En la colección (N)" with the collection grid (each tile has
    a "Quitar" affordance).
  - "Añadir más" button below opens a panel/section with the folder grid.
  - Folder grid items already in the collection are visually marked +
    non-selectable.
  - Multi-select with checkbox overlay; "Guardar (M)" submit calls
    `linkFilesToCollection`, then `router.invalidate()` to reload both lists.
  - A small persistent notice: "Los cambios aparecerán en la página principal
    tras la próxima sincronización (04:00 UTC)."
- Disable Save when M = 0. Surface error banner if env var missing.
- Unit tests: `linkFilesToCollection` builds correct CSV; rejects empty uuids;
  rejects non-admin (auth gate test).

**Verification:** `pnpm test`; manual smoke — link 2 items, refresh, confirm
they appear in "En la colección"; verify via pCloud web UI; unlink them,
confirm removal.

### Phase 4 — Home reads collection (vertical slice)

**Goal:** Home loader sources its uuid set from the curated collection, not the
raw folder snapshot. Date filter unchanged.

- Add `collection-cache.{ts,server.ts}` (mirror of `folder-cache`). Store name
  `collection-cache`, key `collection/v1`, shape `{ refreshedAt, uuids }`.
- Extend `refreshMemories(...)` signature to accept a `collectionCache:
CollectionCache` (plus the collection id resolved from env at the
  function-handler layer). After populating `folderCache`:
  - If `PCLOUD_COLLECTION_ID` is set, call `collection_details`, build the
    alive intersection (`fileidIndex` lookup → uuid; drop unknowns),
    `collectionCache.remember({ refreshedAt, uuids })`.
  - If unset, skip (leaves prior snapshot stale; documented).
- `netlify/functions/refresh-memories.ts` wires the new cache + env id and
  passes them through.
- `fetchTodayMemories` (in `pcloud.server.ts`) reads `collectionCache.lookup()`
  first; if it returns a snapshot, use those uuids; otherwise fall back to
  `folderCache.lookup()` (preserves current behavior pre-rollout and during the
  gap before the first cron with the new logic).
- Unit tests:
  - `fetchTodayMemories` with only folder snapshot → behaves as today.
  - With both → narrows to collection uuids.
  - Empty collection snapshot → empty memories (deliberate: an empty
    collection means "show nothing curated").

**Verification:** `pnpm test`; manual smoke — link an item with capture date ≠
today via admin; trigger cron via `pnpm invoke:refresh-memories`; load home —
item is in cache but NOT shown (date mismatch). Link an item whose capture
date matches today; cron again; load home — only that item appears.

### Checkpoint B — Phases 3 + 4

- End-to-end golden path: empty collection → admin links today's items → cron
  runs → home shows them.
- Open PR. Trigger cron in deploy preview. Smoke. Human review and merge.

## Risks and Mitigations

| Risk                                                                                                       | Impact                           | Mitigation                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pcloud-kit lacks typed wrappers for `collection_*` — wrong param names slip through                        | Medium                           | Hit each method with a one-off `curl` first; assert return shape; cast at the call site. Keep raw helpers thin so a typo surfaces on first manual smoke.                                                      |
| `collection_linkfiles` semantics: "fileids" param is comma-separated string (pCloud convention)            | Low                              | Verify via curl; encode explicitly. Test the join logic.                                                                                                                                                      |
| `fileid-index` may not have an entry for a fileid that lives in the collection but was never in the folder | Medium                           | The collection snapshot is `folder ∩ collection`; the cron drops uuid-less fileids and logs a count. Surface this count in the admin panel ("N archivos de la colección no están en la carpeta supervisada"). |
| Cron-only-writer rule: admin actions don't refresh the cache immediately                                   | Low (already aligned with owner) | Persistent "se aplicará tras la próxima sincronización" notice. Document in SPEC §18.                                                                                                                         |
| Admin grid for ~1000 thumbs is heavy                                                                       | Medium                           | Lazy-load images (`loading="lazy"`); cap initial render via simple paging or virtualization later if needed. Out of scope for v1 of this feature — accept the perf cost.                                      |
| `PCLOUD_COLLECTION_ID` missing in prod after deploy                                                        | High                             | Home loader falls back to folder snapshot (no regression). Admin route shows a clear "Falta configurar PCLOUD_COLLECTION_ID" banner.                                                                          |
| Race: admin links a file while cron is mid-run                                                             | Low                              | Each cron run reads `collection_details` fresh at the end of the run; worst case the change is captured next run. No write conflict (cron writes only to Blobs, admin writes only to pCloud).                 |

## Open / Out-of-scope

- **Reordering, renaming the collection, or creating new collections** is out
  of scope.
- **Pagination / search across the folder grid** is out of scope. A flat grid
  is acceptable up to ~1000 items; revisit if it bogs down.
- **Pre-cron "preview"** of the impact of a link/unlink on home — out of scope.
- **Multi-collection support** — single collection only, bound to one env var.

## Verification (end-to-end)

1. `pnpm install`
2. `pnpm dev:netlify` (port 8888) with `PCLOUD_TOKEN`,
   `PCLOUD_MEMORIES_FOLDER_ID`, `PCLOUD_COLLECTION_ID` set (use `netlify
env:set` or a local `.env`).
3. `pnpm invoke:refresh-memories` — populates `folder/v1` and (after Phase 4)
   `collection/v1`.
4. Log in as the admin user. Open the account drawer; click "Administración".
5. Phase 2 acceptance: every cached folder item renders in a grid.
6. Phase 3 acceptance: top section shows current collection items; "Añadir más"
   reveals the folder grid; select 2 items not in the collection; Save; both
   lists refresh; pCloud web UI confirms.
7. Phase 4 acceptance: link an item whose `captureDate.month/day` matches
   today; `pnpm invoke:refresh-memories`; load `/`; the item appears. Unlink
   it; cron; reload; the item is gone.
8. Negative paths: log out → `/admin/collection` redirects to `/login`;
   non-admin user → redirects to `/`.
9. `pnpm test && pnpm type-check && pnpm lint && pnpm format:check` clean.
