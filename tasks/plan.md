# Recuerdea v9 — Server-resolved pCloud URLs in the route loader; demolish `/api/memory/<uuid>` proxy

## Where we are

- **v8 shipped** at `2d84386` — `PCLOUD_TOKEN` is an OAuth access token; both server call sites use `createClient({ token })`.
- **A prior v9 plan (browser-side public-link calls) is abandoned.** pCloud blocks the browser-origin pubthumb variants in practice; URLs must be minted server-side.
- **Today's hot path is slow.** `<img src="/api/memory/<uuid>?variant=thumb">` → Netlify function reads cache → fetches `eapi.pcloud.com/getpubthumb` → byte-streams the response back. The double-hop is the bottleneck.

## Goal — single end state

- **Loader** resolves URLs server-side, **per item** via `getpubthumblink` (no batching, no folder publink). Each `MemoryItem` carries `thumbUrl` (640×640) + `lightboxUrl` (1025×1025) + (videos) `mediaUrl` (stream/download). All URLs point at `*.pcloud.com` CDN; none carry the public-link `code`.
- **Polaroid** renders `<img src={item.thumbUrl}>`.
- **Lightbox image slide** renders `<img src={item.lightboxUrl}>`. **Video slide** renders `<video src={item.mediaUrl} poster={item.thumbUrl}>`.
- **Download** button calls `getMediaDownloadUrl({ uuid })` server-fn → resolved CDN URL → client-side `fetch` → `Blob` → `URL.createObjectURL` → `<a download={name}>` click → revoke.
- `/api/memory/<uuid>` route + `memory-route.server.ts` deleted.
- pCloud token still server-only. Per-file `code` + `linkid` stay in the cache, never reach the browser.
- **Cache shape unchanged.** **Cron unchanged.** Per-file public links keep working as-is.

Branch: `v9-server-thumbs` (cut from `main`). PR target: `main`. Light SPEC update.

---

## Architecture decisions

1. **Cache shape unchanged.** `CachedMedia` keeps per-file `code` + `linkid`. `FolderSnapshot` keeps `uuids`. Cron keeps minting per-file publinks via `getfilepublink`. Minimum churn.
2. **Loader resolves URLs server-side per item, per page-load.**
   - `resolveThumbUrl(client, code, '640x640')` → `getpubthumblink` (callRaw) → `https://${hosts[0]}${path}`.
   - `resolveThumbUrl(client, code, '1025x1025')` → same, larger size.
   - `resolveMediaUrl(client, code)` → `getpublinkdownload` (callRaw) → `https://${hosts[0]}${path}`.
   - All calls dispatched in parallel via `Promise.allSettled`; per-item failures drop the offending item with a single warn (no fileid in log).
   - Per-loader API cost: 2N + V (N = today's items, V = videos in today's set). Latency ≈ max-of-parallel ≈ 100–200 ms on a warm function. Acceptable; profile during Task 2.
3. **Per-file `code` never reaches the browser.** CDN URLs returned by `getpubthumblink` / `getpublinkdownload` carry their own time-limited tokens — they do not expose the public-link `code`. SPEC §7 boundary preserved (modulo wording: media URLs reach the browser, but the `code` does not).
4. **Image originals (download URLs) lazy.** `MemoryItem` does not ship a download URL for images; resolved on click via `getMediaDownloadUrl({ uuid })`. Saves N extra calls per page-load. Videos still ship `mediaUrl` because `<video src>` needs it eagerly for stream playback; the download button reuses it.
5. **Lightbox image size: 1025×1025.** Per user direction. Phase 0 verifies pCloud accepts the size; if rejected, picks the closest grid value (likely `1024x1024`).
6. **No URL caching across loader invocations.** Resolved CDN URLs expire (~6 h). Caching would need a TTL store; defer until profiling demands it.
7. **No batching.** `getpubthumbslinks` is the batched variant but requires a folder publink — and adopting that triggers a cache + cron migration that's out of scope for this change. Per-call latency is parallelizable; user has approved staying with `getpubthumblink` per item.

