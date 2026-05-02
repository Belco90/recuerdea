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
- Videos render with `<video controls>`, no autoplay, with a poster from a pCloud public-link thumbnail. Stream URL via pCloud public-link download.
- If no item matches, render a friendly empty state ("No memories on this day"). **No random fallback button.**
- Unauthenticated visits redirect to `/login` via `beforeLoad` (unchanged).
- pCloud SDK access stays server-only via `createServerFn` and the cron Netlify function. The pCloud auth token never leaves the server.
- Media is delivered through `/api/memory/<uuid>?variant=image|stream|poster` — an auth-gated route that byte-streams the upstream pCloud public-link response. UUIDs are stable identifiers minted by the cron; `fileid` and the public-link `code` stay server-side and never reach the browser (see §11).
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
    index.tsx       # Home route — beforeLoad auth gate + loader + Home component (composes Topbar, AdminDateOverride, Hero, Timeline / YearSection / Polaroid, EmptyState, Lightbox)
    login.tsx       # Netlify Identity login + invite/recovery callbacks (analog-album layout — v5)
    api/
      memory/
        $uuid.ts    # GET /api/memory/:uuid?variant=image|stream|poster — auth-gated, byte-streams the public-link response — added in v4
  components/       # Reusable presentational React components (PascalCase per file). All Chakra-native — v5.
    AppShell.tsx          # Page-level Box wrapper (paper bg lives on body via globalCss)
    Wordmark.tsx          # Italic Fraunces "Recuerdea" wordmark with rotated R + accent dot
    Topbar.tsx            # Sticky blurred topbar — Wordmark + user pill (Avatar.Fallback) + logout
    Hero.tsx              # Big day + italic-accent month + mono caps year/count meta
    EmptyState.tsx        # Three striped polaroids + Spanish empty copy
    Polaroid.tsx          # Polaroid tile (paper frame, stable rotation, lazy image, video badge, handwritten caption)
    YearSection.tsx       # Year-marker dot + "Hace N año(s)" title + columnCount masonry of Polaroid tiles
    Timeline.tsx          # Vertical timeline line + end dot + Spanish footer
    Lightbox.tsx          # Per-year fullscreen Chakra Dialog (image or video controls autoPlay, swipe, arrow keys, dots)
    AdminDateOverride.tsx # Admin-only banner: striped diagonal bg + paper tape + Chakra DatePicker + state pill
  lib/                # Pure logic + server functions; split by domain. Tests colocated as *.test.ts(x).
    auth/                       # User identity end-to-end
      auth.ts                   # createServerFn wrapper for getServerUser
      auth.server.ts            # loadServerUser — server-only auth (isAdmin, JWT decode)
      identity-context.tsx      # IdentityProvider + useIdentity hook
    memories/                   # pCloud-backed memory pipeline
      pcloud.ts                 # createServerFn wrapper for getTodayMemories — returns MemoryItem[]
      pcloud.server.ts          # Loader — reads from folder-cache + media-cache only; no listfolder, no pCloud client. MemoryItem now carries width/height — v5.
      refresh-memories.server.ts# Cron orchestrator: lists folder, ensures public links, writes caches, sweeps deleted files — v4
      memory-route.server.ts    # /api/memory/$uuid handler (auth gate + byte-streaming) — v4
      memory-grouping.ts        # groupMemoriesByYear pure helper — v5
    cache/                      # Netlify-Blobs-backed stores; each pair = pure abstraction + server store-getter with no-op fallback — v4
      media-cache.ts            # Pure (uuid → CachedMedia) cache abstraction. CachedMedia gains width/height (v5), location + place (v6).
      media-cache.server.ts
      fileid-index.ts           # Pure (fileid → uuid) sidecar abstraction
      fileid-index.server.ts
      folder-cache.ts           # Pure folder-listing snapshot abstraction
      folder-cache.server.ts
    media-meta/                 # Capture-date + dimensions + GPS extraction from bytes; called from refresh-memories.server
      exif.ts                   # EXIF extraction (extractImageMeta) — extended in v5 (dims), v6 (GPS lat/lng)
      video-meta.ts             # MP4/MOV moov walker — capture date (mvhd) + dimensions (tkhd) (extractVideoMeta) — extended in v5 (dims), v6 (GPS via udta.©xyz)
      filename-date.ts          # Filename-based capture-date fallback
      geoapify.server.ts        # v6 — Reverse-geocode lat/lng → Spanish place string via Geoapify; raw fetch, body-status authoritative, tagged failure reasons
    utils/                      # Small leaf helpers
      spanish-months.ts         # SPANISH_MONTHS const + spanishMonth(idx) — used by Hero, login, AdminDateOverride — v5
      rotation.ts               # Stable per-key rotation for polaroid scatter — v5
      navigation.ts             # hardNavigate (post-logout cookie refresh)
  theme.ts          # Chakra v3 createSystem — accent.50…950 palette, semantic light/dark tokens, fonts, shadows, keyframes, breakpoints.md=720px, paper-noise body bg via globalCss — v5
  fonts.css         # @font-face declarations for the four self-hosted variable woff2 in public/fonts/ — v5
  router.tsx        # getRouter() factory
  routeTree.gen.ts  # auto-generated, never edit by hand
