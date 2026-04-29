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
- pCloud SDK access for folder listing + capture-date extraction stays server-only via `createServerFn`. Media URL signing happens in the browser (see §11): the SSR loader returns `{ items, pcloudToken }`, and the browser uses a shared `pcloud-kit` `Client` (provided via React context) to resolve `getthumblink` / `getfilelink` URLs on mount so signing-IP and consuming-IP match.
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
    index.tsx       # Home route — loader + Home component + MemoryView + AdminDateOverride
    login.tsx       # Netlify Identity login + invite/recovery callbacks
  lib/              # Pure logic + server functions; tests colocated as *.test.ts(x)
    auth.ts         # createServerFn wrapper for getServerUser
    auth.server.ts  # loadServerUser — server-only auth (isAdmin, JWT decode)
    pcloud.ts       # createServerFn wrapper for getTodayMemories — returns { items, pcloudToken }
    pcloud.server.ts# pCloud SDK init (process.env secrets), folder listing + capture-date extraction
    pcloud-client.tsx # Browser-side: PcloudClientProvider + usePcloudClient + useMemoryUrls — added in v4
    exif.ts         # EXIF capture-date extraction (images)
    video-meta.ts   # MP4/MOV creation_time extraction (videos) — added in v2
    filename-date.ts# Filename-based capture-date fallback
    capture-cache.ts        # Pure (fileid → { hash, captureDate }) cache abstraction — v3
    capture-cache.server.ts # Netlify-Blobs-backed store + no-op fallback — v3
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
- **Resolve pCloud signed URLs in the browser, not on the server.** pCloud signs `getfilelink` / `getthumblink` / `getvideolink` URLs bound to the **caller's IP**, so a server-signed URL is unusable in the browser ("another IP address" error). The SSR loader returns `{ items, pcloudToken }`; the browser instantiates one shared `pcloud-kit` `Client` via `PcloudClientProvider` (React context, `useState` lazy init); each `<MemoryView>` calls `useMemoryUrls(item)` to sign URLs on mount via that client. Server code may still call `getfilelink` for a one-shot in-handler fetch (e.g. EXIF range read at SSR time) — the URL just must not be serialized out to the browser.
- **The home page HTML must not be public-cached.** Because the SSR response embeds `pcloudToken`, the response must be `Cache-Control: private` (or `no-store`) — never `public, s-maxage=...`. Verify on the deploy preview with `curl -I` after any change to the home loader.

### Ask first

- **Adding any new top-level dependency** — including the **MP4/MOV metadata parser library** needed for v2 (e.g. `mp4box`, hand-rolled `mvhd` atom reader, etc.). List candidates and tradeoffs; wait for approval.
- Changes to `oxlint.config.ts` / `oxfmt.config.ts` / `tsconfig.json` / `vite.config.ts`.
- Changes to `.github/workflows/ci.yml` or `netlify.toml` (the latter is added under "ask first" in v4 because the scheduled-function block lives there).
- Introducing a new top-level route or restructuring `src/lib/`.

### Never do

- Disable per-route SSR as a shortcut for auth issues (use `beforeLoad` instead).
- Import `*.server.ts` modules (Blobs, identity, anything reading `process.env`) from client-rendered code. `pcloud-kit` itself is fine to import in browser code — the Node-only methods (`download` / `downloadfile` / `uploadfile`) dynamic-import `node:fs` / `node:path` / `node:stream` and we never call them.
- Edit `src/routeTree.gen.ts` — it is auto-generated.
- Bypass `simple-git-hooks` with `--no-verify`.
- Swap the stack: no React Native, no Next.js, no replacing Chakra UI v3, no replacing Vitest. Stack is locked.
- Build a tagging / upload / metadata-mutation UI — out of scope for v1 and v2.
- Re-introduce the random fallback — explicitly retired in v2.
- **Sign a pCloud URL on the server and pass it to the browser.** The URL is bound to the signing IP — the browser's IP won't match, the request gets rejected with "another IP address". Either the browser signs it (the v4 design) or the server signs it and consumes it in the same handler (e.g. EXIF range fetch). Never serialize a server-signed pCloud URL into HTML, JSON, loader cache, or Blobs.
- **Public-cache the home page HTML.** It embeds the pCloud token; `Cache-Control` must be `private` / `no-store` / absent — never `public, s-maxage=...`.
- Push directly to `main` — open a PR from the version branch instead.

## 8. Open Questions (resolve before implementation)