## Spike-gated assumptions

| Spike check                                                                                                                                      | If it fails                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server-side `client.callRaw('getpubthumblink', { code, size: '640x640' })` for an existing per-file `code` returns `{ result: 0, hosts, path }`. | Per-tile direct URL build (`https://eapi.pcloud.com/getpubthumb?code=…&size=640x640`) — exposes per-file `code` in browser; SPEC §7 needs a wider relaxation. |
| Server-side `client.callRaw('getpubthumblink', { code, size: '1025x1025' })` accepts `1025x1025`.                                                | Pick the closest accepted size from pCloud's grid (likely `1024x1024`); update the plan to that size.                                                         |
| Server-side `client.callRaw('getpublinkdownload', { code })` returns `{ result: 0, hosts, path }`.                                               | Already in production use today via `$uuid.ts`; sanity check only.                                                                                            |
| `https://${hosts[0]}${path}` for a video supports HTTP Range (206) from the browser.                                                             | Already verified by today's proxy; sanity check.                                                                                                              |
| Browser-side `fetch(cdnUrl).blob()` succeeds (CORS-permissive).                                                                                  | Fall back to `<a href={cdnUrl} download>` — may navigate inline. Worst case: keep the proxy for downloads only.                                               |

Phase 0 verifies these in ~10 minutes against the prod token.

---

## Loader shape

```ts
type MemoryItem =
	| {
			kind: 'image'
			uuid: string
			name: string
			captureDate: string
			width: number | null
			height: number | null
			place: string | null
			thumbUrl: string // 640×640
			lightboxUrl: string // 1025×1025
	  }
	| {
			kind: 'video'
			uuid: string
			contenttype: string
			name: string
			captureDate: string
			width: number | null
			height: number | null
			place: string | null
			thumbUrl: string // 640×640 — also used as <video poster>
			lightboxUrl: string // 1025×1025 — kept for shape parity; not currently rendered for video
			mediaUrl: string // resolved getpublinkdownload — <video src> + download
	  }

type HomeLoaderData = {
	memories: MemoryItem[]
	isAdmin: boolean
}
```

`HomeLoaderData` shape unchanged — all the new fields live on `MemoryItem`.

---

## File map

| Action     | File                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------ |
| **New**    | `src/lib/memories/pcloud-urls.server.ts` + test (`resolveThumbUrl`, `resolveMediaUrl`)           |
| **Modify** | `src/lib/memories/pcloud.server.ts` + test (loader resolves URLs; new `MemoryItem` shape)        |
| **Modify** | `src/lib/memories/pcloud.ts` (server-fn wrapper carries new shape)                               |
| **New**    | `src/lib/memories/get-download-url.ts` + test (server-fn for lazy download URL)                  |
| **New**    | `src/lib/memories/download.ts` + test (client-side blob-download helper)                         |
| **Modify** | `src/components/Polaroid.tsx` (use `item.thumbUrl`)                                              |
| **Modify** | `src/components/Lightbox.tsx` (use `item.lightboxUrl` + `item.mediaUrl`; rewire download button) |
| **Delete** | `src/routes/api/memory/$uuid.ts`                                                                 |
| **Delete** | `src/lib/memories/memory-route.server.ts` + test                                                 |
| **Modify** | `src/routeTree.gen.ts` (regenerated, never hand-edit)                                            |
| **Modify** | `SPEC.md` (§7 boundary touch-up; §17 v9 acceptance criteria; §18 v8→v9 diff)                     |

Untouched: `src/lib/auth/*`, `src/lib/cache/*`, `src/lib/cache/fileid-index*`, `src/lib/media-meta/*`, `src/lib/utils/*`, `src/lib/memories/refresh-memories.server.ts`, `netlify/functions/refresh-memories.ts`, `src/components/{AppShell,Topbar,Hero,EmptyState,Wordmark,Timeline,YearSection,AdminDateOverride}`, theme, fonts, cron schedule.