public/
  fonts/            # Self-hosted variable woff2 (Fraunces, Inter, Caveat, JetBrains Mono — latin subset only) — v5
test/
  setup.ts          # Vitest browser-mode setup, mocks @netlify/identity
  stubs/            # Stubs for @tanstack/react-start in browser mode
__mocks__/
  @netlify/identity.ts
netlify/
  functions/
    refresh-memories.ts # Scheduled Netlify Function: lists folder, ensures public links, writes caches, sweeps deleted files — added in v4 (registered via netlify.toml [functions."refresh-memories"] schedule)
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
- Keep server-only secrets (pCloud credentials, future tokens) behind `createServerFn` and Netlify functions (`src/lib/memories/pcloud.ts`, `src/lib/memories/pcloud.server.ts`, `src/lib/auth/auth.server.ts`, `netlify/functions/*.ts`). Read `process.env` only inside server-only modules.
- **Auth-gate every API endpoint** in `src/routes/api/`. Each handler must call `loadServerUser()` and 401 unauthenticated callers — defense-in-depth on top of `beforeLoad`.
- Colocate tests with source under `src/lib/` for any new pure logic.
- Use the existing path alias `#/*` for `src/` imports.
- **Branch-per-version (v4+)**: do v4 work on a `v4` branch, v5 on `v5`, etc. PRs target `main` so Netlify spins a deploy preview per PR. `main` is protected — no direct pushes. Smoke the deploy preview before merge.
- **Resolve media URLs server-side in the loader (v9).** The home loader calls `getpubthumblink({ code, size })` per item — `640x640` → `MemoryItem.thumbUrl`, `1025x1025` → `MemoryItem.lightboxUrl` — and (videos only) `getpublinkdownload({ code })` → `MemoryItem.mediaUrl`. The browser renders `<img src>` / `<video src>` directly against `https://${hosts[0]}${path}` (a `*.pcloud.com` CDN host). The CDN URLs carry their own time-limited tokens; the public-link `code` itself never reaches the browser. Downloads use a separate `getMediaDownloadUrl({ uuid })` server-fn that returns the same shape; the client `fetch`es the URL into a `Blob` and saves via an `<a download>` click. The previous `/api/memory/<uuid>?variant=...` byte-streaming proxy was removed in v9 — the double-hop was the latency bottleneck.
- **The cron is the only writer for `media/<uuid>`, `fileid-index/<fileid>`, and `folder/v1`.** Loader and route handlers are read-only. Pre-prod, the cron must be triggered manually via the Netlify dashboard so the snapshot exists before users hit the page.
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
- **Embed the pCloud token, public-link `code`, `linkid`, or `fileid` in HTML / JSON / loader cache.** The token, `code`, and `linkid` are server-only. v9 relaxes this for `uuid` and the resolved `*.pcloud.com` CDN URLs (`thumbUrl`, `lightboxUrl`, `mediaUrl`) — those reach the browser intentionally — but the underlying public-link `code` is not exposed.
- **Public-cache the home page HTML.** Per-user content. `Cache-Control` must be `private` / `no-store` / absent — never `public, s-maxage=...`.
- Push directly to `main` — open a PR from the version branch instead.

## 8. Open Questions (resolve before implementation)

