# Recuerdea v2 — Task List

See `tasks/plan.md` for full context, dependency graph, and acceptance criteria.

## Prerequisites (resolved)

- [x] **P0** — MP4/MOV parser approach. **APPROVED: hand-rolled `mvhd` reader** (no new dep). T1 unblocked.

## Phase 1 — Logic layer

- [x] **T1** — `src/lib/video-meta.ts` + `src/lib/video-meta.test.ts` (`extractVideoCaptureDate`). Handles `moov`-at-start and `moov`-at-end layouts. _(commit `ba37a98`)_
- [x] **T2** — `src/lib/pcloud.server.ts`: introduce `MemoryItem` discriminated union, add `fetchTodayMemories`, broaden filter to `isMediaFile`, dispatch capture-date by kind, build per-kind URLs. Remove `MemoryImage`, `fetchTodayMemoryImage`, `fetchRandomMemoryImage`, `isImageFile`. Update tests. _(commit `71dc6ae`; video uses `getfilelink` per plan's documented fallback)_

## Phase 2 — Server contract

- [x] **T3** — `src/lib/pcloud.ts`: rename `getTodayMemoryImage` → `getTodayMemories` returning `MemoryItem[]`; remove `getRandomMemoryImage`. Admin override flow unchanged. _(commit `71dc6ae`)_

## Checkpoint 1 — Server layer

- [x] `pnpm test` green for `video-meta.test.ts` and `pcloud.server.test.ts`
- [x] `pnpm lint` clean for changed `src/lib/` files
- [x] (`pnpm type-check` will still flag `index.tsx` until T4 — that's expected.)

## Phase 3 — UI layer

- [x] **T4** — `src/routes/index.tsx`: loader returns array, render `Stack` of `MemoryView` items dispatching by `kind` (image vs video). Drop random state, random button, "Show another" button. Empty state stays (no button). _(commit `71dc6ae`, follow-ups `b0a8cd0` `404fe77` `a3c1b23`)_

## Checkpoint 2 — End-to-end

- [x] `pnpm test` green (full suite)
- [x] `pnpm type-check` clean
- [x] `pnpm lint` clean
- [x] `pnpm format:check` clean
- [x] Manual browser walkthrough:
  - [x] A day with multiple image+video matches renders in oldest-year-first order
  - [x] Videos play via native controls with poster
  - [x] An empty day renders the friendly empty state with no random button
  - [x] Admin DatePicker still drives the override
- [x] `git status` shows only the expected files modified

## Post-merge cleanup (optional)

- [x] Remove leftover `console.log` instrumentation in `src/lib/pcloud.server.ts:118` and `:130` (commit `42d5750` removed others; these two slipped through).
