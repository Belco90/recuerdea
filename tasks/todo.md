# Recuerdea v3 — Task List

See `tasks/plan.md` for full context, dependency graph, and acceptance criteria.

## Prerequisites

- [x] **P0** — Add `@netlify/blobs` to `dependencies` (per `SPEC.md §7` "ask first" boundary). _(commit `3838d9e`)_

## Phase 1 — Cache abstraction

- [x] **T1** — `src/lib/capture-cache.ts` + `src/lib/capture-cache.test.ts`. Pure `createCaptureCache(store)` with `lookup` / `remember`. Hash mismatch returns `undefined` (treated as miss). `null` capture dates round-trip correctly.

## Phase 2 — Netlify Blobs adapter

- [x] **T2** — `src/lib/capture-cache.server.ts` + `src/lib/capture-cache.server.test.ts`. Memoized `getCaptureCacheStore()`. Try `getStore({ name: 'capture-date-cache', consistency: 'eventual' })`; on failure fall back to a no-op store and `console.warn` once. Live-store branch verified manually in T4.

## Phase 3 — Wire cache into the server pipeline

- [x] **T3** — `src/lib/pcloud.server.ts` + `src/lib/pcloud.server.test.ts`. `safeExtractCaptureDate` takes a cache, looks up first, only calls `getfilelink` + extractors on miss/mismatch, writes back the result (including `null`). Drop the two `[memories]` `console.log` blocks (`pcloud.server.ts:118–125`, `:130–135`). New tests: hit (no extractor calls), miss (extractor + remember), hash mismatch (extractor + overwrite).

## Checkpoint 1 — Server layer green

- [x] `pnpm test` (full suite)
- [x] `pnpm type-check`
- [x] `pnpm lint`
- [x] `pnpm format:check`

## Phase 4 — End-to-end verification

- [ ] **T4** — Run under `pnpm netlify dev` (port 8888, Blobs runtime injected):
  - [ ] Cold visit: latency similar to v2.
  - [ ] Warm reload: visibly faster; far fewer `getfilelink` calls in DevTools network tab.
  - [ ] Empty state, video playback, admin `?date=YYYY-MM-DD` override all unchanged.
  - [ ] Rename a file in pCloud (no content change) → cache still hits (hash unchanged).
  - [ ] No `[memories] ...` console noise in dev.

## Checkpoint 2 — Prod smoke

- [ ] Deploy to Netlify (auto on merge).
- [ ] Hit prod `/`, hard reload, then reload again — second reload visibly faster.
- [ ] Netlify dashboard → Blobs → `capture-date-cache` store shows entries.

## Spec sync (post-implementation)

- [ ] `SPEC.md` — add §10 "v2 → v3 changes summary" mirroring §9; update §8.3 from "agreed direction" to "shipped for capture-date cache."
