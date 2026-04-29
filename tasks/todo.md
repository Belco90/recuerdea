# Recuerdea v4 — Task List

See `tasks/plan.md` for full context, dependency graph, and acceptance criteria.

## Phase 0 — SPEC + branch setup

- [x] **T0.1** — Apply 8 SPEC.md amendments + replace `tasks/plan.md` & `tasks/todo.md` with v4 versions. Single docs commit. Cite ack on amendments #4 (UUID indirection) and #5 (no-fallback loader).
- [x] **T0.2** — `git checkout -b v4` from `main` (`8d775c5`); push to `origin/v4`.

## Slice A — 410 fix (smallest possible)

- [ ] **A1** — Spike: add `src/routes/api/ping.ts` returning `Response.redirect('/login', 302)`. Verify under `pnpm netlify dev` with `curl -i http://localhost:8888/api/ping`. If TanStack Start API route convention doesn't work → STOP and re-plan with Netlify Functions fallback.
- [ ] **A2** — `src/lib/media-proxy.server.ts` + test. Pure helper: `resolveMediaUrl(fileid, variant, contenttype)` calling the right pCloud endpoint per variant.
- [ ] **A3** — `src/routes/api/media/$fileid.ts`. GET handler: validate fileid + variant, call `client.stat` for kind detection (interim — slice B replaces with cache lookup), call `resolveMediaUrl`, 302. Manual curl smoke.
- [ ] **A4** — Modify `src/lib/pcloud.server.ts`: `MemoryItem` URL fields become `/api/media/${fileid}?variant=...`. Drop `fetchThumbnailUrl` / `fetchVideoStreamUrl`. Update `src/lib/pcloud.server.test.ts`. Delete the `ping` route from A1.

## Checkpoint A — 410 fix verified

- [ ] `pnpm test` (full suite)
- [ ] `pnpm type-check`
- [ ] `pnpm lint`
- [ ] `pnpm format:check`
- [ ] `pnpm netlify dev` — sign in, verify home + admin date picker + video playback + empty state.
- [ ] PR `[v4-A] Route media through /api/media for fresh pCloud URLs` → `v4`. On the deploy preview: hard reload home, scroll lazily after 5+ min, return after 30+ min — **no 410s**. Merge into `v4`.

## Slice B — UUID indirection + expanded cache shape

- [ ] **B1** — `src/lib/media-cache.ts` + test. Pure abstraction over `MediaCacheStore`. `CachedFileMeta` carries `{ fileid, hash, kind, contenttype, name, captureDate }`. API: `lookup`, `remember`, `forget`, `listUuids`.
- [ ] **B2** — `src/lib/media-cache.server.ts` + test. Memoized `getMediaCacheStore()` with `media/` prefix; same try/catch + no-op fallback as v3.
- [ ] **B3** — `src/lib/fileid-index.ts` + test. Pure abstraction. `lookup(fileid) → uuid`, `remember(fileid, uuid)`, `forget(fileid)`.
- [ ] **B4** — `src/lib/fileid-index.server.ts` + test. Memoized factory; key prefix `fileid-index/`.
- [ ] **B5** — Modify `src/lib/pcloud.server.ts` + tests: replace v3 capture-cache wiring with media-cache + fileid-index. Loader mints uuids on first sight, writes both stores, `MemoryItem` carries `uuid` (not `fileid`). New tests for hit / miss / hash-mismatch / existing-uuid-reuse.
- [ ] **B6** — Rename `src/routes/api/media/$fileid.ts` → `$uuid.ts`. Reads `mediaCache.lookup(uuid)`, resolves variant default from cached `kind`, calls pCloud, 302. 404 if uuid not in cache. Drops the slice-A `client.stat` call.
- [ ] **B7** — Modify `src/routes/index.tsx`: `memoryKey(item)` returns `item.uuid`.
- [ ] **B8** — Delete `src/lib/capture-cache.ts`, `capture-cache.test.ts`, `capture-cache.server.ts`, `capture-cache.server.test.ts`. Verify `rg 'capture-cache' src/` returns nothing.

## Checkpoint B — UUID indirection verified

- [ ] `pnpm test`
- [ ] `pnpm type-check`
- [ ] `pnpm lint`
- [ ] `pnpm format:check`
- [ ] `pnpm netlify dev` — view-source on home, grep HTML for a known pCloud `fileid` → **must not appear**. Only uuids + `/api/media/<uuid>`.
- [ ] PR `[v4-B] UUID indirection + expanded cache shape` → `v4`. Smoke deploy preview. Merge into `v4`.

