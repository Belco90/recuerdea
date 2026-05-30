# v15 — Demolish the refresh-memories cron

## Overview

v14 made admin curation the entry point for every memory: `lazyMintFile`
writes `media/<uuid>` + `fileid-index/<fileid>` synchronously the moment a
curator picks a file. That made the daily scheduled function redundant for
the items that actually appear on `/`. The cron still does four things,
none of which earn their complexity for this single-user, curated workload:

1. Range-fetches each memories-folder file to extract `width` / `height` /
   GPS via `exifr` + the hand-rolled mvhd walker.
2. Reverse-geocodes GPS into Spanish place captions via Geoapify.
3. Sweeps deleted files: clears `media/<uuid>` + `fileid-index/<fileid>`
   and calls `deletepublink(linkid)` against pCloud.
4. Snapshots the memories folder into `folder/v1` so the loader can fall
   back to it when `collection/v1` is absent.

v15 deletes the cron and every module that only existed to feed it. The
home loader becomes a pure read against `collection/v1` + `media/<uuid>`.
The admin route (via `lazyMintFile`) becomes the sole writer of every
cache the app still has.

## Architecture Decisions

- **Loader is collection-only.** `collection/v1` absent → `/` renders the
  empty state. No `folder/v1` fallback. Matches SPEC §23's
  empty-collection semantics ("empty means 'show nothing'") extended to
  cover the "never curated" case.
- **`width` / `height` / `location` / `place` stay null forever** for any
  item curated post-v15 (and for items already lazy-minted in v14).
  `Polaroid` is already `objectFit: 'cover'` (SPEC §17), and the
  `Lightbox` uses browser-natural sizing, so the visible degradation is:
  no place caption under the polaroid, no "· {place}" suffix in the
  lightbox header. Items the cron geocoded pre-v15 keep their `place`
  field — we don't wipe the blob, so existing place captions survive
  until the next admin save touches that file.
- **`deletepublink` on file removal is dropped.** Public links accumulate
  in pCloud's panel when files leave the source folder. Acceptable for a
  single-user app; documented in SPEC §27 as a deliberate trade-off.
  Existing rule in SPEC §7 ("No abandoned public links accumulate")
  retires.
- **Hash-based invalidation goes away.** If a file's bytes change in
  pCloud, cached `code` / `linkid` / `name` / `captureDate` stay stale.
  Acceptable for the same reason — edits in pCloud are rare for this
  workload and the curator can always remove + re-add to refresh.
- **Single-writer invariant preserved.** Admin route is the sole writer
  of `media/<uuid>`, `fileid-index/<fileid>`, and `collection/v1`. The
  `folder-cache` store stops being read or written and is deleted.

## Open Questions

1. **Retire reverse-geocoding entirely** — the plan assumes yes. Existing
   `place` values in `media/<uuid>` stay readable; new items get none.
   If you want it kept, it would have to move into `lazyMintFile`
   (latency hit at save time) or a manual admin-triggered batch.
2. **Drop `PCLOUD_MEMORIES_FOLDER_ID`** — the plan assumes yes. After T2
   nothing reads it. README's "typically equal to
   `PCLOUD_SOURCE_FOLDER_ID`" guidance moves over to making
   `PCLOUD_SOURCE_FOLDER_ID` the single folder env var.
3. **Production data continuity.** Deploy-preview / prod blobs were
   populated by the cron at some point. Confirm `collection/v1` has the
   uuids you want before the merge — once the cron is gone there is no
   way to repopulate `folder/v1`. If `collection/v1` is empty in prod,
   the home page will be empty until admin curation runs against the
   restored navigator.

## Task List

### Phase 1 — Loader becomes collection-only

- [ ] **T1** — drop `folder/v1` fallback in `src/lib/memories/pcloud.server.ts`

### Checkpoint A — Loader collection-only

- [ ] `pnpm test -- src/lib/memories/pcloud.server` green
- [ ] `pnpm type-check` clean

### Phase 2 — Cron demolition

- [ ] **T2** — delete the scheduled function + netlify.toml block
- [ ] **T3** — delete `refresh-memories.server.{ts,test.ts}`

### Checkpoint B — Cron gone

- [ ] `grep -rn 'refresh-memories\|refreshMemories' src/ netlify/ test/ __mocks__/` returns nothing
- [ ] `pnpm type-check` clean
- [ ] `pnpm test` green

