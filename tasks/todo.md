# Recuerdea v1 — Task List

See `tasks/plan.md` for full context, dependency graph, and acceptance criteria.

## Prerequisites (blocking)

- [ ] **P0** — Approve EXIF library. Recommended: `exifr`. See `plan.md` § Prerequisite.

## Phase 1 — Logic layer

- [ ] **T1** — `src/lib/exif.ts` + `src/lib/exif.test.ts` (`extractCaptureDate`).
- [ ] **T2** — `src/lib/pcloud.server.ts`: add `fetchTodayMemoryImage`, `fetchRandomMemoryImage`; remove `fetchFirstMemoryImage`; extend `MemoryImage` with `captureDate: string | null`. Update `src/lib/pcloud.server.test.ts`.

## Phase 2 — Server contract

- [ ] **T3** — `src/lib/pcloud.ts`: replace `getFirstMemoryImage` with `getTodayMemoryImage` + `getRandomMemoryImage`.

## Checkpoint 1 — Server layer

- [ ] `pnpm typecheck` clean
- [ ] `pnpm test` green
- [ ] (optional) Smoke-test against a real pCloud folder

## Phase 3 — UI layer

- [ ] **T4** — `src/routes/index.tsx`: loader uses `getTodayMemoryImage`; render today / empty / random states; wire random fallback button.

## Checkpoint 2 — End-to-end

- [ ] `pnpm test` green
- [ ] `pnpm typecheck` clean
- [ ] `pnpm lint` clean
- [ ] `pnpm format` clean
- [ ] Manual browser walkthrough of all three render states (`pnpm dev`)
- [ ] `git status` shows only expected files modified