---

## Task list — vertical slices

### Phase 0 — Spike (10 min, no code changes)

#### Task 0: Confirm the pCloud calls work as needed

**Description:** From a Node REPL (or `pnpm tsx` script) with `PCLOUD_TOKEN`, plus a browser devtools console on the deploy preview, confirm the contracts the loader and download flow rely on.

**Acceptance criteria:**

- [ ] Server-side: `client.callRaw('getpubthumblink', { code: <existing per-file code>, size: '640x640' })` → `{ result: 0, hosts, path }`.
- [ ] Server-side: `client.callRaw('getpubthumblink', { code: <existing per-file code>, size: '1025x1025' })` → `{ result: 0, hosts, path }`. **If `1025x1025` is rejected**, capture the closest accepted size from pCloud's grid and update the plan to that size before code lands.
- [ ] Server-side: `client.callRaw('getpublinkdownload', { code: <existing per-file code> })` → `{ result: 0, hosts, path }`. (Sanity check; same call already in `$uuid.ts`.)
- [ ] Browser devtools (preview): `fetch('https://${hosts[0]}${path}', { headers: { Range: 'bytes=0-1023' } })` → 206 (video stream sanity).
- [ ] Browser devtools: `fetch('https://${hosts[0]}${path}').then(r => r.blob())` succeeds (CORS-permissive — confirms client-side download path).
- [ ] All results captured in PR description (including the final lightbox size).

**Verification:** by inspection.

**Dependencies:** v8 merged (it is); a few existing per-file `code`s pulled from Blobs.

**Files likely touched:** none.

**Estimated scope:** XS.

---

### ✅ Checkpoint 0 — Architecture viable

- [ ] All checks pass. **If any fails, stop** and pivot per "Spike-gated assumptions" above.

---

### Phase 1 — Server-side URL resolution

#### Task 1: Pure URL-resolution helpers + tests

**Description:** New module `src/lib/memories/pcloud-urls.server.ts` exporting:

- `resolveThumbUrl(client, code, size)` — calls `client.callRaw('getpubthumblink', { code, size })`; returns `https://${hosts[0]}${path}`. Throws on `result !== 0` (tagged with the pCloud `error` field) or missing/empty `hosts`.
- `resolveMediaUrl(client, code)` — calls `client.callRaw('getpublinkdownload', { code })`; returns `https://${hosts[0]}${path}`. Same error handling.

`size` is typed as a literal union (`'640x640' | '1025x1025'`).

**Acceptance criteria:**

- [ ] Both helpers implemented and unit-tested with a mocked `client.callRaw`.
- [ ] Throws on `result !== 0`.
- [ ] Throws on missing/empty `hosts`.
- [ ] No imports from `pcloud-kit` beyond the `Client` type.

**Verification:**

- [ ] `pnpm test src/lib/memories/pcloud-urls.server.test.ts`.
- [ ] `pnpm type-check`.

**Dependencies:** Task 0.

**Files likely touched:** `src/lib/memories/pcloud-urls.server.ts` 🆕 + test.

**Estimated scope:** S.

---

#### Task 2: Loader resolves URLs; `MemoryItem` gains `thumbUrl` + `lightboxUrl` + (videos) `mediaUrl`

**Description:** `pcloud.server.ts` instantiates a pCloud client (`createClient({ token: process.env.PCLOUD_TOKEN })` — same pattern as `refresh-memories` and the existing `$uuid.ts`) and resolves three URLs per match:

- Always: `thumbUrl` via `resolveThumbUrl(client, meta.code, '640x640')`.
- Always: `lightboxUrl` via `resolveThumbUrl(client, meta.code, '1025x1025')`.
- Videos only: `mediaUrl` via `resolveMediaUrl(client, meta.code)`.

All calls run in parallel via `Promise.allSettled`. Per-item failures: drop the item with a single `console.warn` (no fileid, no code, no place). User-visible: that one memory doesn't show today; reload re-mints.