### Phase 3 — Orphan removal

- [ ] **T4** — delete `src/lib/cache/folder-cache.*` (orphaned by T1+T3)
- [ ] **T5** — delete `src/lib/media-meta/*` (orphaned by T3)

### Checkpoint C — Dead modules gone

- [ ] `grep -rn 'folder-cache\|media-meta\|FolderCache\|extractImageMeta\|extractVideoMeta\|reverseGeocode\|geoapify' src/ netlify/ test/ __mocks__/` returns nothing
- [ ] `pnpm type-check` clean
- [ ] `pnpm test` green

### Phase 4 — Dependencies + scripts

- [ ] **T6** — `package.json`: drop `@netlify/functions`, drop `exifr`, drop the `invoke:refresh-memories` script
- [ ] **T7** — `pnpm install` to regenerate the lockfile

### Phase 5 — Env + docs

- [ ] **T8** — `src/env.d.ts`: remove `PCLOUD_MEMORIES_FOLDER_ID`
- [ ] **T9** — rewrite the cron + Geoapify + folder-cache sections in `README.md`
- [ ] **T10** — `SPEC.md`: add §27 (v15 acceptance criteria) + §28 (v14 → v15 changes summary); update §7 boundaries (admin sole writer, retire public-link lifecycle + no-geo-logging rules); update §4 project structure; note §17 EXIF/mvhd-extractor retirement extends to width/height too

### Checkpoint D — Repo clean

- [ ] `pnpm type-check` clean
- [ ] `pnpm test` (both projects) green
- [ ] `pnpm lint` clean
- [ ] `pnpm format:check` clean
- [ ] `pnpm build` clean (after `rm -rf dist .netlify/blobs-serve`)

### Phase 6 — Smoke

- [ ] **T11** — `pnpm dev:netlify`: load `/admin/collection`, navigate folders, pick + save, confirm `/` renders the curated item without any cron run
- [ ] **T12** — `curl -I` against the local server confirms `/` still emits `Cache-Control: private` / `no-store`

### Final checkpoint

- [ ] Checkpoints A–D green
- [ ] PR open targeting `main`
- [ ] SPEC.md matches the working tree

## Task Detail

### T1 — Loader drops the folder-cache fallback

**Acceptance criteria**

- `fetchTodayMemories` reads only `collection/v1` + `media/<uuid>`.
- When `collection/v1` is absent, returns `[]` (with the existing warn log,
  reworded to "no curated collection yet").
- No import of `folder-cache` from `pcloud.server.ts`.

**Verification**

- `pnpm test -- src/lib/memories/pcloud.server` green
- `grep -n 'folder-cache\|folderCache' src/lib/memories/pcloud.server.ts` empty

**Files**

- `src/lib/memories/pcloud.server.ts`
- `src/lib/memories/pcloud.server.test.ts`

**Scope:** S

### T2 — Delete the scheduled function + netlify.toml block

**Acceptance criteria**

- `netlify/functions/refresh-memories.ts` deleted.
- `[functions."refresh-memories"]` block removed from `netlify.toml`.
- No other file in `netlify/functions/` (directory may be deleted if empty).

**Verification**

- `ls netlify/functions/` — empty or directory gone
- `grep -n 'refresh-memories' netlify.toml` empty

**Files**

- `netlify/functions/refresh-memories.ts`
- `netlify.toml`

**Dependencies:** none (cron has no production-path callers)

**Scope:** XS

### T3 — Delete refresh-memories.server.{ts,test.ts}

**Acceptance criteria**

- `src/lib/memories/refresh-memories.server.ts` and
  `refresh-memories.server.test.ts` deleted.
- No remaining import of `refreshMemories`, `RefreshResult`, `GeocodeOpts`,
  or `CollectionReader` anywhere in the repo.

**Verification**

- `grep -rn 'refreshMemories\|RefreshResult\|GeocodeOpts\|CollectionReader' src/ netlify/ test/ __mocks__/` empty

**Files**

- `src/lib/memories/refresh-memories.server.ts`
- `src/lib/memories/refresh-memories.server.test.ts`

**Dependencies:** T2

**Scope:** XS

### T4 — Delete folder-cache.*

**Acceptance criteria**