1. **MP4/MOV metadata parser library** — resolved in v2 (hand-rolled mvhd reader, no dep).
2. **Range-fetch strategy for video EXIF** — resolved in v2 (two-step start/tail fetch).
3. **Metadata store** — Netlify Blobs is shipped for the v3 capture-date cache (`{ hash, captureDate }` keyed by `fileid`). `consistency: 'eventual'`, with a no-op fallback when the Blobs runtime isn't reachable (plain `pnpm dev`). Tagging/upload metadata stores remain future work.
4. **Media URL signing (v4)** — resolved: the **browser** signs URLs via `pcloud-kit` so signing-IP and consuming-IP match. The SSR loader returns `{ items, pcloudToken }`; `PcloudClientProvider` instantiates one client per session (`useState` lazy init); `useMemoryUrls(item)` calls `getthumblink` / `getfilelink` on mount. The earlier byte-stream proxy at `/api/media/:fileid` and the planned UUID-indirected variant are withdrawn — the proxy is being deleted in this slice.
5. **Cron-warmed cache (v4)** — withdrawn. One `listfolder` per visit + the v3 capture-cache is acceptable for ~1000 files. Cron + folder snapshot + UUID-indirected cache shape are out of scope.
6. **UUID indirection (v4)** — withdrawn. With the pCloud token already in the browser, hiding `fileid` behind a per-file UUID adds machinery without a security gain.
7. **Scalability budget (v4)** — design for ~1000 files in the folder, ~30 matched-day items per visit. Hot path on the server: 1 `listfolder` + N capture-cache reads (zero extractor calls on warm cache). Hot path on the browser: N parallel `getthumblink` / `getfilelink` calls on mount (one per matched item). HTTP/2 multiplexing keeps the browser-side fan-out cheap.

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

Cumulative on top of §2. v4 fixes the IP-mismatch bug (the real cause of the v3-era "410") by moving pCloud URL signing to the browser.

**Correctness**

- No production 410s / "another IP address" errors on `<img>` / `<video>` / poster requests, including: (a) lazy-scrolled items rendered minutes after page load, (b) re-renders driven by TanStack Router's loader cache, (c) browser back/forward into a previously-rendered home page.
- Achieved by signing pCloud URLs in the **browser**, not on the server. The browser's IP matches the signing IP by construction. No pCloud signed URL is ever serialized in HTML, loader cache, JSON response, or Blobs.

**SSR loader payload**

- `getTodayMemories` (server function) returns `{ items: MemoryItem[], pcloudToken: string }`.
- `MemoryItem` carries `fileid` + content-type + capture date — never URL strings:
  - `{ kind: 'image'; fileid: number; name: string; captureDate: string }`
  - `{ kind: 'video'; fileid: number; contenttype: string; name: string; captureDate: string }`
- The handler hard-requires `loadServerUser()` — unauthenticated callers throw, so the token isn't leaked to anyone hitting the server-fn endpoint without the auth cookie.

**Browser-side signing**

- `src/lib/pcloud-client.tsx` exposes `PcloudClientProvider` (one shared `pcloud-kit` `Client` per session, `useState` lazy init), `usePcloudClient`, and `useMemoryUrls(item)`.
- `<MemoryView>` is effect-driven: shows a placeholder until `useMemoryUrls` resolves, then renders `<Image>` / `<video>` with the freshly-signed URLs.
- The SSR HTML for `/` is `Cache-Control: private` (or `no-store`) — never publicly cacheable, because it embeds the pCloud token.

**Caching**

- v3's per-fileid `{ hash, captureDate }` capture-cache is kept verbatim — it still saves EXIF / mvhd extractor cost on warm visits.
- No additional Blobs stores, no cron, no UUID indirection, no folder snapshot. Each visit calls `client.listfolder` once on the server.

**Layout / UX**

- Unchanged from v2 (vertical feed, image vs. video distinguished by player UI, oldest year first, admin date override). One added bit: a brief placeholder appears per item while the browser signs its URL on mount.

**Workflow**

- v4 work happens on a `v4` branch with a PR into `main`; Netlify produces a deploy preview per PR. The IP-mismatch fix is verified on the preview before merge — direct `*.pcloud.com` requests in the network tab, no `/api/media/*` requests, no "another IP address" errors after lazy scroll / 30-min idle.

## 12. v3 → v4 changes summary

For readers diffing this spec against v3:

- §1 / §2: same product. §2 gains a bullet stating that media URLs are signed in the browser, not at SSR time.
- §4 Project Structure: adds `src/lib/pcloud-client.tsx` (browser-side pcloud-kit context + hooks). v3's `capture-cache(.server).ts` is unchanged. The byte-stream proxy at `src/routes/api/media/$fileid.ts` and the helper `src/lib/media-proxy.server.ts` — built and shipped earlier in v4 — are deleted in this slice. The `src/components/` PascalCase split is parked as a follow-up; the home route still hosts `<Home>`, `<MemoryView>`, `<AdminDateOverride>` for now.
- §5 Code Style: unchanged from v3.
- §7 Boundaries: "always do" replaces the byte-stream rule with browser-side signing, and adds the `Cache-Control: private` constraint on the home page HTML. "Never do" replaces the "serialize signed URLs" rule with "sign on the server and pass to the client" (same constraint, different framing) and softens the "no server-only imports" rule to be specific about `*.server.ts` modules (so client code can import `pcloud-kit` itself).
- §8 Open Questions: §8.4 resolved as "browser signs"; §8.5 / §8.6 (cron, UUID indirection) are withdrawn from v4 scope.
- §11: rewritten — IP-mismatch fix via browser-side signing; SSR loader returns `{ items, pcloudToken }`; v3 capture-cache stays; no cron, no UUID indirection.

**Earlier v4 design (reverted in this slice):** the original v4 plan introduced `/api/media/:uuid` as a byte-stream proxy with a UUID-indirected `media/${uuid}` cache, a `fileid-index/${fileid}` sidecar, a `folder/v1` snapshot, and a daily Netlify Scheduled Function. It worked but was over-engineered for a single-user app. The proxy and sidecars are removed; the byte-stream learning lives on in this section as historical context.