If `PCLOUD_TOKEN` is unset, return `[]` and warn — same shape as the existing missing-snapshot path.

**Acceptance criteria:**

- [ ] Returned `MemoryItem`s match the shape under "Loader shape" above.
- [ ] All resolutions parallel: total loader latency ≈ max-of-individual, not sum.
- [ ] Per-item resolution failure drops only that item with a warn (no thrown error from the loader).
- [ ] Missing-token path returns `[]` + warn (no crash).
- [ ] `pcloud.server.test.ts` updated: covers happy path, partial failure (one item fails to resolve), missing token, and (for videos) missing `mediaUrl` on video resolution failure.

**Verification:**

- [ ] `pnpm test src/lib/memories/pcloud.server.test.ts`.
- [ ] `pnpm test src/lib/memories/memory-grouping.test.ts` (touched only if `MemoryItem` import changes).
- [ ] `pnpm type-check`.
- [ ] `pnpm dev`, log in, visit `/`, inspect React DevTools → loader response shows `thumbUrl` + `lightboxUrl` on every item, `mediaUrl` on every video.

**Dependencies:** Task 1.

**Files likely touched:**

- `src/lib/memories/pcloud.server.ts` + test
- `src/lib/memories/pcloud.ts` (server-fn wrapper — type-only follow-on)

**Estimated scope:** M (test churn dominates).

---

### ✅ Checkpoint A — Loader returns CDN URLs

- [ ] `pnpm test`, `pnpm type-check`, `pnpm lint`, `pnpm build` all pass.
- [ ] React DevTools shows `thumbUrl` + `lightboxUrl` (all items) and `mediaUrl` (videos) on the loader response.
- [ ] Frontend still works (proxy URLs in `<img src>` are still valid; new fields are unused at this point — wired in Phase 2).

---

### Phase 2 — Frontend uses direct CDN URLs

#### Task 3: `Polaroid` + `Lightbox` render direct pCloud URLs

**Description:** Swap proxy URLs for the loader-resolved fields:

- `Polaroid`: `<Image src={item.thumbUrl}>`.
- `Lightbox` image slide: `<Image src={item.lightboxUrl}>`.
- `Lightbox` video slide: `<video src={item.mediaUrl} poster={item.thumbUrl}>`.

Download button still hits `/api/memory/<uuid>?variant=download` — Task 5 swaps it.

**Acceptance criteria:**

- [ ] Timeline + lightbox playback: zero `/api/memory/<uuid>?variant=thumb` / `?variant=stream` requests in DevTools Network.
- [ ] Lightbox image renders at 1025×1025 (verify natural width via DevTools).
- [ ] Lightbox video plays from `*.pcloud.com`; range seeks work; poster shows the cached 640 URL with no extra request.
- [ ] No regression in image rotation, badge, caption, layout.

**Verification:**

- [ ] `pnpm dev`: scroll the home page, open lightbox image, open lightbox video, scrub. Network panel: zero proxy requests for thumb/stream.
- [ ] `pnpm test`: existing component snapshot/render tests pass.

**Dependencies:** Task 2.

**Files likely touched:**

- `src/components/Polaroid.tsx`
- `src/components/Lightbox.tsx`

**Estimated scope:** S.

---

### ✅ Checkpoint B — Display path off the proxy

- [ ] DevTools Network on `/`: `*.pcloud.com` for all `<img>` and `<video>`; zero proxy requests for thumb/stream.
- [ ] Proxy is used by the download button only.

---

### Phase 3 — Client-side downloads

#### Task 4: `getMediaDownloadUrl` server-fn + `download.ts` blob helper

**Description:** Two new modules:

- `src/lib/memories/get-download-url.ts` — `createServerFn({ method: 'GET' }).inputValidator({ uuid }).handler(...)`: auth-gates, reads media-cache, calls `resolveMediaUrl(client, meta.code)`, returns `{ url, name, contenttype }`. Errors: 401 unauth, 404 cache miss.
- `src/lib/memories/download.ts` — pure helper `downloadAs({ url, name }): Promise<void>`: `fetch(url) → r.blob() → URL.createObjectURL(blob) → click anchor → URL.revokeObjectURL`. Browser-safe; testable with mocked fetch + DOM stubs.

**Acceptance criteria:**

- [ ] Server-fn rejects unauthenticated calls.
- [ ] Server-fn returns a structured error on cache miss (loader-friendly; not a thrown 500).
- [ ] `downloadAs` revokes the Object URL after click (no leaked URLs in DevTools Memory).
- [ ] Both modules tested.

**Verification:**

- [ ] `pnpm test src/lib/memories/get-download-url.test.ts src/lib/memories/download.test.ts`.

**Dependencies:** Task 1.

**Files likely touched:**

- `src/lib/memories/get-download-url.ts` 🆕 + test
- `src/lib/memories/download.ts` 🆕 + test

**Estimated scope:** S.

---

#### Task 5: Lightbox download button → blob download

**Description:** Replace the `<a href="/api/memory/<uuid>?variant=download" download>` anchor in `Lightbox.tsx` with a button that:

1. Calls `getMediaDownloadUrl({ uuid: item.uuid })`.
2. Calls `downloadAs({ url, name })`.
3. Shows Chakra `Spinner` + `disabled` state during the operation.
4. Surfaces errors visibly (toast or inline — pick the lighter option in the existing UI; no new toast lib).

**Acceptance criteria:**

- [ ] Clicking download saves the original file with the correct filename, including names with accents/emoji.
- [ ] Spinner + disabled during download; reset on success and on error.
- [ ] Errors visible (not silently swallowed).
- [ ] Zero `/api/memory/<uuid>?variant=download` requests anywhere.

**Verification:**

- [ ] `pnpm dev`: download an image and a video. Both land on disk with correct name + bytes.
- [ ] Network panel: one request to the server-fn endpoint, then one `fetch` against `*.pcloud.com`.
- [ ] Memory panel: no leaked Object URLs after a few downloads.

**Dependencies:** Tasks 2, 3, 4.

**Files likely touched:** `src/components/Lightbox.tsx`.

**Estimated scope:** S.

---

### ✅ Checkpoint C — Proxy unused

- [ ] Network panel on `/` and inside the lightbox: zero `/api/memory/<uuid>` requests across timeline render, lightbox open, image swipe, video play, video scrub, download.
- [ ] `curl -I https://<preview>.netlify.app/` → still `Cache-Control: private`.

---

### Phase 4 — Demolition

#### Task 6: Delete `/api/memory/$uuid` route + `memory-route.server.ts`

**Description:** With nothing using the proxy, drop it.

**Acceptance criteria:**

- [ ] Deleted: `src/routes/api/memory/$uuid.ts`, `src/lib/memories/memory-route.server.ts`, `src/lib/memories/memory-route.server.test.ts`.
- [ ] `src/routeTree.gen.ts` regenerated by the dev server.
- [ ] `grep -r 'api/memory' src/ netlify/` → empty (or generated-only).
- [ ] `pnpm test`, `pnpm type-check`, `pnpm lint`, `pnpm build` all green.

**Dependencies:** Tasks 3, 5 + Checkpoint C.

**Files likely touched:** deletes only (+ regenerated route tree).

**Estimated scope:** XS.

---

### Phase 5 — SPEC + ship

#### Task 7: `SPEC.md` update

**Description:** Reflect the v9 architecture.

**Acceptance criteria:**