## Slice C — Cron + folder snapshot + stale cleanup

- [ ] **C1** — Add `@netlify/functions` to `dependencies`. (Ack: P1, pre-approved in plan-mode review.)
- [ ] **C2** — Add `[functions."refresh-cache"]` block to `netlify.toml` with `schedule = "0 4 * * *"`. (Ack: P2, pre-approved.)
- [ ] **C3** — `src/lib/folder-cache.ts` + test. Pure abstraction over `FolderCacheStore`. `FolderSnapshot = { refreshedAt, uuids }`.
- [ ] **C4** — `src/lib/folder-cache.server.ts` + test. Memoized factory, single key `folder/v1`.
- [ ] **C5** — `netlify/functions/refresh-cache.ts` + test. `schedule('0 4 * * *', handler)` from `@netlify/functions`. Lists folder, fills missing/stale media-cache entries, writes snapshot, deletes stale `media/<uuid>` + `fileid-index/<fileid>` for orphans. Test with in-memory fakes for all three stores + a fake pcloud-kit client.
- [ ] **C6** — Modify `src/lib/pcloud.ts` (the `getTodayMemories` server function): reads `folder-cache.lookup()` + per-uuid `media-cache.lookup()` only. **No `client.listfolder` call.** If snapshot missing → return `[]` and `console.warn`. New unit test for the cached-loader path.
- [ ] **C7** — Refactor `src/lib/pcloud.server.ts`: extract `populateMediaCacheForFile(client, file, mediaCache, fileidIndex)` (used by cron). Delete `fetchTodayMemories` (loader no longer calls it). Tests rewritten.

## Checkpoint C — Cron-warmed hot path verified

- [ ] `pnpm test`
- [ ] `pnpm type-check`
- [ ] `pnpm lint`
- [ ] `pnpm format:check`
- [ ] `pnpm build` — `@netlify/functions` does NOT appear in `dist/client/`.
- [ ] PR `[v4-C] Cron-warmed cache + stale cleanup` → `v4`. On the deploy preview:
  - [ ] Manually trigger the cron via Netlify dashboard ("Run now").
  - [ ] Inspect Blobs panel: `folder/v1`, multiple `media/<uuid>`, multiple `fileid-index/<fileid>` entries.
  - [ ] Visit `/` — network tab shows **zero** `*.pcloud.com` requests; only `/api/media/<uuid>`.
  - [ ] Admin date override + empty state + video playback unchanged.
- [ ] Merge into `v4`.

## Slice D — Refactor `routes/index.tsx` (nice-to-have)

- [ ] **D1** — `src/lib/date-utils.ts` + test. Lift `parseSearchDate`, `isoToOverride`, `todayIso`, `formatCaptureDate` from `routes/index.tsx`.
- [ ] **D2** — `src/components/MemoryView.tsx`. Lift the existing `<MemoryView>` component.
- [ ] **D3** — `src/components/AdminDateOverride.tsx`. Lift the existing component; pass navigate handler as prop if `Route.useNavigate` doesn't resolve outside the route file.
- [ ] **D4** — `src/components/Home.tsx`. Pure presentational; receives `{ user, memories, activeDate, onLogout, onSelectDate? }`.
- [ ] **D5** — Modify `src/routes/index.tsx`: route definition + thin wrapper that pulls loader data + identity context + forwards to `<Home>`. Target ≤ 40 lines.

## Checkpoint D — Refactor verified

- [ ] `pnpm test`
- [ ] `pnpm type-check`
- [ ] `pnpm lint`
- [ ] `pnpm format:check`
- [ ] `wc -l src/routes/index.tsx` — ≤ ~40 lines.
- [ ] `pnpm netlify dev` — home renders identically to slice C.
- [ ] PR `[v4-D] Refactor home route into components/` → `v4`. Smoke deploy preview. Merge into `v4`.

## Final — `v4 → main`

- [ ] Open PR `v4 → main` (no slice tag). Smoke deploy preview end-to-end.
- [ ] Trigger the prod cron manually so the snapshot exists in prod Blobs at merge time.
- [ ] Merge.
- [ ] Post-merge prod smoke: visit `/`, network tab shows only `/api/media/<uuid>` requests, no 410s, video plays.
