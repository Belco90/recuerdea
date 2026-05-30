# v15 — Demolish the refresh-memories cron

> Admin curation already lazy-mints everything the home page needs
> (`lazyMintFile`, SPEC §25). The daily scheduled function is dead
> weight. Delete the cron and the modules that only existed for it.
> Loader becomes collection-only. See `tasks/plan.md` for rationale,
> trade-offs, and risks.

## Phase 1 — Loader becomes collection-only

- [ ] **T1**: Drop `folder/v1` fallback in `src/lib/memories/pcloud.server.ts`
  - [ ] Stop importing `createFolderCache` / `getFolderCacheStore`
  - [ ] When `collection/v1` is absent → return `[]` + warn ("no curated collection yet")
  - [ ] Update `pcloud.server.test.ts`: drop folder-store mocks and the
        "falls back to folder snapshot" cases; add an "empty when
        collection blob absent" case

### Checkpoint A — Loader collection-only

- [ ] `pnpm test -- src/lib/memories/pcloud.server` green
- [ ] `pnpm type-check` clean

## Phase 2 — Cron demolition

- [ ] **T2**: Delete the scheduled function + netlify.toml block
  - [ ] `rm netlify/functions/refresh-memories.ts`
  - [ ] Remove `[functions."refresh-memories"]` block from `netlify.toml`
  - [ ] Remove the `netlify/functions/` directory if empty

- [ ] **T3**: Delete `refresh-memories.server.{ts,test.ts}`
  - [ ] `rm src/lib/memories/refresh-memories.server.ts`
  - [ ] `rm src/lib/memories/refresh-memories.server.test.ts`

### Checkpoint B — Cron gone

- [ ] `grep -rn 'refresh-memories\|refreshMemories\|RefreshResult\|GeocodeOpts\|CollectionReader' src/ netlify/ test/ __mocks__/` returns nothing
- [ ] `pnpm type-check` clean
- [ ] `pnpm test` (both projects) green

## Phase 3 — Orphan removal

- [ ] **T4**: Delete `src/lib/cache/folder-cache.*`
  - [ ] `rm src/lib/cache/folder-cache.ts`
  - [ ] `rm src/lib/cache/folder-cache.server.ts`
  - [ ] `rm src/lib/cache/folder-cache.test.ts`
  - [ ] `rm src/lib/cache/folder-cache.server.test.ts`

- [ ] **T5**: Delete `src/lib/media-meta/*`
  - [ ] `rm -rf src/lib/media-meta`

### Checkpoint C — Dead modules gone

- [ ] `grep -rn 'folder-cache\|media-meta\|FolderCache\|FolderSnapshot\|extractImageMeta\|extractVideoMeta\|reverseGeocode\|geoapify' src/ netlify/ test/ __mocks__/` returns nothing
- [ ] `pnpm type-check` clean
- [ ] `pnpm test` green

## Phase 4 — Dependencies + scripts

- [ ] **T6**: `package.json` cleanup
  - [ ] Remove `dependencies["@netlify/functions"]`
  - [ ] Remove `dependencies.exifr`
  - [ ] Remove `scripts["invoke:refresh-memories"]`

- [ ] **T7**: `pnpm install` to regenerate the lockfile

## Phase 5 — Env + docs

- [ ] **T8**: `src/env.d.ts` — remove `PCLOUD_MEMORIES_FOLDER_ID`

- [ ] **T9**: `README.md` rewrite
  - [ ] Stack: drop scheduled-function line, drop Geoapify bullet, drop `folder/v1` mention
  - [ ] Prerequisites: drop `PCLOUD_MEMORIES_FOLDER_ID`, `GEOAPIFY_API_KEY`, `RECUERDEA_GEOCODE_MAX_PER_RUN`, `PCLOUD_COLLECTION_ID`, `PCLOUD_ADMIN_AUTH`; `PCLOUD_SOURCE_FOLDER_ID` becomes the only pCloud folder env var
  - [ ] Getting started: replace cron-trigger block with "navigate to `/admin/collection/add` and pick at least one file"
  - [ ] Scripts table: drop `invoke:refresh-memories`
  - [ ] Project layout: drop `media-meta/`, `refresh-memories` callout, `netlify/functions/` block, `folder-cache` mention
  - [ ] Deployment: drop "trigger the cron once via the Netlify dashboard"

- [ ] **T10**: `SPEC.md` rewrite
  - [ ] New §27 (v15 Acceptance Criteria): collection-only loader; admin sole writer of `media/<uuid>` + `fileid-index/<fileid>` + `collection/v1`; null `width`/`height`/`location`/`place` on lazy-mint with documented UI degradation; public-link accumulation accepted; no cron, no `@netlify/functions`, no `exifr`, no Geoapify
  - [ ] New §28 (v14 → v15 changes summary)
  - [ ] §7 Boundaries: drop "cron sole writer" + "public-link lifecycle owned by cron" + "Never log any geo-derived data"; add "admin route sole writer" + "public links may accumulate (single-user trade-off)"; keep IP-bound URL + `Cache-Control: private` rules
  - [ ] §4 Project Structure: drop `netlify/functions/refresh-memories.ts`, `refresh-memories.server.ts`, `media-meta/`, `folder-cache.*`; update `pcloud.server.ts` description
  - [ ] §17: annotate EXIF/mvhd retirement rule as also covering `width`/`height` post-v15
  - [ ] §23: annotate `folder/v1` fallback as superseded by §27

### Checkpoint D — Repo clean

- [ ] `pnpm type-check` clean
- [ ] `pnpm test` (both projects) green
- [ ] `pnpm lint` clean
- [ ] `pnpm format:check` clean
- [ ] `pnpm build` clean (after `rm -rf dist .netlify/blobs-serve`)

## Phase 6 — Smoke

- [ ] **T11**: Manual local smoke
  - [ ] `pnpm dev:netlify` boots
  - [ ] `/admin/collection/add` lists the source folder
  - [ ] Pick + Save → `/` renders the curated item on its capture date
  - [ ] Remove via `/admin/collection` → item drops from `/`

- [ ] **T12**: `curl -I http://localhost:8888/` reports `Cache-Control: private` / `no-store`

## Final checkpoint

- [ ] All Checkpoints A/B/C/D green
- [ ] PR open targeting `main`
- [ ] SPEC.md matches the working tree
