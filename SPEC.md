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
    index.tsx       # Today's memories feed (v2 home)
    login.tsx       # Netlify Identity login + invite/recovery callbacks
  lib/              # Pure logic + server functions; tests colocated as *.test.ts(x)
    auth.ts         # createServerFn wrapper for getServerUser
    auth.server.ts  # loadServerUser — server-only auth (isAdmin, JWT decode)
    pcloud.ts       # createServerFn wrappers for pCloud
    pcloud.server.ts# pCloud SDK init (process.env secrets), fetch/sort logic
    exif.ts         # EXIF capture-date extraction (images)
    video-meta.ts   # MP4/MOV creation_time extraction (videos) — added in v2
    identity-context.tsx
    navigation.ts   # hardNavigate (post-logout cookie refresh)
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

### Ask first

- **Adding any new top-level dependency** — including the **MP4/MOV metadata parser library** needed for v2 (e.g. `mp4box`, hand-rolled `mvhd` atom reader, etc.). List candidates and tradeoffs; wait for approval.
- Changes to `oxlint.config.ts` / `oxfmt.config.ts` / `tsconfig.json` / `vite.config.ts`.
- Changes to `.github/workflows/ci.yml`.
- Introducing a new top-level route or restructuring `src/lib/`.

### Never do

- Disable per-route SSR as a shortcut for auth issues (use `beforeLoad` instead).
- Import server-only modules (`*.server.ts`, anything reading `process.env`) from client-rendered code.
- Edit `src/routeTree.gen.ts` — it is auto-generated.
- Bypass `simple-git-hooks` with `--no-verify`.
- Swap the stack: no React Native, no Next.js, no replacing Chakra UI v3, no replacing Vitest. Stack is locked.
- Build a tagging / upload / metadata-mutation UI — out of scope for v1 and v2.
- Re-introduce the random fallback — explicitly retired in v2.

## 8. Open Questions (resolve before implementation)

1. **MP4/MOV metadata parser library** — needs approval per the "ask first" boundary. Candidates: `mp4box` (mature, ~80KB, MP4+MOV), hand-rolled `mvhd` atom reader (no dep, ~50 lines, supports both MP4 and MOV since both use ISO Base Media File Format), `mediainfo.js` (heaviest, ~3MB WASM). Recommendation will be made when planning the v2 implementation.
2. **Range-fetch strategy for video EXIF** — the `mvhd` atom may sit at the start (`moov` first) or end (`mdat` first) of an MP4. The implementation must handle both, likely via a small two-step fetch (start, then tail if `moov` not found).
3. **Future metadata store** — Netlify Blobs remains the agreed direction when tagging/upload features arrive in a later version. No schema work in v2.

## 9. v1 → v2 changes summary

For readers diffing this spec against v1:

- §1 Objective: "single image" → "every photo and video"; non-goals add "random surprise me" as retired.
- §2 Acceptance Criteria: rewritten — multi-item return shape, video kind support, mvhd date source, sort rule moved into AC, random fallback removed.
- §4 Project Structure: adds `auth.server.ts` (already shipped) and `video-meta.ts` (planned).
- §7 Boundaries: "ask first" adds the MP4/MOV parser; "never do" adds re-introducing the random fallback.
- §8 Open Questions: replaces "EXIF library" (resolved → exifr) and "pick determinism" (resolved → oldest-year-first) with "MP4/MOV parser library" + "Range-fetch strategy for video EXIF".
