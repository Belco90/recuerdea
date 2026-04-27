# Recuerdea v1 — Task List

See `tasks/plan.md` for full context, dependency graph, and acceptance criteria.

**Status: v1 complete.** Shipped in commit `fba8d66 Implement today's memory view`. Browser-verified by user 2026-04-27.

## Prerequisites (blocking)

- [x] **P0** — Approve EXIF library. → `exifr@^7.1.3` installed.

## Phase 1 — Logic layer

- [x] **T1** — `src/lib/exif.ts` + `src/lib/exif.test.ts` (`extractCaptureDate`). 11 tests passing.
- [x] **T2** — `src/lib/pcloud.server.ts`: `fetchTodayMemoryImage`, `fetchRandomMemoryImage`; `MemoryImage.captureDate: string | null`; `fetchFirstMemoryImage` removed. 13 tests passing.

## Phase 2 — Server contract

- [x] **T3** — `src/lib/pcloud.ts`: `getTodayMemoryImage` + `getRandomMemoryImage` shipped.

## Checkpoint 1 — Server layer

- [x] `pnpm type-check` clean
- [x] `pnpm test` green
- [x] Real pCloud folder smoke-test (deferred to Checkpoint 2 browser run)

## Phase 3 — UI layer

- [x] **T4** — `src/routes/index.tsx`: today / empty / random states + random fallback button.

## Checkpoint 2 — End-to-end

- [x] `pnpm test` green (44 tests)
- [x] `pnpm type-check` clean
- [x] `pnpm lint` clean
- [x] `pnpm format:check` clean
- [x] Manual browser walkthrough — user-verified in `pnpm dev`
- [x] `git status` clean after commit `fba8d66`

## Follow-up work shipped after v1

- [x] **SSR interop fix** — `exifr` CJS-at-runtime broke SSR; default-import + module-scope destructure with targeted lint suppression. Commit pending review of the broader date-override branch.
- [x] **Admin-only date override** (side request, not in original plan) — `auth.server.ts` + `?date=YYYY-MM-DD` search param + Chakra `DatePicker`. Server-side admin re-check. Uncommitted in working tree.

## Currently uncommitted (working tree)

```
M src/lib/auth.test.ts
M src/lib/auth.ts
M src/lib/pcloud.ts
M src/routes/index.tsx
?? src/lib/auth.server.ts
```

These are the admin-override changes plus the `exifr` SSR fix.
