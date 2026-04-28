# Recuerdea v2 — Task List

See `tasks/plan.md` for full context, dependency graph, and acceptance criteria.

## Prerequisites (resolved)

- [x] **P0** — MP4/MOV parser approach. **APPROVED: hand-rolled `mvhd` reader** (no new dep). T1 unblocked.

## Phase 1 — Logic layer

- [ ] **T1** — `src/lib/video-meta.ts` + `src/lib/video-meta.test.ts` (`extractVideoCaptureDate`). Handles `moov`-at-start and `moov`-at-end layouts.
- [ ] **T2** — `src/lib/pcloud.server.ts`: introduce `MemoryItem` discriminated union, add `fetchTodayMemories`, broaden filter to `isMediaFile`, dispatch capture-date by kind, build per-kind URLs (`getvideolink` + `getthumblink` for video). Remove `MemoryImage`, `fetchTodayMemoryImage`, `fetchRandomMemoryImage`, `isImageFile`. Update tests.

## Phase 2 — Server contract

- [ ] **T3** — `src/lib/pcloud.ts`: rename `getTodayMemoryImage` → `getTodayMemories` returning `MemoryItem[]`; remove `getRandomMemoryImage`. Admin override flow unchanged.

## Checkpoint 1 — Server layer

- [ ] `pnpm test` green for `video-meta.test.ts` and `pcloud.server.test.ts`
- [ ] `pnpm lint` clean for changed `src/lib/` files
- [ ] (`pnpm type-check` will still flag `index.tsx` until T4 — that's expected.)

## Phase 3 — UI layer

- [ ] **T4** — `src/routes/index.tsx`: loader returns array, render `Stack` of `MemoryView` items dispatching by `kind` (image vs video). Drop random state, random button, "Show another" button. Empty state stays (no button).

## Checkpoint 2 — End-to-end

- [ ] `pnpm test` green (full suite)
- [ ] `pnpm type-check` clean
- [ ] `pnpm lint` clean
- [ ] `pnpm format:check` clean
- [ ] Manual browser walkthrough:
  - [ ] A day with multiple image+video matches renders in oldest-year-first order
  - [ ] Videos play via native controls with poster
  - [ ] An empty day renders the friendly empty state with no random button
  - [ ] Admin DatePicker still drives the override
- [ ] `git status` shows only the expected files modified
