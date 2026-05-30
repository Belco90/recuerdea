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
- Capture date source:
  - pCloud's `file.created` field, returned directly by `listfolder`. v2's EXIF / mvhd extraction was retired in v10 — see §17.
  - Items with no parseable `file.created` are skipped (not silently shown as today's match).
- Items are sorted **newest year first**; tiebreak by `fileid` ascending. Order is stable across same-day refreshes. (v1/v2 sorted oldest-year-first; flipped in commit `1cc010d` and locked in in v10.)
- Layout: vertical scrollable feed (one item per row, full-width media). Each row shows the media, its formatted capture date, and visually distinguishes image vs video (e.g. via the player UI itself).
- Videos render with `<video controls>`, no autoplay, with a poster from a pCloud public-link thumbnail. Stream URL via pCloud public-link download.
- If no item matches, render a friendly empty state ("No memories on this day"). **No random fallback button.**
- Unauthenticated visits redirect to `/login` via `beforeLoad` (unchanged).
- pCloud SDK access stays server-only via `createServerFn` and the cron Netlify function. The pCloud auth token never leaves the server.
- Media is delivered through `/api/memory/<uuid>?variant=image|stream|poster` — an auth-gated route that byte-streams the upstream pCloud public-link response. UUIDs are stable identifiers minted by the cron; `fileid` and the public-link `code` stay server-side and never reach the browser (see §11).
- Admin date override (`?date=YYYY-MM-DD`) continues to work; it now drives the multi-item match instead of the single-item match.

## 3. Commands

| Command                        | Purpose                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `pnpm install`                 | Install deps (pnpm 10.30.2).                                                 |
| `pnpm dev`                     | Vite dev server on port 3000 (no Functions / Blobs).                         |
| `pnpm dev:netlify`             | `netlify dev` on port 8888 — production-shaped local with Functions + Blobs. |
| `pnpm build`                   | Production build.                                                            |
| `pnpm preview`                 | Preview the production build locally.                                        |
| `pnpm test`                    | Run all Vitest projects (`unit` + `browser`).                                |
| `pnpm test:unit`               | Run only the Node unit project.                                              |
| `pnpm test:browser`            | Run only the browser project (headless Chromium via Playwright).             |
| `pnpm lint` / `pnpm lint:fix`  | oxlint.                                                                      |
| `pnpm format` / `format:check` | oxfmt.                                                                       |
| `pnpm type-check`              | `tsc --noEmit`.                                                              |
| `pnpm invoke:refresh-memories` | Invoke the scheduled function on the local Netlify dev server.               |

CI (`.github/workflows/ci.yml`) runs type-check, test, lint, and format-check in parallel; all must pass.

## 4. Project Structure

```
src/
  routes/           # TanStack Router file-based routes
    __root.tsx
    index.tsx       # Home route — beforeLoad auth gate + loader + Home component (composes Topbar, AdminDateOverride, Hero, Timeline / YearSection / Polaroid, EmptyState, Lightbox)
    login.tsx       # Netlify Identity login + invite/recovery callbacks (analog-album layout — v5)
    admin/
      collection.tsx      # Layout route — admin gate + curated-collection loader + shared chrome (AppShell + Topbar + heading) + <Outlet />. v14.
      collection/
        index.tsx         # /admin/collection leaf — curated grid + "Añadir más" link. v14.
        add.tsx           # /admin/collection/add leaf — AdminFolderNavigator picker (validateSearch ?folderid=, source-folder loader, picked state, save/cancel handlers). v14.
    api/
      video/
        $uuid.ts          # GET /api/video/:uuid[?download=1] — auth-gated, byte-streams pCloud video bytes; range forwarded for stream, stripped for download. v9 demolished /api/memory/<uuid>; v10 reintroduced this narrower proxy because `getpublinkdownload` URLs are IP-bound (see §17).
      admin/
        thumb/
          $fileid.ts      # GET /api/admin/thumb/:fileid — auth-gated proxy: mints `getthumblink` server-side and pipes bytes back as image/jpeg. Used by the source-folder navigator because pCloud thumb URLs are IP-bound (SPEC §17). v14.
  components/       # Reusable presentational React components (PascalCase per file). All Chakra-native — v5.
    AppShell.tsx          # Page-level Box wrapper (paper bg lives on body via globalCss)
    Wordmark.tsx          # Italic Fraunces "Recuerdea" wordmark with rotated R + accent dot
    Topbar.tsx            # Sticky blurred topbar — Wordmark + ClientOnly-wrapped AccountDrawer (Cuenta drawer with name/email + logout) — v10
    Hero.tsx              # Big day + italic-accent month + mono caps year/count meta
    EmptyState.tsx        # Three striped polaroids + Spanish empty copy
    Polaroid.tsx          # Polaroid tile (paper frame, stable rotation, square-cropped lazy image/video poster, video badge, handwritten caption) — v10 squared crop
    YearSection.tsx       # Year-marker dot + "Hace N año(s)" title + columnCount masonry of Polaroid tiles
    Timeline.tsx          # Vertical timeline line + end dot + Spanish footer
    Lightbox.tsx          # Per-year fullscreen Chakra Dialog (image or video controls autoPlay, swipe, arrow keys, dots, blob-download button)
    AdminDateOverride.tsx # Admin-only banner: striped diagonal bg + paper tape + Chakra DatePicker + state pill
  lib/                # Pure logic + server functions; split by domain. Tests colocated as *.test.ts(x); browser tests as *.browser.test.ts(x).
    auth/                       # User identity end-to-end
      auth.ts                   # createServerFn wrapper for getServerUser
      auth.server.ts            # loadServerUser — server-only auth (isAdmin, JWT decode)
      identity-context.tsx      # IdentityProvider + useIdentity hook
    memories/                   # pCloud-backed memory pipeline
      pcloud.ts                 # createServerFn wrapper for getTodayMemories — returns MemoryItem[]
      pcloud.server.ts          # Loader — reads from collection-cache + media-cache only; builds thumb URLs synchronously; videos point at /api/video/<uuid>. No listfolder, no pCloud client.
      pcloud-urls.server.ts     # buildThumbUrl (stateless `getpubthumb?code=…&size=…`) + resolveMediaUrl (server-side `getpublinkdownload`) — v9
      refresh-memories.server.ts# Cron orchestrator: lists folder, ensures public links, writes caches, sweeps deleted files — v4
      video-stream.server.ts    # Pure handler for /api/video/$uuid: auth gate, cache lookup, range-forwarded byte-stream or download response — v10
      get-download-url.ts       # createServerFn wrapper that resolves a fresh download URL (used for image originals) — v9
      get-download-url.server.ts# Pure resolveDownloadUrl(uuid, deps) — auth + cache + resolveMediaUrl
      download.ts               # Browser blob-download helper (fetch → blob → object URL → anchor click → revoke) — v9
      memory-grouping.ts        # groupMemoriesByYear pure helper — v5
    cache/                      # Netlify-Blobs-backed stores; each pair = pure abstraction + server store-getter with no-op fallback — v4
      media-cache.ts            # Pure (uuid → CachedMedia) cache abstraction. CachedMedia carries width/height (v5), location + place (v6).
      media-cache.server.ts
      fileid-index.ts           # Pure (fileid → uuid) sidecar abstraction
      fileid-index.server.ts
    media-meta/                 # Dimensions + GPS extraction from bytes; called from refresh-memories.server. Capture date now comes from pCloud `file.created` (v10) — extractors no longer return it.
      exif.ts                   # EXIF extraction (extractImageMeta) — width/height + GPS lat/lng
      video-meta.ts             # MP4/MOV moov walker (extractVideoMeta) — width/height (tkhd) + GPS (udta.©xyz)
      geoapify.server.ts        # v6 — Reverse-geocode lat/lng → Spanish place string via Geoapify; raw fetch, body-status authoritative, tagged failure reasons
    utils/                      # Small leaf helpers
      spanish-months.ts         # SPANISH_MONTHS const + spanishMonth(idx) — used by Hero, login, AdminDateOverride — v5
      rotation.ts               # Stable per-key rotation for polaroid scatter — v5
      navigation.ts             # hardNavigate (post-logout cookie refresh)
      years-ago.ts              # yearsAgo(captureYear, todayYear) — pure helper, replaces ad-hoc inline math in YearSection
  env.d.ts          # NodeJS.ProcessEnv typing for PCLOUD_TOKEN + PCLOUD_MEMORIES_FOLDER_ID
  theme.ts          # Chakra v3 createSystem — accent.50…950 palette, semantic light/dark tokens, fonts, shadows, keyframes, breakpoints.md=720px, paper-noise body bg via globalCss — v5
  fonts.css         # @font-face declarations for the four self-hosted variable woff2 in public/fonts/ — v5
  router.tsx        # getRouter() factory
  routeTree.gen.ts  # auto-generated, never edit by hand
public/
  fonts/            # Self-hosted variable woff2 (Fraunces, Inter, Caveat, JetBrains Mono — latin subset only) — v5
test/
  setup.ts          # Vitest setup — mocks @netlify/identity, shims globalThis.process
  stubs/            # Stubs for @tanstack/react-start in browser mode
__mocks__/
  @netlify/identity.ts
netlify/
  functions/
    refresh-memories.ts # Scheduled Netlify Function: lists folder, ensures public links, writes caches, sweeps deleted files — added in v4 (registered via netlify.toml [functions."refresh-memories"] schedule)
patches/
  @netlify__identity.patch # pnpm patch — Netlify Identity hardcodes session cookies; the patch raises Max-Age to 30d so logins survive page reloads. Re-apply on library upgrade.
scripts/
  oauth-provision.mjs # One-time pCloud OAuth bootstrap — exchanges an authorize code for the access token used as PCLOUD_TOKEN.
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

- **Two Vitest projects** (configured in `vitest.config.ts`):
  - `unit` — Node environment, runs `src/**/*.test.{ts,tsx}` (excluding `*.browser.test.*`). Use for pure logic in `src/lib/`.
  - `browser` — headless Chromium via Playwright, runs `src/**/*.browser.test.{ts,tsx}`. Use for component render / interaction tests.
- **Required**: Tests for any new logic added to `src/lib/`, colocated as `*.test.ts(x)`. Component tests are encouraged but not blocking; when written, name them `*.browser.test.tsx` so they land in the browser project.
- **Setup**: `test/setup.ts` mocks `@netlify/identity` and shims `globalThis.process`. New tests should reuse this setup, not re-mock from scratch.
- **CI gate**: `pnpm test` (both projects) must pass on every PR (matrix in `.github/workflows/ci.yml`). `pnpm test:unit` and `pnpm test:browser` are available for targeted runs.
- **Server functions**: test the pure helpers they wrap (e.g. `resolveDownloadUrl`, `handleVideoStreamRequest`, `fetchTodayMemories`), not the `createServerFn` wrapper itself (which is framework code).

## 7. Boundaries

### Always do

- Use TanStack Router `beforeLoad` + router context for route auth guards (existing pattern: `src/routes/index.tsx`, `src/routes/login.tsx`).
- Keep server-only secrets (pCloud credentials, future tokens) behind `createServerFn` and Netlify functions (`src/lib/memories/pcloud.ts`, `src/lib/memories/pcloud.server.ts`, `src/lib/auth/auth.server.ts`, `netlify/functions/*.ts`). Read `process.env` only inside server-only modules.
- **Auth-gate every API endpoint** in `src/routes/api/`. Each handler must call `loadServerUser()` and 401 unauthenticated callers — defense-in-depth on top of `beforeLoad`.
- Colocate tests with source under `src/lib/` for any new pure logic.
- Use the existing path alias `#/*` for `src/` imports.
- **Branch-per-version (v4+)**: do v4 work on a `v4` branch, v5 on `v5`, etc. PRs target `main` so Netlify spins a deploy preview per PR. `main` is protected — no direct pushes. Smoke the deploy preview before merge.
- **Resolve image URLs server-side in the loader (v9).** The home loader builds direct `https://eapi.pcloud.com/getpubthumb?code=${code}&size=${size}` URLs per item — `640x640` → `MemoryItem.thumbUrl`, `1025x1025` → `MemoryItem.lightboxUrl`. The `getpubthumb` endpoint serves bytes statelessly (no signed URL, no IP binding), so the browser can render `<img src>` directly. Per-file public-link `code` reaches the browser via the URL — explicitly relaxed from earlier versions; see "Never do" below.
- **Route video bytes through the `/api/video/<uuid>` proxy (v10).** Videos can't use the v9 direct-CDN trick because `getpublinkdownload` URLs are IP-bound — the URL the SSR mints is rejected when the browser fetches it from a different IP. Instead `MemoryItem.mediaUrl` is `/api/video/<uuid>` and the auth-gated route handler resolves the pCloud CDN URL server-side and pipes bytes back, forwarding the browser's `Range` header so HTML5 `<video>` seeks work. Image originals (download button) use a one-off `getMediaDownloadUrl({ uuid })` server-fn → CDN URL → client-side `fetch` → `Blob` → `<a download>` (image CDN URLs from `getpublinkdownload` work in the browser when fetched right after resolution; videos can't rely on that timing because they need a stable `<video src>`). The video proxy adds `?download=1` to force a full-file response with `Content-Disposition: attachment`. The wider v4 `/api/memory/<uuid>` byte-streaming proxy stays demolished — only video bytes go through a function.
- **The cron is the only writer for `media/<uuid>` and `fileid-index/<fileid>`.** Loader and route handlers are read-only against those stores.
- **The admin route at `/admin/collection` is the sole writer of `collection/v1` (v13).** Admin edits land instantly on `/` — no waiting for the next cron run. **The cron reads `collection/v1` (v14)** to spare curated uuids from sweep when those files live outside the memories folder (lazy-minted at admin save time). The single-writer invariant holds: only the admin route writes; the cron is a read-only consumer. **The home loader reads `collection/v1` as the sole source of uuids (v15)** — there is no folder-snapshot fallback. `undefined` is a boot state (admin hasn't curated yet) and the loader logs a warning + renders empty; `{ uuids: [] }` is a deliberate empty curation and renders empty silently.
- **Public-link lifecycle is owned by the cron.** When the cron sees a fileid disappear from `listfolder`, it calls `deletepublink(linkid)` and clears `media/<uuid>` + `fileid-index/<fileid>`. No abandoned public links accumulate in pCloud's "Public Links" panel.
- **The home page HTML is `Cache-Control: private` (or `no-store`).** Per-user content; never publicly cached. Verify with `curl -I` on the deploy preview after any change to the home loader.
- When using `gh` CLI, make sure that the active user is the one who owns the repo.
- After running `pnpm build` for checking the build, delete the `dist` folder plus Netlify cache.
- **Never log any geo-derived data (v6).** No coordinates, no Geoapify response bodies, no resolved `place` strings, no HTTP `status.message`. The cron logs counts only (`img=A/B/C (gps/no-gps/err)`, `geocoded=N`, `failures: { auth, suspended, ratelimit, server, network, parse }`). Tests assert this on every success and failure path of `geoapify.server.ts` + the cron's geocode pass.

### Ask first

- **Adding any new top-level dependency** — including the **MP4/MOV metadata parser library** needed for v2 (e.g. `mp4box`, hand-rolled `mvhd` atom reader, etc.). List candidates and tradeoffs; wait for approval. v4 adds `@netlify/functions` for the scheduled handler — pre-acked in plan-mode review.
- **Switching or adding a reverse-geocoding provider (v6).** v6 ships with Geoapify (raw `fetch`, no SDK). Any swap or addition needs the same kind of plan-mode review: cost, rate limits, response shape, failure modes, env var name.
- Changes to `oxlint.config.ts` / `oxfmt.config.ts` / `tsconfig.json` / `vite.config.ts`.
- Changes to `.github/workflows/ci.yml` or `netlify.toml` (the latter is added under "ask first" in v4 because the scheduled-function block lives there — pre-acked for the v4 cron).
- Introducing a new top-level route or restructuring `src/lib/`.

### Never do

- Disable per-route SSR as a shortcut for auth issues (use `beforeLoad` instead).
- Import `*.server.ts` modules (Blobs, identity, anything reading `process.env`) from client-rendered code.
- Edit `src/routeTree.gen.ts` — it is auto-generated.
- Bypass `simple-git-hooks` with `--no-verify`.
- Swap the stack: no React Native, no Next.js, no replacing Chakra UI v3, no replacing Vitest. Stack is locked.
- Build a tagging / upload / metadata-mutation UI — out of scope for v1 and v2.
- Re-introduce the random fallback — explicitly retired in v2.
- **Sign an IP-bound pCloud URL on the server and pass it to the browser.** `getfilelink` / `getthumblink` / `getvideolink` URLs are bound to the calling function's IP — the browser's IP won't match, the request gets rejected with "another IP address". v4 sidesteps this by using public-link URLs, which are not IP-bound. The IP-bound endpoints are only allowed when the URL is consumed in the same handler (e.g. EXIF range fetch from the cron).
- **Sign pCloud URLs from the browser.** pCloud rejects `getfilelink` / `getthumblink` calls from browser origins with code 7010 "Invalid link referer", regardless of the page's HTTPS scheme. The pCloud token must stay server-only.
- **Embed the pCloud token or public-link `linkid` in HTML / JSON / loader cache.** The token and `linkid` are server-only. v9 relaxes this for `uuid` and the per-file public-link `code` (embedded in image thumb URLs as `?code=…`). The trade-off on `code` exposure: anyone who can read the page HTML can fetch the underlying image from pCloud directly. Acceptable for this single-user app; documented in §15. **Resolved `getpublinkdownload` CDN URLs do not reach the browser** — v10 found they're IP-bound, so videos go through `/api/video/<uuid>` and image-original downloads resolve a fresh URL via a server-fn at click time (consumed immediately by the same browser context).
- **Public-cache the home page HTML.** Per-user content. `Cache-Control` must be `private` / `no-store` / absent — never `public, s-maxage=...`.
- **Call any pCloud `collection_*` endpoint (v13).** `collection_details` / `collection_linkfiles` / `collection_unlinkfiles` were the v11/v12 plumbing for storing the curated set inside a pCloud collection. v13 moves that set to the `collection-cache` Netlify Blob, mutated only by `/admin/collection`. No part of the app — cron, loader, admin, route handlers — should touch `collection_*` again.
- Push directly to `main` — open a PR from the version branch instead.

## 8. Open Questions (resolve before implementation)

1. **MP4/MOV metadata parser library** — resolved in v2 (hand-rolled mvhd reader, no dep).
2. **Range-fetch strategy for video EXIF** — resolved in v2 (two-step start/tail fetch).
3. **Metadata store** — Netlify Blobs is shipped for the v4 cache: `media/<uuid>` (`{ fileid, hash, code, linkid, kind, contenttype, name, captureDate }`), `fileid-index/<fileid>` (`{ uuid }`), and `folder/v1` (`{ refreshedAt, uuids }`). `consistency: 'eventual'`, with a no-op fallback when the Blobs runtime isn't reachable (plain `pnpm dev`). Tagging/upload metadata stores remain future work. v3's per-fileid `capture-cache` is folded into `media/<uuid>` and removed.
4. **Media URL signing (v4 → v9)** — v4 shipped a server-side proxy at `/api/memory/<uuid>?variant=...` that byte-streamed pCloud public-link responses. **Superseded by v9**: the loader builds `https://eapi.pcloud.com/getpubthumb?code=${code}&size=…` synchronously for thumbs (stateless direct-bytes endpoint, no per-request signing) and calls `getpublinkdownload({ code })` server-side for video stream + downloads. The browser renders direct `*.pcloud.com` URLs; the proxy is deleted. Trade-off: per-file public-link `code` reaches the browser via the thumb URL `?code=…`. Trade-off documented in §7 ("Never do") and §15 (Boundary). `getpubthumblink`'s JSON variant was tried first but its CDN URLs are signed against the calling IP and break in the browser, which is why thumbs use the URL build instead.
5. **Cron schedule (v4)** — daily at 04:00 UTC (`0 4 * * *`). **Cron is the only writer.** No on-demand fallback; missing snapshot ⇒ home renders empty + warn. Manual first-run trigger required pre-prod.
6. **Cache invalidation (v4)** — pCloud's content-derived `hash` invalidates per-uuid entries on content change (rename ≠ content change; same fileid + same hash = noop). When a fileid disappears from `listfolder`, the cron deletes the public link via `deletepublink(linkid)` and clears both `media/<uuid>` and `fileid-index/<fileid>`.
7. **Scalability budget (v4 → v9)** — design for ~1000 files in the folder, ~30 matched-day items per visit. Hot path on the server **(v9)**: 1 `folder/v1` snapshot read + N `media/<uuid>` reads + **V parallel pCloud calls** (V = videos in today's set × `getpublinkdownload`). Thumb URLs are built synchronously from the cached `code` — zero API calls for image items. Per-video resolution runs via `Promise.all` with try/catch in the per-item path; a `getpublinkdownload` failure drops only that video with a `console.warn`. **Zero pCloud API calls on the route-hit path** since browser fetches CDN URLs directly; Netlify bandwidth drops to near zero on the media path (only the loader response + the lazy download server-fn).
8. **Reverse-geocoding provider (v6)** — resolved: **Geoapify** (`https://api.geoapify.com/v1/geocode/reverse`). Free tier 3,000 req/day, 5 req/sec; cron throttles to 1 req/sec via software sleep + a per-run cap (default 200, env-overridable via `RECUERDEA_GEOCODE_MAX_PER_RUN`). API key in `GEOAPIFY_API_KEY` (server-only). Spanish output via `lang=es`. History: started with OpenCage in Slices 4–7, swapped to Geoapify mid-build for project-account reasons.

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

Cumulative on top of §2. v4 fixes prod 410s and the v3-era IP-mismatch by routing all media delivery through an auth-gated route that byte-streams pCloud public-link responses.

**Correctness**

- No production 410s / "another IP address" errors / 7010 "Invalid link referer" errors on `<img>` / `<video>` / poster requests, including: (a) lazy-scrolled items rendered minutes after page load, (b) re-renders driven by TanStack Router's loader cache, (c) browser back/forward into a previously-rendered home page.
- Achieved by serving every media reference through `/api/memory/<uuid>?variant=...`, which fetches a pCloud **public-link** URL server-side and pipes the bytes back to the browser. Public links are not IP-bound and not Referer-gated, so the function-side fetch always succeeds; the public-link URL itself never leaves the function.

**Cache shape**

- Per-uuid Blobs entry stores `CachedMedia = { fileid: number, hash: string, code: string, linkid: number, kind: 'image' | 'video', contenttype: string, name: string, captureDate: string | null }`, keyed `media/${uuid}`. Replaces v3's per-fileid `capture-cache` entirely.
- Sidecar Blobs entry keyed `fileid-index/${fileid}` stores `{ uuid: string }` so the cron can reuse uuids across runs (rename ≠ new uuid).
- A single folder-snapshot Blobs entry keyed `folder/v1` stores `{ refreshedAt: string, uuids: readonly string[] }`.
- Hash mismatch overwrites the per-uuid value but keeps the same uuid (rendered HTML keeps working).

**Cron**

- A Netlify Scheduled Function (`netlify/functions/refresh-memories.ts`) runs at least daily and: (1) calls `listfolder` once; (2) for each file: looks up `fileid-index/<fileid>`, mints a uuid if needed, calls `getfilepublink({ fileid })` if no `code` is cached, runs `safeExtractCaptureDate`, writes `media/<uuid>` + `fileid-index/<fileid>`; (3) sweeps stale uuids — for any uuid in the cache but not in the current `listfolder` result, calls `deletepublink(linkid)` and clears both entries; (4) writes a fresh `folder/v1` snapshot.
- The cron is idempotent and safe to run concurrently with user requests.
- If the cron has not run yet (cold deploy / Blobs panel cleared), the home route renders the empty state and logs a warn. **Cron is the sole writer.** Pre-prod, it must be triggered manually so the snapshot exists when users hit the page.

**Hot path**

- A user visit to `/` performs: 1× snapshot read, N× per-uuid reads (where N = files in folder), filter to today's day, sort, render. **Zero pCloud API calls on the loader path** when the cache is warm.
- The `/api/memory/<uuid>` route handler is auth-gated and byte-streams the upstream response. For image/poster: 1× cache read, then `fetch('https://eapi.pcloud.com/getpubthumb?code=…&size=2048x1024')` and pipe the body — zero pCloud API calls. For stream: 1× cache read + 1× `getpublinkdownload` call to derive the CDN URL, then `fetch` with the browser's `Range` header forwarded and pipe the response (preserving `206` + `content-range` for video seek). Every Range request goes through the function, so Netlify bandwidth is the constraint to monitor.

**Layout / UX**

- Unchanged from v2 (vertical feed, image vs. video distinguished by player UI, oldest year first, admin date override).

**Workflow**

- v4 work happens on a `v4` branch with a PR into `main`; Netlify produces a deploy preview per PR. The fix is verified on the preview after manually triggering the cron once.

## 12. v3 → v4 changes summary

For readers diffing this spec against v3:

- §1 / §2: same product. §2 gains a bullet: media is delivered via `/api/memory/<uuid>?variant=...`, an auth-gated route that byte-streams the pCloud public-link response.
- §4 Project Structure: adds `src/routes/api/memory/$uuid.ts`, `src/lib/media-cache(.server).ts` (replaces v3's `capture-cache`), `src/lib/fileid-index(.server).ts`, `src/lib/folder-cache(.server).ts`, `netlify/functions/refresh-memories.ts`, `src/lib/date.ts` (display/ISO helpers), and a `src/components/` split for reusable sub-components (`MemoryView`, `AdminDateOverride`). `Home` stays inside `src/routes/index.tsx` alongside the loader.
- §5 Code Style: unchanged from v3.
- §7 Boundaries: "always do" now requires routing media through `/api/memory/<uuid>` with auth gate, the cron as sole writer, public-link lifecycle ownership, and `Cache-Control: private` on the home page HTML. "Ask first" adds `@netlify/functions` (pre-acked) and the `netlify.toml` schedule block (pre-acked). "Never do" adds: don't sign IP-bound URLs server-side and pass to the browser; don't sign anything from the browser (pCloud blocks browser-origin calls); don't embed `fileid` / `code` / `linkid` / token in HTML.
- §8 Open Questions: replaces v2/v3 entries with v4-relevant ones. Cache shape moves from v3's `capture-cache/v1/${fileid}` (capture date only) to `media/${uuid}` (full `CachedMedia` including `code` + `linkid`) + `fileid-index/${fileid}` sidecar + `folder/v1` snapshot. The cron deletes stale per-uuid entries AND their associated pCloud public links.
- §11 (new): v4 acceptance criteria — UUID-indirected media URLs, server-side byte-stream of public-link responses, cron-warmed cache, public-link lifecycle managed by the cron.

**Earlier v4 attempts (history):** v4's first design ran a byte-stream proxy at `/api/media/:fileid` keyed by `fileid` and resolved fresh signed URLs per request (worked, but the URLs and `fileid`s appeared in the browser). The second attempt moved URL signing to the browser to avoid the proxy entirely; it failed because pCloud's API gates `getfilelink` / `getthumblink` against browser origins (error 7010 "Invalid link referer"). A third iteration tried 302-redirecting from `/api/memory/<uuid>` to a public-link URL — simpler than the proxy, but it leaked the public-link `code` to the Network tab, and public links aren't IP-bound so anyone with the URL could fetch the bytes without going through the auth gate. The current design keeps the UUID indirection and cron-warmed cache from that iteration but byte-streams the bytes through the function so the public-link URL never reaches the browser.

## 13. v6 Acceptance Criteria

Cumulative on top of §11. v6 adds **place captions** to the polaroid feed: every memory tile shows the city / region where the photo or video was taken instead of the file's basename.

**Correctness**

- For every media file the cron processes, the location pipeline runs in two stages, both server-only:
  1. Extract raw GPS coordinates from the file's bytes. Images: `exifr` with `pick: ['GPSLatitude', 'GPSLatitudeRef', 'GPSLongitude', 'GPSLongitudeRef', ...]` (raw GPS tags — not the virtual `latitude`/`longitude` fields, which silently leave the GPS block disabled). Videos: hand-rolled `moov` walker descends into `udta` and reads the `©xyz` (`0xa9 'x' 'y' 'z'`) atom's ISO 6709 string. Both extractors return `location: { lat, lng } | null` and never throw.
  2. If `location` is non-null and `place` is null, reverse-geocode via Geoapify (`https://api.geoapify.com/v1/geocode/reverse?lat=…&lon=…&lang=es&apiKey=…`). Place picker prefers `properties.city ?? properties.state`, appends `, country` (deduped), falls back to `properties.formatted ?? null`.
- The home page replaces the filename caption with `item.place`. When `place` is null, the caption is hidden entirely (no fallback to filename, no "Sin ubicación" placeholder).
- The lightbox header appends `· {item.place}` after the years-ago line when non-null.
- `<img alt={item.name}>` stays for a11y; only the visible caption strip and lightbox header surface `place`.

**Cache shape**

- `CachedMedia` gains `location: { lat: number; lng: number } | null` and `place: string | null`. The pCloud `hash` still keys invalidation; on a hash mismatch we re-extract `location` and reset `place` to null so the geocoder runs again on the next pass.
- `MemoryItem` gains `place: string | null` (passed through from `CachedMedia`); other fields unchanged. The browser only ever sees `place` and `uuid` — never raw coordinates.

**EXIF reach (v6 update)**

- Image EXIF range fetch is `bytes=0-1048575` (1MB) instead of v2's 64KB. iPhone HEIC routes EXIF through the `meta` box's `iloc` and the actual bytes can sit deep in `mdat`; 1MB covers the vast majority of real iPhone HEIC files at modest bandwidth cost. JPEGs are unaffected (EXIF is in APP1 near the start).

**Geocode pass (cron-only)**

- Sequential. ≥1100ms between consecutive Geoapify calls (well under Geoapify's 5 req/s ceiling and the 1 req/s budget we set in software). Per-run cap: 200 (env-overridable via `RECUERDEA_GEOCODE_MAX_PER_RUN`); items beyond the cap stay `place: null` and are picked up on the next cron run.
- Stop the pass for the rest of this run on `auth | suspended | ratelimit` reasons (auth/suspended also warn once; warn line contains the reason only — no key, coords, or response body). `server | network | parse` failures are counted and the pass continues.
- Loader and `/api/memory/<uuid>` route never call Geoapify. Hot path stays at zero pCloud + zero Geoapify calls when the cache is warm.

**Logging hygiene**

- Zero `console.*` with coordinates, `place`, Geoapify URL, response body, or `status.message`. Cron summary log emits counts only: `scanned=X alive=Y removed=Z img=A/B/C (gps/no-gps/err) vid=D/E/F (gps/no-gps/err) geocoded=G capped=H stopped=…`. A second line summarises geocode-failure reasons when any are non-zero. Tests assert no console method receives sensitive values on every success/failure path.

**Workflow**

- v6 work happens on the `v6-location` branch with a PR into `main`. Pre-merge checklist: provision `GEOAPIFY_API_KEY` in Netlify deploy-preview env scope, **clear Blobs** (`media/*`, `fileid-index/*`, `folder/v1`) on the preview context, trigger the cron once via the dashboard, smoke `/`. Production cutover after merge: same env-var + Blobs-clear + cron-trigger sequence in the production scope.

## 14. v5 → v6 changes summary

For readers diffing this spec against v5:

- §1 Objective and §2 Acceptance Criteria: unchanged. v6 is purely additive on the cache + UI. Same memories, same sort, same layout — captions now read "Madrid, España" instead of "IMG_4567".
- §4 Project Structure: `media-meta/` adds `geoapify.server.ts`. `exif.ts` and `video-meta.ts` extended to return `location`. `media-cache.ts` `CachedMedia` gains `location` + `place`.
- §7 Boundaries: "always do" adds the no-geo-logging rule; "ask first" adds the geocoder-provider gate.
- §8 Open Questions: §8.8 (new) records Geoapify as the resolved geocoding provider with rate-limit + env-var details, including the OpenCage→Geoapify swap that happened mid-build.
- §13 (new): v6 acceptance criteria — two-stage extraction, Geoapify with cap + spacing + tagged failures, EXIF range bumped to 1MB for HEIC, place-or-nothing caption rule, no geo data in any log.

**v6 build history (chronological):** Slices 1–2 added GPS extraction to the EXIF and MP4 pipelines. Slice 3 extended `CachedMedia` with `location` + `place`. Slices 4–5 wired up the OpenCage client + sequential cron geocode pass. Slices 6–7 plumbed `place` through `MemoryItem` to the polaroid + lightbox UI. Slice 8 swapped the geocoder from OpenCage to Geoapify under the same `reverseGeocode` interface (the user pivoted providers mid-build for project-account reasons; `quota` reason was dropped from the failure union since Geoapify uses 429 for both rate limit and daily quota).

**Post-merge fix (commit `<TBD>`):** the first deploy-preview cron run produced `location: null` on every cached entry. Two distinct bugs surfaced: (a) `exifr.parse(buffer, ['latitude', 'longitude', ...])` doesn't enable the GPS block — the virtual `latitude`/`longitude` outputs aren't in exifr's raw-tag dictionary, so the GPS block stays disabled. Switched to picking the raw `GPSLatitude` / `GPSLatitudeRef` / `GPSLongitude` / `GPSLongitudeRef` tags. (b) iPhone HEIC EXIF often sits past the first 64KB; bumped the range fetch to 1MB. Also added per-extractor outcome counters to `RefreshResult` so the cron summary log surfaces extraction success/failure rates without leaking content.

## 15. v9 Acceptance Criteria

Cumulative on top of §11 (v4) and §13 (v6). v9 demolishes the `/api/memory/<uuid>` byte-streaming proxy: the home loader resolves CDN URLs server-side and the browser fetches `*.pcloud.com` directly. Cache shape and cron are unchanged.

**Loader shape**

- `MemoryItem` carries `thumbUrl: string` (640×640) + `lightboxUrl: string` (1025×1025) for every item; videos additionally carry `mediaUrl: string` (resolved `getpublinkdownload`).
- Thumb URLs are built synchronously from `https://eapi.pcloud.com/getpubthumb?code=${code}&size=…`. The `getpubthumblink` JSON endpoint was tried first but its returned CDN URLs are signed against the calling IP and break when the browser fetches from a different IP. Direct-bytes `getpubthumb` works because pCloud serves the image statelessly (no per-request signing).
- `fetchTodayMemories(today, client)` takes a `Client` argument; the `pcloud.ts` server-fn wrapper reads `PCLOUD_TOKEN` and instantiates the client. Missing token → server-fn returns `[]` + warn (parity with the existing missing-snapshot path).
- Per-video `mediaUrl` resolution runs in parallel via `Promise.all`; a `getpublinkdownload` failure drops only that video with a `console.warn` (no fileid / no code in the log line). Image items can't fail at the URL stage — `buildThumbUrl` is pure.

**Frontend**

- `Polaroid` renders `<img src={item.thumbUrl}>`.
- `Lightbox` image slide renders `<img src={item.lightboxUrl}>`. Video slide renders `<video src={item.mediaUrl} poster={item.thumbUrl}>`.
- Download button calls `getMediaDownloadUrl({ uuid })` server-fn → `{ url, name, contenttype }` → client-side `fetch` → `Blob` → `URL.createObjectURL` → `<a download={name}>` click → revoke. Chakra `Spinner` + disabled while pending; icon turns red on error.

**Demolition**

- `src/routes/api/memory/$uuid.ts`, `src/lib/memories/memory-route.server.ts`, `memory-route.server.test.ts` deleted. `routeTree.gen.ts` regenerated.
- Zero `/api/memory/<uuid>` requests anywhere in the running app.

**Boundary**

- pCloud token still server-only.
- Public-link `linkid` stays in `CachedMedia` (server-only); does **not** reach the browser.
- Per-file public-link `code` reaches the browser via thumb URLs (`?code=${code}`). Trade-off: anyone with the page HTML can fetch the file from pCloud. Acceptable for this single-user app; SPEC §7 "Never do" updated accordingly.
- The CDN URLs returned by `getpublinkdownload` (`https://${hosts[0]}${path}`) carry their own time-limited tokens and reach the browser via `mediaUrl` (videos) and the `getMediaDownloadUrl` server-fn (downloads).

## 16. v8 → v9 changes summary

For readers diffing this spec against v8:

- §1 Objective and §2 Acceptance Criteria: unchanged.
- §4 Project Structure: adds `src/lib/memories/pcloud-urls.server.ts` (URL resolvers), `src/lib/memories/get-download-url.server.ts` + `get-download-url.ts` (lazy download URL server-fn), `src/lib/memories/download.ts` (client-side blob helper). Deletes `src/routes/api/memory/$uuid.ts` and `src/lib/memories/memory-route.server.ts`. `MemoryItem` gains `thumbUrl` + `lightboxUrl` + (videos) `mediaUrl`.
- §7 Boundaries: "Always do" replaces the proxy-route bullet with the v9 server-side resolution rule. "Never do" relaxes the no-embed rule to allow `uuid` + the resolved CDN URLs (but not `code` / `linkid` / token).
- §8 Open Questions: §8.4 (media URL signing) closed with the v9 design. §8.7 (scalability budget) updated for the new loader cost (2N+V parallel calls).
- §13 (v6) and earlier sections: unchanged.

## 17. v10 Acceptance Criteria

Cumulative on top of §15 (v9). v10 is a small batch of corrections discovered after v9 shipped — narrow, unrelated to the v9 architecture but each visible enough to merit recording.

**Capture date source**

- Capture date now comes from pCloud's `file.created` field returned by `listfolder`. The cron passes it through to `CachedMedia.captureDate` as an ISO string. EXIF / mvhd capture-date extraction is retired — `extractImageMeta` and `extractVideoMeta` now return only `width`, `height`, and `location` (used for thumbnails and reverse-geocoding).
- Why: `file.created` is the pCloud upload-derived date that matches what users actually see in the pCloud UI. EXIF / mvhd dates were technically correct but routinely wrong (clip re-exports, scanned photos, devices with bad clocks). Skipping the per-file range fetch for capture-date extraction also cuts cron time and pCloud API load.
- Items with no parseable `file.created` are skipped by the loader (parity with the v2 rule for missing capture date).

**Sort order**

- Newest year first (`b.year - a.year`), tiebreak by `fileid` ascending. v1/v2 sorted oldest-year-first; commit `1cc010d` flipped it pre-v10 and v10 locks the rule into the SPEC. §2 Acceptance Criteria updated accordingly.

**Video delivery**

- `MemoryItem.mediaUrl` is `/api/video/<uuid>` (an auth-gated proxy route), not a direct pCloud CDN URL. `getpublinkdownload` URLs proved to be IP-bound — the browser receives "another IP address" when it tries to fetch the SSR-minted URL. The proxy resolves the URL server-side per request and pipes the response body back, forwarding the browser's `Range` header so HTML5 `<video>` seek/scrub still works.
- Video downloads use the same proxy with `?download=1`, which forces a `200` response with `Content-Disposition: attachment` and `cache-control: no-store`. Image-original downloads keep the v9 path (server-fn → CDN URL → client-side blob), which works because `getpublinkdownload` URLs for images are consumed immediately after resolution.
- `src/lib/memories/video-stream.server.ts` is the pure handler; `src/routes/api/video/$uuid.ts` is the thin route shell that wires deps. v9's `pcloud-urls.server.ts` comment block predicted this fallback ("If it fails the same way, the fallback is to restore the proxy for these two paths only…") — v10 is that fallback materialising.

**Polaroid thumbnails**

- Thumbnails (image and video poster) are square-cropped via `objectFit: 'cover'` + a fixed-aspect frame so the masonry layout stays even regardless of source aspect ratio.

**Account UI**

- The `Topbar` user pill is replaced by a Chakra `Drawer.Root` (`AccountDrawer`) showing the authenticated user's name + email and a "Cerrar sesión" button. The drawer is wrapped in `<ClientOnly>` from `@tanstack/react-router` because Netlify Identity state only exists on the client.

**Auth cookie persistence**

- `@netlify/identity` is patched via `pnpm patch` (`patches/@netlify__identity.patch`) to set `Max-Age=2592000` (30 days) on the session cookie. The library otherwise hardcodes session cookies, which dropped the login on every page reload. Re-apply on library upgrade.

**Test infrastructure**

- Vitest splits into two projects: `unit` (Node, runs `*.test.ts(x)`) and `browser` (headless Chromium via `@vitest/browser-playwright`, runs `*.browser.test.tsx`). `pnpm test` runs both; `pnpm test:unit` / `pnpm test:browser` for targeted runs. Reusable component smoke tests under `src/components/*.browser.test.tsx`.

**Hot path / cron**

- Unchanged from v9 (cache shape unchanged; cron is sole writer; `/` HTML stays `Cache-Control: private`). The video proxy adds 1 cache read + 1 `getpublinkdownload` call per video play / scrub Range request.

## 18. v9 → v10 changes summary

For readers diffing this spec against v9:

- §1 Objective: unchanged.
- §2 Acceptance Criteria: capture-date source rewritten (pCloud `file.created`, no more EXIF / mvhd date). Sort order flipped to newest-year-first.
- §3 Commands: adds `dev:netlify`, `preview`, `test:unit`, `test:browser`, `lint:fix`, `format:check`, `invoke:refresh-memories`.
- §4 Project Structure: replaces `routes/api/memory/<uuid>` with `routes/api/video/<uuid>`. Adds `lib/memories/video-stream.server.ts`, `lib/memories/pcloud-urls.server.ts`, `lib/memories/get-download-url(.server).ts`, `lib/memories/download.ts`, `lib/utils/years-ago.ts`, `env.d.ts`, `patches/@netlify__identity.patch`, `scripts/oauth-provision.mjs`. `media-meta/` callouts no longer mention capture-date extraction. `Topbar` description gains the AccountDrawer + ClientOnly. `Polaroid` description gains the squared crop.
- §6 Testing Strategy: documents the two Vitest projects and the `*.browser.test.tsx` naming.
- §7 Boundaries: "Always do" gains a separate bullet for routing video bytes through `/api/video/<uuid>` (next to the v9 image-URL rule). "Never do" tightens the no-embed rule — `getpublinkdownload` CDN URLs do not reach the browser; videos use the proxy and image downloads consume a freshly resolved URL on-demand.
- §17 (new): v10 acceptance criteria — file.created capture date, newest-year-first sort, `/api/video/<uuid>` proxy, square thumbnail crop, account drawer, identity cookie patch, Vitest unit/browser split.
- §15 (v9) and earlier acceptance sections: left as historical record. Where v10 changes the rule, the current truth lives in §7 and §17.

## 19. v11 Acceptance Criteria

Cumulative on top of §17 (v10). v11 introduces curated collections — the home page can opt-in to a pCloud collection as the uuid whitelist for the date filter, leaving everything outside of that collection out of the on-this-day view. A new admin-only route lets the owner curate that collection from the browser.

**Curation model**

- A single pCloud collection is bound via `PCLOUD_COLLECTION_ID` (server-only env var, optional). When unset the home page falls back to the raw folder snapshot (preserves §15 / §17 behavior). When set, every cron run reads the collection's contents via `client.call('collection_details', { collectionid, showfiles: 1 })`, intersects the fileids with the alive uuids the cron just wrote, and persists the result as `collection/v1` in a new Blobs store `collection-cache` (`{ refreshedAt: ISO, uuids: readonly string[] }`).
- `fetchTodayMemories` reads the collection snapshot first. If present (even when empty), those uuids are the candidate set fed through the existing month/day filter. If absent, it falls back to the folder snapshot — same code path as v9/v10.
- An empty collection snapshot means "show nothing", not "fall back". This is intentional: the cron writing an empty `collection/v1` after the curator unlinks everything is a _result_, not a missing-state.

**Admin route**

- `/admin/collection` is a TanStack Start route gated by `beforeLoad` that calls `loadServerUser()` and (a) redirects unauthenticated visitors to `/login`, (b) redirects authenticated non-admins to `/`. Admin status is derived from Netlify Identity's `app_metadata.roles` containing `"admin"`. The same gate is exposed to client code via `useIdentity().isAdmin`, which `Topbar`'s `AccountDrawer` uses to show an "Administración" link.
- The route's loader fetches `getCollectionMedia()` + `getAdminFolderMedia()` in parallel. Top section: the current collection, rendered as a tile grid with a per-tile "Quitar" button. Bottom section: an "Añadir más" toggle that opens a multi-select grid of every cached folder item; tiles already in the collection are rendered as `disabled` and excluded from selection. "Guardar (N)" submits the selection via `linkFilesToCollection` and `router.invalidate()`s both grids.
- When `PCLOUD_COLLECTION_ID` is unset, `getCollectionMedia` returns `{ status: 'unconfigured' }` (a tagged result, not a thrown error). The route renders an alert telling the curator to set the env var; the folder grid section is hidden because there's nowhere to add items to.
- A persistent info banner under the heading says "Los cambios aparecerán en la página principal tras la próxima sincronización (04:00 UTC)." Without this, the asymmetry between a successful save and the home page's still-stale state would be confusing.

**Write boundaries**

- The cron remains the **only writer** for `media/<uuid>`, `fileid-index/<fileid>`, `folder/v1`, and **the new `collection/v1`**. Admin mutations call pCloud directly (`collection_linkfiles` / `collection_unlinkfiles`); the cache catches up on the next 04:00 UTC run. This keeps the v4 single-writer invariant intact and avoids a separate write path that could race the cron.
- The admin route is the **only place in the app** where `fileid` reaches the browser. SPEC §7's "fileid stays server-side" boundary still applies to the public app; admin mutations need the fileid round-trip and the bounded blast-radius (admin-only route, server-validated role) is acceptable.

**Cron extension**

- `refreshMemories(...)` accepts an optional 7th argument `collectionOpts?: { cache: CollectionCache; collectionid: number }`. When omitted (env var unset), the cron is unchanged. When provided, after writing the folder snapshot the cron calls `collection_details`, maps each fileid → uuid via the fileid-index, drops uuids not in the alive set, and persists the result. The return type gains `collectionStats: { linked, alive } | null` so the cron log can surface `collection: linked=N alive=N missing=N` without leaking ids.

**New surface**

- `src/lib/cache/collection-cache.{ts,server.ts}` — mirror of `folder-cache.{ts,server.ts}`, store name `collection-cache`, key `collection/v1`.
- `src/lib/admin/collection.{ts,server.ts}` — `fetchCollectionMedia`, `linkFilesToCollectionRaw`, `unlinkFilesFromCollectionRaw`, `assertCollectionId()`, plus their `createServerFn` wrappers (auth + admin gated).
- `src/lib/admin/folder-media.{ts,server.ts}` — read-only listing of every cached folder item for the admin grid (no date filter; reuses `folder/v1` + `media/<uuid>`).
- `src/routes/admin/collection.tsx` — route component + gate.
- `src/components/{AdminCollectionGrid,CollectionItemsGrid}.tsx` — the two tile-grid variants (multi-select + remove).

## 20. v10 → v11 changes summary

For readers diffing this spec against v10:

- §1 Objective: still single-user; the curation step is now an authoring affordance for the same owner.
- §2 Acceptance Criteria: unchanged. The home page still surfaces "on this day". v11 just narrows the candidate set when `PCLOUD_COLLECTION_ID` is configured.
- §4 Project Structure: adds `routes/admin/collection.tsx`; `lib/cache/collection-cache.{ts,server.ts}`; `lib/admin/{collection,folder-media}.{ts,server.ts}`; `components/{AdminCollectionGrid,CollectionItemsGrid}.tsx`.
- §7 Boundaries: "Always do" gains the collection-cache to the cron's writer set. "Never do" gains an admin-only carve-out for fileid (still server-side for the public app). "Ask first" unchanged.
- §17 (v10): unchanged.
- §19 (new): v11 acceptance criteria — curation model, admin route, write boundaries, cron extension, new surface.

## 21. v12 Acceptance Criteria

Cumulative on top of §19 (v11). v12 reworks `/admin/collection`'s data path so the curator can pick any image/video under a supervised source folder — no longer constrained to whatever the memories cron happened to snapshot — and isolates admin pCloud writes behind a dedicated auth token. The home page (v11) is unchanged.

**Split auth model**

- A new server-only env var `PCLOUD_ADMIN_AUTH` carries a pCloud-native auth token (mint via `getauth=1` against `userinfo`; **not** an OAuth token). Every `collection_*` call — from both the admin route AND the cron's collection-snapshot pass — is made through a client constructed with `createClient({ token, type: 'pcloud' })`. The existing OAuth `PCLOUD_TOKEN` is no longer accepted for collection writes; pCloud rejects OAuth on those endpoints with `result: 1000 "Log in required"`.
- The cron skips the collection-snapshot pass entirely (logging `collection snapshot skipped: PCLOUD_ADMIN_AUTH unset`) when `PCLOUD_ADMIN_AUTH` is missing, even if `PCLOUD_COLLECTION_ID` is set. The folder snapshot + memories cache still refresh — only the collection narrowing falls back.

**Live admin view (decoupled from memories cache)**

- `/admin/collection`'s top section reads the live pCloud collection by calling `collection_details({ collectionid, showfiles: 1 })` + a batched `getthumbslinks` request. No dependency on `folder/v1` or `media/<uuid>` — a freshly-linked file appears in the admin grid immediately, without waiting for 04:00 UTC. **`fileid` is the wire id** for link/unlink; uuids no longer cross this surface.
- Empty-collection shape: pCloud returns `collection.contents` (the file array) and `collection.items` (a numeric count, not an array). When the collection is empty, `contents` is omitted and `items: 0`. Both `fetchCollectionMedia` and the cron's `refreshCollectionSnapshot` read `contents` (with a defensive fallback if `items` is ever an array). Regression test required.
- Each `AdminFileItem = { fileid, name, kind: 'image' | 'video' | 'other', thumbUrl: string | null }` — `thumbUrl` is null when pCloud doesn't return a thumb for that fileid. The grid renders a "sin miniatura" fallback tile.

**Source folder navigator**

- `PCLOUD_SOURCE_FOLDER_ID` (server-only env var) bounds the "Añadir más" picker. The route accepts a `?folderid=N` search param and the loader passes it through to `fetchAdminSourceFolder(client, { folderid })`. Default (no search param) lists the source root.
- `fetchAdminSourceFolder` calls `listfolder({ folderid, noshares: 1 })`, splits contents into subfolders + `image/*` | `video/*` files, batches `getthumbslinks` for the files, and walks parents to build breadcrumbs. The walk stops at the source root, the pCloud root (folderid 0), or depth 10 — whichever comes first. If the source root isn't found in the ancestor chain, throws `FolderNotPermittedError`, which the server-fn maps to a tagged `{ status: 'folder-not-permitted' }` result so the route can render a banner instead of 500-ing.
- The navigator UI: breadcrumb row → subfolder grid → file grid (square tiles, video badge, check overlay when picked) → sticky footer with `Guardar (N)` / `Cancelar` (hidden when N=0). Already-collected fileids are marked `aria-disabled` in the file grid; multi-select state lives in the component, persists across navigation, and is cleared on Save or Cancel.

**Updated surface**

- `src/lib/admin/collection.{ts,server.ts}` — `fetchCollectionMedia(client)` (no caches), `linkFilesToCollectionRaw(client, fileids: readonly number[])`, `unlinkFilesFromCollectionRaw(client, fileids)`. Server-fn wrappers accept `{ fileids: readonly number[] }`.
- `src/lib/admin/source-folder.{ts,server.ts}` (new) — `fetchAdminSourceFolder`, `assertSourceFolderId()`, `SourceFolderIdMissingError`, `FolderNotPermittedError`, and the `AdminFolderListing` type.
- `src/components/AdminFolderNavigator.tsx` (new) — replaces `AdminCollectionGrid.tsx` (deleted along with `lib/admin/folder-media.*`).
- `src/components/CollectionItemsGrid.tsx` — now `AdminFileItem`-shaped (fileid keys, name caption, thumbUrl-null fallback).

## 22. v11 → v12 changes summary

For readers diffing this spec against v11:

- §4 Project Structure: `lib/admin/folder-media.{ts,server.ts}` removed; `lib/admin/source-folder.{ts,server.ts}` added. `components/AdminCollectionGrid.tsx` removed; `components/AdminFolderNavigator.tsx` added.
- §7 Boundaries: "Always do" gains the split-auth rule — `collection_*` always through the `PCLOUD_ADMIN_AUTH` (pCloud-native) client, never OAuth. "Never do" gains: never call `collection_*` with the OAuth `PCLOUD_TOKEN`.
- §19 (v11): the admin grids documented there are superseded by §21 — `AdminCollectionGrid` is gone, "Añadir más" is now a navigable folder tree, and `fileid` (not `uuid`) is the wire id.
- §21 (new): v12 acceptance criteria — split auth, live admin view, source-folder navigator, updated surface.

## 23. v13 Acceptance Criteria

Cumulative on top of §21 (v12). v13 demolishes the pCloud-collection layer entirely. The curated set now lives in the Netlify Blob the cron used to sync into; the admin route mutates it directly. Reads are faster (pure blob, no pCloud calls), edits are instant on `/` (no 04:00 UTC wait), and the v12 `PCLOUD_ADMIN_AUTH` + `PCLOUD_COLLECTION_ID` + `PCLOUD_SOURCE_FOLDER_ID` env vars are gone. Loader (`fetchTodayMemories`) is unchanged.

**Storage model**

- `collection-cache` Netlify Blob, key `collection/v1`, shape `{ refreshedAt: ISO, uuids: readonly string[] }`. Same shape as v11; the writer is different. `refreshedAt` records the last admin edit.
- Semantics (v15): `collection/v1` is the **sole** source of uuids for `fetchTodayMemories`. `undefined` blob → loader logs a warning and renders empty (boot state, before any admin curation); `{ uuids: [] }` → renders empty silently (deliberate empty curation). The v13 fallback to `folder/v1` is gone — the cron no longer writes `folder/v1`, and the `folder-cache` module is removed.
- **Single writer:** `/admin/collection`. The cron does **not** touch `collection-cache` (no read, no write). Restores the §7 single-writer invariant, just with admin in the writer slot instead of the cron.

**No pCloud collection layer**

- Zero calls to `collection_details`, `collection_linkfiles`, or `collection_unlinkfiles` anywhere in the app.
- `PCLOUD_COLLECTION_ID` env var: removed.
- `PCLOUD_ADMIN_AUTH` env var: removed (its only purpose was authorising `collection_*` — OAuth `PCLOUD_TOKEN` covers every other endpoint).
- `PCLOUD_SOURCE_FOLDER_ID` env var: removed (the v12 source-folder navigator is gone).

**Admin route (`/admin/collection`)**

- Loader fan-outs to `getCollectionMedia()` + `getAdminFolderMedia()` in parallel. Both are pure blob reads — no pCloud roundtrip from this route.
- Top section: `CollectionItemsGrid` over the curated set; each tile carries a per-uuid "Quitar" button that calls `removeFromCollection({ data: { uuids: [uuid] } })` and `router.invalidate()`.
- Bottom section: `AdminCollectionGrid` — a flat multi-select grid over every file the cron has snapshotted from `PCLOUD_MEMORIES_FOLDER_ID`. Items already in the curated set are `aria-disabled` and excluded. Sticky footer with `Guardar (N)` / `Cancelar` (hidden when N=0) calls `addToCollection({ data: { uuids } })` and `router.invalidate()`.
- **uuid is the wire id throughout the admin surface.** No fileid in the browser. `AdminFileItem = { uuid, name, kind, thumbUrl }`.
- The "Los cambios aparecerán tras la próxima sincronización (04:00 UTC)" banner is **removed** — edits are instant.
- `UnconfiguredBanner`, `SourceFolderMissingBanner`, `FolderNotPermittedBanner` are **removed** (no env var to misconfigure, no folder permission to enforce).

**Picker scope trade-off**

- The picker shows only files the cron has already snapshotted from `PCLOUD_MEMORIES_FOLDER_ID`. New pCloud uploads become curatable on the next 04:00 UTC cron run — matching the cadence on which they would become visible on `/` anyway.
- Stale uuids in the collection blob (e.g. file deleted in pCloud → cron sweeps `media/<uuid>` → uuid still in `collection/v1`) are **not GC'd**. The loader already filters out uuids with no `mediaCache.lookup(uuid)` result, so the only effect is a tiny harmless accumulation.

**Cron**

- `refreshMemories(client, folderId, mediaCache, fileidIndex, geocodeOpts?, collectionReader?)` — the v13 `folderCache` parameter is gone in v15 (cron no longer writes `folder/v1`); the v14 `collectionReader` (read-only view of `collection/v1`) is preserved so sweep still protects curated uuids.
- `RefreshResult.collectionStats` is gone; the corresponding `collection: linked=… alive=… missing=…` log line is gone.
- `netlify/functions/refresh-memories.ts` reads only `PCLOUD_TOKEN` + `PCLOUD_MEMORIES_FOLDER_ID` (+ optional `GEOAPIFY_API_KEY` and `RECUERDEA_GEOCODE_MAX_PER_RUN`). The second pCloud client (built from `PCLOUD_ADMIN_AUTH`) is removed.

**Surface delta**

- `src/lib/admin/collection.{ts,server.ts}` — rewritten. `fetchCuratedItems(collection, media)`, `addUuidsToCollection(collection, uuids)`, `removeUuidsFromCollection(collection, uuids)`. Server-fns: `getCollectionMedia`, `addToCollection`, `removeFromCollection`. Zero pCloud imports.
- `src/lib/admin/folder-media.{ts,server.ts}` (new) — `fetchAdminFolderMedia(folder, media)` reads `folder/v1` + per-uuid media-cache; `getAdminFolderMedia` server-fn. Zero pCloud imports.
- `src/components/AdminCollectionGrid.tsx` (new) — uuid-keyed multi-select picker; replaces the v12 `AdminFolderNavigator`. Sticky `Guardar (N)` / `Cancelar` footer, blocked tiles dimmed + `aria-disabled`.
- `src/components/CollectionItemsGrid.tsx` — props switch from `fileid` to `uuid`.
- `src/lib/admin/source-folder.{ts,server.ts}` — **deleted**.
- `src/components/AdminFolderNavigator.tsx` — **deleted**.

## 24. v12 → v13 changes summary

For readers diffing this spec against v12:

- §1 / §2: unchanged.
- §4 Project Structure: stays at v10 baseline. Admin file inventory lives in the version sections.
- §7 Boundaries: "Always do" cron-writer bullet narrows back to `media/<uuid>` + `fileid-index/<fileid>` + `folder/v1` (no `collection/v1`). New bullet adds the admin route as sole writer of `collection/v1`. "Never do" gains: never call any pCloud `collection_*` endpoint.
- §19 (v11): superseded by §23 — `PCLOUD_COLLECTION_ID` is gone, the cron no longer writes the collection blob, and the "04:00 UTC" banner is gone.
- §21 (v12): superseded by §23 — `PCLOUD_ADMIN_AUTH` is gone, the source-folder navigator is gone, `fileid` is no longer the wire id in the admin surface, and admin reads are blob reads (not live `collection_details`).
- §23 (new): v13 acceptance criteria — blob-only storage, admin sole writer, env-var demolition, instant edits, picker scoped to cached folder items.

## 25. v14 Acceptance Criteria

Cumulative on top of §23 (v13). v14 restores the v12-style **navigable view of `PCLOUD_SOURCE_FOLDER_ID`** as the "Añadir más" picker on top of v13's blob-backed storage. v13's flat grid over the memories-folder snapshot is gone — it was a misreading of the design intent during v13 build-out.

Files picked from outside `PCLOUD_MEMORIES_FOLDER_ID` get **lazy-minted** at admin save time (stat + getfilepublink, no range-fetch extraction). The cron sweep reads `collection/v1` so those lazy-minted uuids aren't deleted on the next run. The home loader and the curated-grid section are unchanged.

**Route layout**

- `src/routes/admin/collection.tsx` is a **layout** route: it owns the admin `beforeLoad` gate, the curated-collection loader (`getCollectionMedia()`), and the shared chrome (`AppShell` + `Topbar` + page heading). It renders `<Outlet />` and nothing else of substance.
- `src/routes/admin/collection/index.tsx` is the `/admin/collection` leaf — curated grid + remove + a Chakra-styled `<Link to="/admin/collection/add">` button ("Añadir más").
- `src/routes/admin/collection/add.tsx` is the `/admin/collection/add` leaf — the picker. Owns its own search-param + source-folder loader; reads the curated list from the parent loader via `useLoaderData({ from: '/admin/collection' })` to compute `blocked`.

**Picker shape**

- `/admin/collection/add?folderid=N` (search param, validated as non-negative integer; defaults to source root when absent).
- Loader fetches `getAdminSourceFolder({ folderid })`. The curated list (for `blocked`) comes from the parent layout's loader; the picker route does not re-fetch it.
- **Date filter** (`?date=YYYY-MM-DD`, validated against `^\d{4}-\d{2}-\d{2}$`): `AdminMediaDateFilter` offers two relative presets (**Hoy** / **Mañana**) plus a calendar input for any single day. It filters **only the media grid** by exact local calendar day against each file's `created` (the same `file.created` used for `captureDate`); folders/breadcrumbs are never filtered. Filtering is **client-side** — `date` is deliberately kept out of `loaderDeps`, so toggling it re-filters in place without re-fetching pCloud. The filter **persists across folder navigation** (`handleNavigate` carries `date` forward), so nested folders stay filtered, not just the root. When no media matches, the navigator shows a date-specific empty state and subfolders remain navigable.
- Picker is `AdminFolderNavigator`: breadcrumbs row → subfolder grid → file grid → sticky `Guardar (N)` / `Cancelar` footer. Sub-folder clicks navigate via `?folderid`; file clicks toggle selection. Picks survive folder navigation within `/add` (route state is `Map<fileid, SourceFileItem>`); they are discarded on Save (after navigating back) or Cancel.
- Save: `addToCollection({ fileids })` → `await router.invalidate()` → `router.navigate({ to: '/admin/collection' })`. The curated grid renders the new items immediately on landing.
- Cancel: `router.navigate({ to: '/admin/collection' })`. No persisted picked state.
- `blocked: Set<fileid>` computed client-side from `collection.items.map(m => m.fileid)`. CollectionItem carries `fileid` for this reason.

**Wire format**

- `addToCollection({ fileids: number[] })`. Server resolves each fileid → uuid via fileid-index; lazy-mints when missing.
- `removeFromCollection({ uuids: string[] })` — unchanged (removed items always have a uuid).
- The blob still stores uuids — loader path unchanged.

**Lazy-mint (`lazyMintFile`)**

- Short-circuits when fileid-index already has the fileid (no pCloud calls).
- For unknown fileids: 1× `stat({ fileid })` (hash, contenttype, name, created) + 1× `getfilepublink({ fileid })` (code, linkid). No range-fetch extractor — `width`, `height`, `location`, `place` stay `null` on the lazy-minted entry.
- captureDate parsed from pCloud's `file.created` (matches the cron path).
- Writes `media/<uuid>` + `fileid-index/<fileid>` atomically before returning.

**Cron sweep protection**

- `refreshMemories(...)` accepts an optional `collectionReader?: CollectionReader` parameter (read-only view of `collection/v1`).
- Sweep: `protectedSet = new Set([...aliveUuids, ...(curated ?? [])])`. Curated-but-non-memories uuids never get marked stale.
- Read-only access — the admin route remains the sole writer of `collection/v1`. The §7 single-writer invariant holds.
- When `collectionReader` is omitted (or returns undefined), sweep treats only the memories-folder snapshot as alive.

**Coverage trade-off**

- Lazy-minted entries outside the memories folder never get re-extracted: width/height stay null; geocoding never runs against them. UI degrades gracefully (no place caption, browser handles natural sizing). Future work may widen cron coverage to iterate curated uuids.

**Loader: collection/v1 is the sole source (v15)**

- `fetchTodayMemories` reads only `collection/v1`. The v13 fallback to `folder/v1` is gone; the cron no longer writes `folder/v1`; the `folder-cache` module (`src/lib/cache/folder-cache.{ts,server.ts}`) is deleted.
- `undefined` blob → `console.warn('[pcloud] collection blob missing — admin has not curated yet')` and render empty (boot state).
- `{ uuids: [] }` → render empty silently (deliberate empty curation).
- `refreshMemories(...)` signature drops the v13 `folderCache: FolderCache` parameter. Cron writes only `media/<uuid>` and `fileid-index/<fileid>`.

**Surface**

- Restored: `src/lib/admin/source-folder.{ts,server.ts}` (uses `PCLOUD_TOKEN` OAuth, not the dropped `PCLOUD_ADMIN_AUTH`), `src/components/AdminFolderNavigator.tsx`.
- Renamed type: `AdminFileItem` (v13) → `CollectionItem` (v14, uuid + fileid + name + kind + thumbUrl).
- New type: `SourceFileItem` (fileid + name + kind + thumbUrl + `created`) — what `fetchAdminSourceFolder` returns; no uuid yet. `created` is `file.created` normalized to an ISO instant (or `null`), carried to the browser so the picker can filter by day.
- Date-filter helpers live in `src/lib/admin/date-filter.ts` (`localDay`, `filterFilesByDay`, `todayLocal`, `tomorrowLocal`) — pure + Node-unit-testable; the UI is `src/components/AdminMediaDateFilter.tsx`.
- New helpers: `lazyMintFile`, `addFileidsToCollection` in `collection.server.ts`. `addUuidsToCollection` is removed.
- Deleted: `src/lib/admin/folder-media.{ts,server.ts}`, `src/components/AdminCollectionGrid.tsx` (v13 flat picker).
- `PCLOUD_SOURCE_FOLDER_ID` env var: restored (optional; absence triggers a banner).
- `PCLOUD_ADMIN_AUTH` / `PCLOUD_COLLECTION_ID` env vars: still gone.

**Banner copy**

- `/admin/collection` (curated view) shows the info alert: "Los cambios aparecen inmediatamente en la página principal." — matches reality. The v11 "04:00 UTC" banner stays retired.
- `/admin/collection/add` (picker) keeps `SourceFolderMissingBanner` (when `PCLOUD_SOURCE_FOLDER_ID` is unset) and `FolderNotPermittedBanner` (when the requested folder is outside the source-root subtree).

## 26. v13 → v14 changes summary

For readers diffing this spec against v13:

- §1 / §2: unchanged.
- §4 Project Structure: adds `routes/admin/` (layout + `index.tsx` curated grid + `add.tsx` picker) and `routes/api/admin/thumb/$fileid.ts` (IP-bound thumbnail proxy).
- §7 Boundaries: "Always do" cron-writer bullet narrows to `media/<uuid>` + `fileid-index/<fileid>` (v15: `folder/v1` is gone — see §25 Loader section). The admin-writer bullet is annotated with the v14 fact that the cron is now a **read-only consumer** of `collection/v1`, plus the v15 fact that the home loader reads `collection/v1` as the sole source of uuids.
- §23 (v13): superseded by §25 for the picker scope (flat-grid → navigable view of `PCLOUD_SOURCE_FOLDER_ID`) and for the loader semantics (v15: no `folder/v1` fallback). Storage shape + admin-writer rule from v13 are still current.
- §25 (new): v14 + v15 acceptance criteria — navigator restored, fileid wire format with lazy-mint, cron sweep protection, env var restored, and (v15) `collection/v1` as the sole loader source with the `folder-cache` module deleted. The picker page lives at `/admin/collection/add`; `/admin/collection` is the curated-list view. Source-folder thumbnails proxy through `/api/admin/thumb/<fileid>` because `getthumblink` URLs are IP-bound (§17).
- §25 picker (later addition): the picker gained a **date filter** (`?date=YYYY-MM-DD`, Hoy/Mañana presets + calendar) that filters only the media grid by exact local day against `file.created`, client-side (out of `loaderDeps`), and persists across nested-folder navigation. `SourceFileItem` now carries `created`; helpers in `src/lib/admin/date-filter.ts`, UI in `src/components/AdminMediaDateFilter.tsx`.