- `src/lib/cache/folder-cache.ts`, `folder-cache.server.ts`,
  `folder-cache.test.ts`, `folder-cache.server.test.ts` all deleted.
- No imports of `FolderCache`, `FolderSnapshot`, `FolderCacheStore`,
  `createFolderCache`, or `getFolderCacheStore` anywhere.

**Verification**

- `grep -rn 'folder-cache\|FolderCache\|FolderSnapshot' src/ netlify/ test/ __mocks__/` empty

**Files**

- `src/lib/cache/folder-cache.ts`
- `src/lib/cache/folder-cache.server.ts`
- `src/lib/cache/folder-cache.test.ts`
- `src/lib/cache/folder-cache.server.test.ts`

**Dependencies:** T1 (loader stops importing it), T3 (cron is gone)

**Scope:** XS

### T5 — Delete media-meta/*

**Acceptance criteria**

- `src/lib/media-meta/` directory deleted.
- No remaining import of `extractImageMeta`, `extractVideoMeta`, or
  `reverseGeocode`.

**Verification**

- `ls src/lib/media-meta` → not found
- `grep -rn 'media-meta\|extractImageMeta\|extractVideoMeta\|reverseGeocode\|geoapify' src/ netlify/ test/ __mocks__/` empty

**Files**

- `src/lib/media-meta/exif.ts`
- `src/lib/media-meta/exif.test.ts`
- `src/lib/media-meta/video-meta.ts`
- `src/lib/media-meta/video-meta.test.ts`
- `src/lib/media-meta/geoapify.server.ts`
- `src/lib/media-meta/geoapify.server.test.ts`

**Dependencies:** T3

**Scope:** S

### T6 — Drop dependencies + invoke script

**Acceptance criteria**

- `dependencies.@netlify/functions` removed from `package.json`.
- `dependencies.exifr` removed from `package.json`.
- `scripts.invoke:refresh-memories` removed.

**Verification**

- `grep -n '"@netlify/functions"\|"exifr"\|invoke:refresh-memories' package.json` empty

**Files**

- `package.json`

**Dependencies:** T2, T5

**Scope:** XS

### T7 — Regenerate the lockfile

**Acceptance criteria**

- `pnpm install` runs clean, `pnpm-lock.yaml` no longer references `exifr`
  or `@netlify/functions`.

**Verification**

- `grep -n '^  exifr:\|^  @netlify/functions:' pnpm-lock.yaml` returns
  nothing (note: transitive entries may remain via other deps)

**Files**

- `pnpm-lock.yaml`

**Dependencies:** T6

**Scope:** XS

### T8 — env.d.ts cleanup

**Acceptance criteria**

- `PCLOUD_MEMORIES_FOLDER_ID` removed from `src/env.d.ts`.
- `PCLOUD_SOURCE_FOLDER_ID` may transition from optional `?` to optional
  with a docstring noting the picker banners that fire when unset.

**Verification**

- `grep -rn 'PCLOUD_MEMORIES_FOLDER_ID' src/ netlify/` empty
- `pnpm type-check` clean

**Files**

- `src/env.d.ts`

**Dependencies:** T2

**Scope:** XS

### T9 — README rewrite

**Acceptance criteria**

- Stack: drop the "Netlify Scheduled Function ... refreshes the cache daily"
  line. Drop the Geoapify bullet. `folder/v1` reference removed from the
  Netlify Blobs line.
- Prerequisites: drop `PCLOUD_MEMORIES_FOLDER_ID`, `GEOAPIFY_API_KEY`,
  `RECUERDEA_GEOCODE_MAX_PER_RUN`, `PCLOUD_COLLECTION_ID`,
  `PCLOUD_ADMIN_AUTH`. `PCLOUD_SOURCE_FOLDER_ID` becomes the only pCloud
  folder env var.
- Getting started: replace the "trigger the scheduled function once" block
  with "navigate to `/admin/collection/add` and pick at least one file".
- Scripts table: drop `pnpm invoke:refresh-memories`.
- Project layout: drop `media-meta/` and the `refresh-memories` callout
  from `memories/`; drop `netlify/functions/` block; drop `folder-cache`
  from `cache/`.
- Deployment: drop "trigger the cron once via the Netlify dashboard".

**Verification**