- [ ] §17 v9 Acceptance Criteria covers: server-side URL resolution in the loader (per-item `getpubthumblink`), `MemoryItem.thumbUrl` (640) + `lightboxUrl` (1025) + videos' `mediaUrl`, lazy download URL via server-fn, client-side blob download, deletion of the `/api/memory/<uuid>` proxy + `memory-route.server.ts`. Cache shape + cron unchanged.
- [ ] §18 v8 → v9 changes summary lists deleted modules + the loader's new responsibility.
- [ ] §7 boundaries:
  - **Always do:** unchanged. Token still server-only. Auth gate still on `beforeLoad`.
  - **Ask first:** unchanged.
  - **Never do:** keep "pCloud token in browser" (still true). Replace "Sign IP-bound URL on server, pass to browser" with: "**Always** mint public-link CDN URLs server-side via `getpubthumblink` / `getpublinkdownload` and embed `https://${hosts[0]}${path}` in the loader response. Never embed the public-link `code` in browser-visible HTML/JSON/loader."
- [ ] §8.4 (or equivalent open-question section) closed with the v9 design; new §8.X records the spike result + the loader latency profile.

**Verification:**

- [ ] Walk every §7 bullet against the v9 codebase. Where stale, edit. Where the diff broke a rule, fix the diff.

**Dependencies:** Tasks 1–6.

**Files likely touched:** `SPEC.md`.

**Estimated scope:** S.

---

#### Task 8: Merge + prod smoke

**Description:** Standard merge.

**Acceptance criteria:**

- [ ] PR description bundles: Phase 0 spike output (incl. final lightbox size), before/after HAR weight, Lighthouse delta on `/`, SPEC §17/§18 diff, list of deleted files.
- [ ] CI green.
- [ ] Reviewer signs off on visual diff (lightbox at 1025) + SPEC §7 update.
- [ ] After merge: smoke `/` on prod. Verify zero `/api/memory/...` traffic.
- [ ] Watch Netlify bandwidth dashboard 24 h — expect proxy traffic to flatline.

**Verification:** repeat Checkpoint C against the prod URL.

**Dependencies:** Tasks 1–7.

**Files likely touched:** none.

**Estimated scope:** XS.

---

## Risks and mitigations

| Risk                                                                                                        | Impact | Mitigation                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getpubthumblink` rejects `1025x1025` (off-grid).                                                           | Med    | Phase 0 verifies and surfaces the closest accepted size; plan + tasks updated to that size before code lands.                                                                                                                                                               |
| Loader latency increases due to 2N+V parallel pCloud calls per page-load.                                   | Med    | Profile in Task 2. Typical day < 20 items, parallel calls ≈ 100–200 ms. If p50 > 500 ms, add per-loader memoization (in-process Map keyed by `code+size`) or short-TTL Blobs cache, or pivot to the folder-publink `getpubthumbslinks` batch path (cache + cron migration). |
| `getpubthumblink` / `getpublinkdownload` URLs go stale during a long lightbox idle (`expires` field, ~6 h). | Low    | Reload re-mints. If frequent enough to matter, refetch on a 4xx in Lightbox (out of scope for v9).                                                                                                                                                                          |
| Browser-side `fetch(cdnUrl).blob()` fails CORS for the download path.                                       | Low    | Phase 0 verifies. Fallback: `<a href={cdnUrl} download>` (may navigate inline). Worst case: keep the proxy for downloads only.                                                                                                                                              |
| One item's resolution fails and crashes the whole loader.                                                   | Low    | `Promise.allSettled` per item; failed items dropped with a single warn. The page is never blocked by a single bad code.                                                                                                                                                     |
| `pcloud.server.ts` instantiating a pCloud client breaks the "loader is cache-only" invariant from v6/v7.    | Low    | Intentional relaxation; documented in SPEC §17. Cache stays the source of metadata; URLs are now resolved on demand.                                                                                                                                                        |
| pCloud rate-limits the loader under burst load.                                                             | Low    | Single-user app, low traffic. If it ever matters, the per-loader memoization above fixes it.                                                                                                                                                                                |

## Open questions

None blocking. Phase 0 closes the only spike-gated assumptions (chiefly: confirm `1025x1025` is accepted; if not, pick the closest grid size).