1. **MP4/MOV metadata parser library** — resolved in v2 (hand-rolled mvhd reader, no dep).
2. **Range-fetch strategy for video EXIF** — resolved in v2 (two-step start/tail fetch).
3. **Metadata store** — Netlify Blobs is shipped for the v4 cache: `media/<uuid>` (`{ fileid, hash, code, linkid, kind, contenttype, name, captureDate }`), `fileid-index/<fileid>` (`{ uuid }`), and `folder/v1` (`{ refreshedAt, uuids }`). `consistency: 'eventual'`, with a no-op fallback when the Blobs runtime isn't reachable (plain `pnpm dev`). Tagging/upload metadata stores remain future work. v3's per-fileid `capture-cache` is folded into `media/<uuid>` and removed.
4. **Media URL signing (v4 → v9)** — v4 shipped a server-side proxy at `/api/memory/<uuid>?variant=...` that byte-streamed pCloud public-link responses. **Superseded by v9**: the loader now calls `getpubthumblink` / `getpublinkdownload` per item server-side and embeds the resolved `https://${hosts[0]}${path}` CDN URLs in `MemoryItem`. The browser renders direct `*.pcloud.com` URLs; the proxy is deleted. Public links remain not IP-bound and not Referer-gated, so server-side resolution always succeeds; the `code` itself stays server-only.
5. **Cron schedule (v4)** — daily at 04:00 UTC (`0 4 * * *`). **Cron is the only writer.** No on-demand fallback; missing snapshot ⇒ home renders empty + warn. Manual first-run trigger required pre-prod.
6. **Cache invalidation (v4)** — pCloud's content-derived `hash` invalidates per-uuid entries on content change (rename ≠ content change; same fileid + same hash = noop). When a fileid disappears from `listfolder`, the cron deletes the public link via `deletepublink(linkid)` and clears both `media/<uuid>` and `fileid-index/<fileid>`.
7. **Scalability budget (v4 → v9)** — design for ~1000 files in the folder, ~30 matched-day items per visit. Hot path on the server **(v9)**: 1 `folder/v1` snapshot read + N `media/<uuid>` reads + **2N + V parallel pCloud calls** (N matched items × 2 thumb sizes + V videos × `getpublinkdownload`). Latency ≈ max-of-individual ≈ 100–200 ms via `Promise.allSettled`. Per-loader failures are logged and the offending item dropped. **Zero pCloud API calls on the route-hit path** since browser fetches CDN URLs directly; Netlify bandwidth drops to near zero on the media path (only the loader response + the lazy download server-fn).
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
- `fetchTodayMemories(today, client)` takes a `Client` argument; the `pcloud.ts` server-fn wrapper reads `PCLOUD_TOKEN` and instantiates the client. Missing token → server-fn returns `[]` + warn (parity with the existing missing-snapshot path).
- Per-item URL resolution runs in parallel via `Promise.allSettled`. A single failing resolve drops only that item with a `console.warn` (no fileid / no code in the log line).

**Frontend**

- `Polaroid` renders `<img src={item.thumbUrl}>`.
- `Lightbox` image slide renders `<img src={item.lightboxUrl}>`. Video slide renders `<video src={item.mediaUrl} poster={item.thumbUrl}>`.
- Download button calls `getMediaDownloadUrl({ uuid })` server-fn → `{ url, name, contenttype }` → client-side `fetch` → `Blob` → `URL.createObjectURL` → `<a download={name}>` click → revoke. Chakra `Spinner` + disabled while pending; icon turns red on error.

**Demolition**

- `src/routes/api/memory/$uuid.ts`, `src/lib/memories/memory-route.server.ts`, `memory-route.server.test.ts` deleted. `routeTree.gen.ts` regenerated.
- Zero `/api/memory/<uuid>` requests anywhere in the running app.

**Boundary**

- pCloud token still server-only.
- Public-link `code` and `linkid` stay in `CachedMedia` (server-only); they do **not** reach the browser.
- The CDN URLs returned by `getpubthumblink` / `getpublinkdownload` (`https://${hosts[0]}${path}`) carry their own time-limited tokens and reach the browser. SPEC §7 "Never do" updated accordingly.

## 16. v8 → v9 changes summary

For readers diffing this spec against v8:

- §1 Objective and §2 Acceptance Criteria: unchanged.
- §4 Project Structure: adds `src/lib/memories/pcloud-urls.server.ts` (URL resolvers), `src/lib/memories/get-download-url.server.ts` + `get-download-url.ts` (lazy download URL server-fn), `src/lib/memories/download.ts` (client-side blob helper). Deletes `src/routes/api/memory/$uuid.ts` and `src/lib/memories/memory-route.server.ts`. `MemoryItem` gains `thumbUrl` + `lightboxUrl` + (videos) `mediaUrl`.
- §7 Boundaries: "Always do" replaces the proxy-route bullet with the v9 server-side resolution rule. "Never do" relaxes the no-embed rule to allow `uuid` + the resolved CDN URLs (but not `code` / `linkid` / token).
- §8 Open Questions: §8.4 (media URL signing) closed with the v9 design. §8.7 (scalability budget) updated for the new loader cost (2N+V parallel calls).
- §13 (v6) and earlier sections: unchanged.