- `grep -in 'refresh-memories\|geoapify\|folder/v1\|folder-cache\|media-meta\|PCLOUD_MEMORIES_FOLDER_ID\|PCLOUD_COLLECTION_ID\|PCLOUD_ADMIN_AUTH\|GEOAPIFY_API_KEY' README.md` empty

**Files**

- `README.md`

**Dependencies:** T2–T6

**Scope:** S

### T10 — SPEC.md update

**Acceptance criteria**

- New §27 ("v15 Acceptance Criteria") records:
  - Loader is collection-only; absent `collection/v1` → empty.
  - Admin route via `lazyMintFile` is the sole writer of `media/<uuid>`,
    `fileid-index/<fileid>`, and `collection/v1`.
  - `width` / `height` / `location` / `place` stay null on lazy-mint —
    UI degrades gracefully. Existing place captions on pre-v15 entries
    persist until the file is removed and re-added.
  - Public-link lifecycle: links accumulate on file deletion in pCloud —
    documented trade-off, not a bug.
  - No cron, no scheduled function, no `@netlify/functions` dependency,
    no `exifr`, no Geoapify.
- New §28 ("v14 → v15 changes summary") diff against §25 / §26.
- §7 Boundaries:
  - Drop "cron is the only writer" bullet; replace with admin-route
    single-writer rule.
  - Drop "public-link lifecycle owned by the cron" bullet; replace with
    "links may accumulate — single-user trade-off".
  - Drop "Never log any geo-derived data" rule (no geocoder left to log).
  - Keep the IP-bound URL boundary; keep the `Cache-Control: private`
    rule.
- §4 Project Structure:
  - Remove `netlify/functions/refresh-memories.ts`.
  - Remove `src/lib/memories/refresh-memories.server.ts`.
  - Remove `src/lib/media-meta/` block.
  - Remove `folder-cache.{ts,server.ts}` from `cache/` block.
  - `pcloud.server.ts` description: collection-only loader.
- §17 (v10): annotate the EXIF/mvhd-retirement rule as also covering
  `width`/`height` post-v15 (i.e. the entire `media-meta/` package is
  gone, not just capture-date extraction).
- §23 (v13): annotate `folder/v1` fallback rule as superseded by §27.

**Verification**

- `wc -l SPEC.md` shows the new sections present
- A reader can answer "where does `media/<uuid>` get written?" from the
  SPEC alone (answer: the admin route's `addToCollection` server-fn via
  `lazyMintFile`).

**Files**

- `SPEC.md`

**Dependencies:** T1–T8

**Scope:** M

### T11 — Local smoke

**Acceptance criteria**

- `pnpm dev:netlify` boots; `/admin/collection/add` lists the source
  folder.
- Picking a file + Save writes `media/<uuid>` + `fileid-index/<fileid>` +
  `collection/v1` (verify via blob inspection or the Netlify dashboard).
- `/` renders the saved item on its capture date without any background
  job running.
- Removing the item via `/admin/collection` clears it from `collection/v1`
  and from `/`.

**Verification**

- Manual browser walkthrough on `localhost:8888`.

**Dependencies:** T1–T10

**Scope:** S

### T12 — Cache-Control regression check

**Acceptance criteria**

- `curl -I http://localhost:8888/` reports `Cache-Control: private` or
  `no-store` (SPEC §7 invariant).

**Verification**

- Output of `curl -I` pasted into the PR description.

**Dependencies:** T11

**Scope:** XS

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Production `collection/v1` is empty when v15 lands → `/` shows empty state | Medium (single-user, low surprise) | Pre-merge: curator confirms `collection/v1` populated against the deploy preview; or seeds via the admin route after merge |
| Lazy-minted entries miss `place` forever | Low (UI degrades; existing captions persist) | Documented in SPEC §27 as accepted trade-off |
| `deletepublink` no longer runs → pCloud link panel accumulates | Low (single user, manual cleanup possible) | Documented in SPEC §27 |
| Hash invalidation gone → edits in pCloud don't propagate | Low (rare workflow for this app) | Curator can remove + re-add to refresh the entry |
| Loader still imports something cron-only after T1 → build break | Low (T1 has its own verification) | Type-check + tests in Checkpoint A catch it before T2 lands |
| Removing `PCLOUD_MEMORIES_FOLDER_ID` from `env.d.ts` while prod still has it set | None (env vars are loose; type only) | Confirm in Netlify dashboard but no action needed |
