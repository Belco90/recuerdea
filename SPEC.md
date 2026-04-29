# Recuerdea — Specification

## 1. Objective

Recuerdea is a personal **"on this day" memory surfacer**. Each visit to the home page surfaces every photo and video taken on today's month/day in a past year, drawn from a pCloud folder owned by the user. The product goal is rediscovery: turn a static cloud archive into a daily ritual that resurfaces forgotten moments.

**Target user**: a single authenticated user (the owner). Multi-tenant / shared-album use cases are explicitly out of scope.

**Non-goals (v2)**:

- Uploading, editing, or deleting media.
- Tagging, captioning, or otherwise mutating media metadata.
- Browsing arbitrary media in a gallery view (gallery / search / filter).
- A random "surprise me" surface (was an empty-state fallback in v1; retired in v2).

## 2. v2 Acceptance Criteria

- `GET /` (authenticated): server returns **all** media items in the pCloud folder whose capture date matches today's month/day in any past year.
- Each item carries a media kind (`'image'` or `'video'`), a display URL, and a capture date.
- Capture date sources:
  - **Images**: EXIF `DateTimeOriginal` (fallback `DateTime`).
  - **Videos**: container `creation_time` from MP4/MOV (`mvhd` atom).
  - Items with no parseable capture date are skipped (not silently shown as today's match).
- Items are sorted oldest year first; tiebreak by `fileid` ascending. Order is stable across same-day refreshes.
- Layout: vertical scrollable feed (one item per row, full-width media). Each row shows the media, its formatted capture date, and visually distinguishes image vs video (e.g. via the player UI itself).
- Videos render with `<video controls>`, no autoplay, with a poster from pCloud's `getthumblink`. Stream URL via pCloud's `getvideolink`.
- If no item matches, render a friendly empty state ("No memories on this day"). **No random fallback button.**
- Unauthenticated visits redirect to `/login` via `beforeLoad` (unchanged).
- pCloud SDK access stays server-only via `createServerFn` (unchanged).
- Admin date override (`?date=YYYY-MM-DD`) continues to work; it now drives the multi-item match instead of the single-item match.

## 3. Commands

| Command           | Purpose                                         |
| ----------------- | ----------------------------------------------- |
| `pnpm install`    | Install deps (pnpm 10.30.2).                    |
| `pnpm dev`        | Start the Vite dev server.                      |
| `pnpm build`      | Production build.                               |
| `pnpm test`       | Run Vitest in browser mode (headless Chromium). |
| `pnpm lint`       | Run oxlint.                                     |
| `pnpm format`     | Run oxfmt.                                      |
| `pnpm type-check` | Run `tsc --noEmit`.                             |

CI (`.github/workflows/ci.yml`) runs type-check, test, lint, and format-check in parallel; all must pass.

## 4. Project Structure

```
src/
  routes/           # TanStack Router file-based routes
    __root.tsx
    index.tsx       # Home route — wiring only; UI lives in components/ (v4)
    login.tsx       # Netlify Identity login + invite/recovery callbacks
    api/
      media.$fileid.ts # GET /api/media/:fileid → 302 to fresh pCloud URL — added in v4
  components/       # Presentational React components (no server/IO)  — added in v4
    home.tsx        # <Home> shell
    memory-view.tsx # Renders one MemoryItem (image/video)
    admin-date-override.tsx # Admin date picker
  lib/              # Pure logic + server functions; tests colocated as *.test.ts(x)
    auth.ts         # createServerFn wrapper for getServerUser
    auth.server.ts  # loadServerUser — server-only auth (isAdmin, JWT decode)
    pcloud.ts       # createServerFn wrappers for pCloud
    pcloud.server.ts# pCloud SDK init (process.env secrets), fetch/sort logic
    exif.ts         # EXIF capture-date extraction (images)
    video-meta.ts   # MP4/MOV creation_time extraction (videos) — added in v2
    filename-date.ts# Filename-based capture-date fallback
    capture-cache.ts        # Pure (fileid, hash) → CachedFileMeta cache abstraction — v3, expanded in v4
    capture-cache.server.ts # Netlify-Blobs-backed CaptureCacheStore + no-op fallback — added in v3
    folder-cache.ts         # Pure folder-listing cache abstraction — added in v4
    folder-cache.server.ts  # Netlify-Blobs-backed folder snapshot store — added in v4
    media-proxy.server.ts   # Resolves fresh pCloud URLs on demand (no caching) — added in v4
    date-utils.ts   # parseSearchDate, isoToOverride, todayIso, formatCaptureDate — added in v4
    identity-context.tsx
    navigation.ts   # hardNavigate (post-logout cookie refresh)
  server/
    refresh-cache.ts # Scheduled Netlify Function: pre-warms folder + per-file caches — added in v4
  router.tsx        # getRouter() factory
  routeTree.gen.ts  # auto-generated, never edit by hand
test/
  setup.ts          # Vitest browser-mode setup, mocks @netlify/identity
  stubs/            # Stubs for @tanstack/react-start in browser mode
__mocks__/
  @netlify/identity.ts
```

Path alias `#/*` → `./src/*` (declared in `package.json` `imports`).

## 5. Code Style

- **Formatter**: oxfmt (config: `oxfmt.config.ts`). Tabs for indentation, single quotes, no semicolons.
- **Linter**: oxlint (config: `oxlint.config.ts`).
- **Pre-commit**: `simple-git-hooks` + `nano-staged` runs `oxlint --fix` and `oxfmt` on staged files. Never bypass with `--no-verify`.
- **Comments**: minimal — only when _why_ is non-obvious. No "what" comments for self-documenting code.
- **Imports**: prefer the `#/*` alias for cross-module imports inside `src/`.
- **Immutability + functional style (v4+)**: prefer `const` + expression-style code. Update objects/arrays via spread / `.map` / `.filter` / `.reduce`, not in-place mutation. Use `readonly` on shared types and `as const` for literal tuples/objects. `let` is allowed only inside narrow accumulator scopes where the pure version is materially worse to read; functions should not return mutated parameters. When tightening rules, add a single oxlint rule per PR rather than turning on a preset wholesale.

## 6. Testing Strategy

- **Required**: Vitest browser-mode tests for any new logic added to `src/lib/`. Tests colocate with source as `*.test.ts(x)`.
- **Optional**: Route-level / UI tests are nice-to-have but not blocking.
- **Setup**: `test/setup.ts` mocks `@netlify/identity` and shims `globalThis.process`. New tests should reuse this setup, not re-mock from scratch.
- **CI gate**: `pnpm test` must pass on every PR (matrix in `.github/workflows/ci.yml`).
- **Server functions**: test the pure helpers they wrap, not the `createServerFn` wrapper itself (which is framework code).

## 7. Boundaries

### Always do

- Use TanStack Router `beforeLoad` + router context for route auth guards (existing pattern: `src/routes/index.tsx`, `src/routes/login.tsx`).
- Keep server-only secrets (pCloud credentials, future tokens) behind `createServerFn` (`src/lib/pcloud.ts`, `src/lib/pcloud.server.ts`, `src/lib/auth.server.ts`). Read from `process.env` only inside server-only modules.
- Colocate tests with source under `src/lib/` for any new pure logic.
- Use the existing path alias `#/*` for `src/` imports.
- **Branch-per-version (v4+)**: do v4 work on a `v4` branch, v5 on `v5`, etc. PRs target `main` so Netlify spins a deploy preview per PR. `main` is protected — no direct pushes. Smoke the deploy preview before merge.
- **Resolve pCloud signed URLs at request time, not at SSR time**: media URLs go through `/api/media/:fileid` (302 to a fresh `getfilelink` / `getthumblink` / `getvideolink`). Never persist a pCloud URL in SSR HTML, loader cache, or Blobs.

### Ask first

- **Adding any new top-level dependency** — including the **MP4/MOV metadata parser library** needed for v2 (e.g. `mp4box`, hand-rolled `mvhd` atom reader, etc.). List candidates and tradeoffs; wait for approval.
- Changes to `oxlint.config.ts` / `oxfmt.config.ts` / `tsconfig.json` / `vite.config.ts`.
- Changes to `.github/workflows/ci.yml` or `netlify.toml` (the latter is added under "ask first" in v4 because the scheduled-function block lives there).
- Introducing a new top-level route or restructuring `src/lib/`.

### Never do

- Disable per-route SSR as a shortcut for auth issues (use `beforeLoad` instead).
- Import server-only modules (`*.server.ts`, anything reading `process.env`) from client-rendered code.
- Edit `src/routeTree.gen.ts` — it is auto-generated.
- Bypass `simple-git-hooks` with `--no-verify`.
- Swap the stack: no React Native, no Next.js, no replacing Chakra UI v3, no replacing Vitest. Stack is locked.
- Build a tagging / upload / metadata-mutation UI — out of scope for v1 and v2.
- Re-introduce the random fallback — explicitly retired in v2.
- **Cache pCloud signed URLs (v4+)**: never store `getfilelink` / `getthumblink` / `getvideolink` results anywhere with a TTL longer than a single request. Caching them was the v3-era 410 bug. The cache holds content-derived metadata (`kind`, `contenttype`, `name`, `captureDate`); URLs are always fresh.
- Push directly to `main` — open a PR from the version branch instead.

## 8. Open Questions (resolve before implementation)

1. **MP4/MOV metadata parser library** — resolved in v2 (hand-rolled mvhd reader, no dep).
2. **Range-fetch strategy for video EXIF** — resolved in v2 (two-step start/tail fetch).
3. **Metadata store** — Netlify Blobs is shipped for the capture-date cache (v3) and expanded in v4 to hold the full `CachedFileMeta` ({ kind, contenttype, name, captureDate }) keyed under `v2/`, plus a `folder/v1` listing snapshot. `consistency: 'eventual'`, with a no-op fallback when the Blobs runtime isn't reachable (plain `pnpm dev`). Tagging/upload metadata stores remain future work.
4. **Media proxy strategy (v4)** — the `/api/media/:fileid` endpoint resolves a fresh pCloud URL per request and returns a 302 redirect (image/poster) or 302 to the streaming URL (video). 302 keeps our function out of the byte path. Streaming bytes through Netlify is rejected (cost + bandwidth). Open: should `?kind=poster|stream` be an explicit query param, or inferred from the cached `contenttype`? Default plan: infer.
5. **Cron schedule (v4)** — `@daily` at a low-traffic UTC hour. Open question is whether to also run it on-demand from the home loader when the snapshot is missing/expired (yes — fall back to a live `listfolder` so the page never breaks if the cron skipped a day).
6. **Cache invalidation (v4)** — pCloud's `hash` invalidates per-file entries (rename ≠ content change). Folder snapshot is replaced wholesale by the cron. Removed files leave stale per-file entries; harmless and cheap.
7. **Scalability budget (v4)** — design for ~1000 files in the folder, ~30 matched-day items per visit. Hot path must be ≤ 1 Blob read for the snapshot + N reads for matched files. No `listfolder` and no extractor calls on the hot path. Function timeout (10 s) is the operative ceiling on the cron.

## 9. v1 → v2 changes summary

For readers diffing this spec against v1:

- §1 Objective: "single image" → "every photo and video"; non-goals add "random surprise me" as retired.
- §2 Acceptance Criteria: rewritten — multi-item return shape, video kind support, mvhd date source, sort rule moved into AC, random fallback removed.
- §4 Project Structure: adds `auth.server.ts` (already shipped) and `video-meta.ts` (planned).
- §7 Boundaries: "ask first" adds the MP4/MOV parser; "never do" adds re-introducing the random fallback.
- §8 Open Questions: replaces "EXIF library" (resolved → exifr) and "pick determinism" (resolved → oldest-year-first) with "MP4/MOV parser library" + "Range-fetch strategy for video EXIF".

## 10. v2 → v3 changes summary

For readers diffing this spec against v2:

- §1 Objective and §2 Acceptance Criteria: unchanged. v3 is purely a latency/cost win — same memories, same sort, same UI shape.
- §4 Project Structure: adds `capture-cache.ts` (pure abstraction over a `CaptureCacheStore`) and `capture-cache.server.ts` (Netlify-Blobs-backed store, memoized factory, no-op fallback when the Blobs runtime isn't reachable).
- §7 Boundaries: `@netlify/blobs` landed under "ask first" as a `dependencies` (server-bundle) entry.
- §8 Open Questions: §8.3 Future metadata store flips from "agreed direction" to "shipped for the capture-date cache." Capture-date extraction now consults the cache before calling `getfilelink` + EXIF/mvhd; cache hits skip both the API call and the range-fetch. pCloud's content-derived `hash` is part of the cache key, so renames don't invalidate; negative results (`null`) are cached too.

## 11. v4 Acceptance Criteria

Cumulative on top of §2. v4 is a correctness fix (410) plus an aggressive caching / pre-warming pass.

**Correctness**

- No production 410s on `<img>` / `<video>` / poster requests, including: (a) lazy-scrolled items rendered minutes after page load, (b) re-renders driven by TanStack Router's loader cache, (c) browser back/forward into a previously-rendered home page.
- Achieved by routing every media reference through `/api/media/:fileid`, which 302-redirects to a freshly-signed pCloud URL on each request. No pCloud signed URL is ever serialized into HTML, loader cache, or Blobs.

**Cache shape**

- Per-file Blobs entry stores `CachedFileMeta = { hash, kind: 'image' | 'video', contenttype, name, captureDate: string | null }`, keyed `v2/${fileid}`. The `v2/` prefix is intentional (shape change vs. v3's `v1/`).
- A single folder-snapshot Blobs entry keyed `folder/v1` stores `{ refreshedAt: string, fileids: number[] }`.
- Hash mismatch on a per-file lookup is treated as a miss and overwritten.

**Cron**

- A Netlify Scheduled Function runs at least daily and: (1) calls `listfolder` once, (2) fills any per-file entries missing or with stale hashes, (3) writes a fresh `folder/v1` snapshot.
- The cron is idempotent and safe to run concurrently with user requests.
- If the cron has not run yet (cold deploy), the home route falls back to a live `listfolder` + on-demand cache fill so the page still renders. This fallback path is logged.

**Hot path**

- A user visit to `/` performs: 1× snapshot read, N× per-file reads (where N = files in folder), filter to today's day, sort, render. **Zero pCloud API calls** when the cache is warm. Media URLs are resolved by the browser hitting `/api/media/:fileid`, one round-trip per element.

**Layout / UX**

- Unchanged from v2 (vertical feed, image vs. video distinguished by player UI, oldest year first, admin date override).

**Workflow**

- v4 work happens on a `v4` branch with a PR into `main`; Netlify produces a deploy preview per PR. The 410 fix is verified on the preview before merge.

## 12. v3 → v4 changes summary

For readers diffing this spec against v3:

- §1 / §2: unchanged. v4 fixes a prod bug and aggressively pre-warms caching; UI and product are the same.
- §4 Project Structure: adds `src/components/`, `src/routes/api/media.$fileid.ts`, `src/lib/folder-cache(.server).ts`, `src/lib/media-proxy.server.ts`, `src/lib/date-utils.ts`, and `src/server/refresh-cache.ts` (the scheduled function). The home route file shrinks to wiring only.
- §5 Code Style: adds an immutability + functional-style guideline (prefer `const`, expression-style returns, `readonly` types; `let` allowed only in narrow accumulator scopes).
- §7 Boundaries: "always do" adds branch-per-version + resolve-URLs-at-request-time. "ask first" extends to `netlify.toml` (scheduled-function block lives there). "never do" adds caching pCloud signed URLs and direct pushes to `main`.
- §8 Open Questions: replaces resolved v2/v3 entries with v4-relevant ones (media proxy strategy, cron schedule, invalidation, scalability budget). The capture-date cache shape moves from `v1/` (capture date only) to `v2/` (full `CachedFileMeta`).
- §11 (new): v4 acceptance criteria — 410 fix, expanded cache, cron pre-warming, request-time URL resolution.
