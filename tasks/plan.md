# Recuerdea v4 Implementation Plan — 410 fix + cron-warmed cache + repo refactor

## Context

Two motivating problems:

1. **Production 410s (TOP PRIORITY)**: pCloud signs `getfilelink` / `getthumblink` / `getvideolink` URLs with a short TTL (minutes). Today the home loader calls those endpoints during SSR and bakes the URLs into the rendered HTML and into TanStack Router's loader cache. Lazy scrolling, back-button navigation, or any deferred render outlives the URL → the browser hits an expired link and gets HTTP 410.
2. **Scalability + aggressive caching**: with hundreds of memories planned for prod, even the v3 capture-date cache leaves per-visit `listfolder` + per-matched-item URL fetches on the hot path. v4 moves all pCloud chatter to a daily Netlify Scheduled Function and reduces the user visit to Blobs reads only.

Plus several spec-level changes the user just confirmed:

- Branch-per-version workflow (work on `v4`, PRs into `v4`, then one `v4 → main` PR).
- Immutability + functional-style code preference.
- Component filenames in **PascalCase** under a new `src/components/`.
- **UUID indirection in the media URL** so pCloud `fileid` never leaks to the client.
- Cron is the only writer; **no live `listfolder` fallback** in the loader (user pre-populates before prod).
- Stale-entry cleanup is in-scope.

The v3 capture-cache (`src/lib/capture-cache.ts`, `capture-cache.server.ts`) is **replaced** in v4 — value shape and key prefix both change.

**Out of scope for v4** (do not let this plan grow):

- Tagging / captioning / blob-stored user metadata — `SPEC.md §1` non-goal, future work.
- A `pCloud-mirror` byte-streaming proxy. The 302-redirect approach is sufficient and avoids putting Netlify in the bandwidth path.
- Caching pCloud signed URLs anywhere with TTL > 1 request — explicitly forbidden in `SPEC.md §7` (v4).
- Folder-listing throughout the day. Cron is daily; new uploads are visible after the next cron tick (≤ 24 h). User accepts this.
- Any UI redesign. Components move into `src/components/` but the rendered shape is unchanged.

## Prerequisites

### P0: SPEC.md amendments — **needs explicit ack on items 4 and 5 below**

`SPEC.md` was updated mid-session before user feedback. The amendments below land in a single docs commit at the start of v4 (T0.1).

| #   | Section              | Change                                                                                                                                                                             |
| --- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | §4 Project Structure | Component files use **PascalCase** (`Home.tsx`, `MemoryView.tsx`, `AdminDateOverride.tsx`). `lib/` stays kebab-case.                                                               |
| 2   | §4 Project Structure | Move `src/server/refresh-cache.ts` → `netlify/functions/refresh-cache.ts` (Netlify convention). Registered via `netlify.toml [functions."refresh-cache"]` with a `schedule` field. |
| 3   | §4 Project Structure | Rename `capture-cache.ts` → `media-cache.ts` (value shape changes); add `fileid-index.ts` (sidecar `fileid → uuid` for the cron writer).                                           |
| 4   | §4 + §11             | **(needs ack)** Media URLs use a per-file **UUID** (not pCloud `fileid`). `/api/media/:uuid?variant=image\|stream\|poster`. The fileid never leaves the server.                    |
| 5   | §8.5 (open Q)        | **(needs ack)** No on-demand loader fallback. Cron is the only writer. If the snapshot is missing, render an empty state.                                                          |
| 6   | §8.6 (open Q)        | Cron deletes stale per-file entries (UUIDs not in the new snapshot) and their `fileid-index` sidecars.                                                                             |
| 7   | §11 Acceptance       | Update cache-shape bullet: keyed by `media/${uuid}`, sidecar `fileid-index/${fileid}`, snapshot `folder/v1`. Hot path = 1 snapshot read + N per-uuid reads.                        |
| 8   | §8.4 (open Q)        | Variant param is explicit (`?variant=`). Default inferred from cached `kind`.                                                                                                      |

### P1: New top-level dep `@netlify/functions` — **needs explicit ack** (slice C)

For the typed `Handler` signature and the `schedule()` wrapper used by the cron. Goes in `dependencies`. User has pre-acked this in plan-mode review; flagging here so the boundary check stays explicit at the slice C commit.

### P2: `netlify.toml` schedule block — **needs explicit ack** (slice C)

Adding `[functions."refresh-cache"]` with `schedule = "0 4 * * *"` (04:00 UTC daily). User has pre-acked this in plan-mode review; flagging at slice C commit.

## Architecture decisions

### What lives where in v4

```
Browser
   │ GET /
   ▼
Home loader (src/lib/pcloud.ts)
   │  read folder/v1 snapshot
   │  read media/${uuid} for each uuid
   │  filter by today's month/day, sort by year asc
   ▼
MemoryItem[] with relative URLs:  /api/media/${uuid}?variant=image|stream|poster
   │
   ▼
Browser <img>/<video>/<source>
   │ GET /api/media/${uuid}?variant=...
   ▼
API route (src/routes/api/media/$uuid.ts)
   │  read media/${uuid} → { fileid, kind, contenttype, ... }
   │  call pCloud (getthumblink / getfilelink / getvideolink) with content-type as needed
   ▼
302 redirect to a freshly-signed pCloud URL
```

```
Daily 04:00 UTC
   ▼
netlify/functions/refresh-cache.ts (Scheduled Function)
   │  client.listfolder(folderId)
   │  for each media file:
   │     fileid-index/${fileid} → existing uuid OR crypto.randomUUID()
   │     media/${uuid} → fill if missing or hash mismatch
   │  write folder/v1 snapshot
   │  delete media/${uuid} + fileid-index/${fileid} for any uuid no longer in snapshot
```

### Key + value shape

```
media/${uuid}          → { fileid: number, hash: string, kind: 'image'|'video',
                            contenttype: string, name: string, captureDate: string | null }

fileid-index/${fileid} → { uuid: string }

folder/v1              → { refreshedAt: string, uuids: string[] }
```

UUIDs are `crypto.randomUUID()` (v4, Node-built-in, no dep). Stable per file across cron runs (the `fileid-index` lookup gives the cron the existing uuid). Hash mismatch → cron overwrites the `media/${uuid}` value but keeps the same uuid (so the rendered HTML still references it).

### Variant resolution

`/api/media/:uuid?variant=image|stream|poster`. Cron-cached `kind` determines default:

| kind  | default variant     | pCloud endpoint            | content-type arg                 |
| ----- | ------------------- | -------------------------- | -------------------------------- |
| image | `image`             | `getthumblink` (2048x1024) | n/a                              |
| video | `stream`            | `getfilelink`              | original `contenttype` (MP4/MOV) |
| video | `poster` (explicit) | `getthumblink` (2048x1024) | n/a                              |

### Local-dev fallback (carried forward from v3)

`@netlify/blobs` requires a Netlify runtime context. Plain `pnpm dev` has none → the Blobs factories memoize a no-op store and `console.warn` once. v4 keeps this pattern for `media-cache.server.ts`, `fileid-index.server.ts`, and `folder-cache.server.ts`. Loader behavior under no-op store: snapshot lookup returns `undefined` → home renders empty state. Acceptable for `pnpm dev`; full caching only required under `netlify dev` + prod.

## Dependency graph

```
P0: SPEC amendments (T0.1)
P0: Create v4 branch (T0.2)
    │
    ▼
SLICE A — proxy /api/media (1st draft: 302; corrected to byte-stream in A.5)
  A1: spike — verify TanStack Start API route convention works                  ✅ shipped
  A2: media-proxy.server.ts (pure helper)                                       ✅ shipped
  A3: api/media/$fileid.ts (302 redirect handler — v1 design, kept for now)     ✅ shipped
  A4: pcloud.server.ts — MemoryItem URLs become /api/media/...; loader stops calling getfilelink/getthumblink for matched items   ✅ shipped
  → DEPLOY-PREVIEW VERIFICATION: 302 redirects don't work — pCloud signed URLs are IP-bound. Need to switch to byte-streaming.

SLICE A.5 — byte-stream the proxy (REAL 410 fix)
  A.5/P1: SPEC + plan amendments (relax §7 "never byte-stream", note IP-binding constraint)
  A.5/P2: convert api/media/$fileid.ts from 302 to streaming response (forward Range header, set Cache-Control)
  → CHECKPOINT A: green tests + e2e + PR [v4-A] deploy preview verifies images and videos render across IPs (no "another IP address" errors after lazy scroll / 30-min revisit)
    │
    ▼
SLICE B — UUID indirection + expanded cache
  B1: media-cache.ts (pure)
  B2: media-cache.server.ts (Blobs)
  B3: fileid-index.ts (pure)
  B4: fileid-index.server.ts (Blobs)
  B5: pcloud.server.ts — replace v3 capture-cache wiring with media-cache + fileid-index; loader mints/looks-up uuids and writes media-cache lazily; MemoryItem carries uuid, not fileid
  B6: api/media/$fileid.ts → $uuid.ts — read media-cache by uuid → fileid → pCloud call
  B7: routes/index.tsx — React keys switch to uuid
  B8: delete v3 capture-cache files
  → CHECKPOINT B: green + e2e + PR [v4-B] → v4 + verify no fileid in HTML
    │
    ▼
SLICE C — Cron + folder snapshot + stale cleanup
  C1: ack @netlify/functions dep + add to package.json
  C2: ack netlify.toml schedule block + add it
  C3: folder-cache.ts (pure)
  C4: folder-cache.server.ts (Blobs)
  C5: refresh-cache handler + test (in-memory fakes)
  C6: pcloud.ts loader — read snapshot + per-uuid metadata only; no live listfolder
  C7: pcloud.server.ts — refactor populate path used by the cron; remove from loader
  → CHECKPOINT C: green + cron e2e via Netlify "Run now" + Blobs panel inspection + smoke
    │
    ▼
SLICE D — Refactor index.tsx (nice-to-have)
  D1: lib/date-utils.ts + test
  D2: components/MemoryView.tsx
  D3: components/AdminDateOverride.tsx
  D4: components/Home.tsx
  D5: routes/index.tsx → wiring only (~40 lines)
  → CHECKPOINT D: green + visual smoke
    │
    ▼
FINAL: PR v4 → main, smoke deploy preview, merge
```

## Tasks

### Phase 0 — SPEC + branch setup

#### T0.1 — Apply SPEC.md amendments + replace tasks/plan.md & tasks/todo.md

**Files**: `SPEC.md`, `tasks/plan.md` (this file), `tasks/todo.md`.

**Acceptance**:

- All 8 amendments from the table above land in `SPEC.md`.
- `tasks/plan.md` and `tasks/todo.md` reflect v4 (this plan + checklist).
- `pnpm format:check` passes.

**Verification**: a human read of the SPEC delta confirms it matches the table; `pnpm format:check` clean.

**Approvals**: items 4 and 5 from the amendments table need explicit ack (UUID indirection + no-fallback). Pre-acked in plan-mode review; cite at commit time.

#### T0.2 — Create `v4` branch

**Acceptance**: branch `v4` exists locally and on `origin`, branched from current `main` (`8d775c5`).

**Verification**: `git branch --show-current` returns `v4`; `git log --oneline -1` matches main's HEAD.

---

### Slice A — 410 fix (smallest possible)

#### A1 — Spike: confirm TanStack Start API route convention

**Files**: NEW `src/routes/api/ping.ts` (deleted at end of slice A).

**Acceptance**:

- `pnpm netlify dev`, then `curl -i http://localhost:8888/api/ping` returns `HTTP/1.1 302` with `Location: /login`.
- TanStack Start's API route file convention is confirmed for this project.

**Verification**: curl output as above. If it doesn't work, **stop and re-plan** — fall back to a Netlify Function with a `netlify.toml` redirect from `/api/media/*`.

#### A2 — `src/lib/media-proxy.server.ts` + test

**Files**: NEW `src/lib/media-proxy.server.ts`, NEW `src/lib/media-proxy.server.test.ts`.

**API**:

```ts
export type MediaVariant = 'image' | 'stream' | 'poster'

export async function resolveMediaUrl(
	fileid: number,
	variant: MediaVariant,
	contenttype: string,
): Promise<string>
```

- `image` / `poster` → `client.call('getthumblink', { fileid, size: '2048x1024' })`
- `stream` → `client.getfilelink(fileid)`

**Acceptance**:

- Unit test with a mocked pcloud-kit client: each variant calls the right endpoint with the right args.
- Returns the absolute pCloud URL string.

**Verification**: `pnpm test src/lib/media-proxy.server.test.ts` green.

#### A3 — `src/routes/api/media/$fileid.ts`

**Files**: NEW `src/routes/api/media/$fileid.ts`.

**Behavior**:

- GET handler. Parses `fileid` from path (validate it's a positive integer; 400 otherwise).
- Parses `?variant=` (default `image`; validate against the 3 allowed values; 400 otherwise).
- For default variant: calls `client.stat(fileid)` to get `contenttype` (so we know if it's video → `stream` instead of `image`). One pCloud call. Acceptable in slice A; slice B replaces this with a cache lookup.
- Calls `resolveMediaUrl(fileid, variant, contenttype)`, returns `Response.redirect(url, 302)`. **Note**: this 302 design is replaced in A.5 with a byte-stream proxy because pCloud signed URLs are IP-bound and the browser can't follow the redirect from a different IP. A3 ships as-is for atomicity; A.5 swaps the response body without touching `resolveMediaUrl`.
- Errors (file not found, pCloud failure): 502 with a short body.

**Acceptance**:

- `curl -i http://localhost:8888/api/media/12345?variant=image` returns 302 to a pCloud URL.
- `curl -i http://localhost:8888/api/media/abc` returns 400.
- `curl -i http://localhost:8888/api/media/12345?variant=bogus` returns 400.

**Verification**: manual curl tests under `pnpm netlify dev`.

#### A4 — Modify `src/lib/pcloud.server.ts` — `MemoryItem` URLs become relative

**Files**: MODIFY `src/lib/pcloud.server.ts`, MODIFY `src/lib/pcloud.server.test.ts`.

**Changes**:

- `MemoryItem` URL fields (`url`, `posterUrl`) become `/api/media/${fileid}?variant=...` strings. Keep `kind`, `mimeType`, `name`, `captureDate` as before.
- `buildMemoryItem` no longer calls `fetchThumbnailUrl` / `fetchVideoStreamUrl`. It just builds the relative URLs deterministically from `fileid` + `kind`. The function becomes synchronous (no `Promise.all` needed inside).
- `fetchThumbnailUrl` / `fetchVideoStreamUrl` are deleted (their work moved to `media-proxy.server.ts`).
- v3 capture-cache wiring stays untouched in slice A.

**Test changes**:

- Remove all `getfilelink` / `getthumblink` mocks from the matched-item tests.
- Assert `MemoryItem.url` is `'/api/media/123?variant=image'` (or `?variant=stream`) and (for videos) `posterUrl` is `'/api/media/123?variant=poster'`.
- Capture-cache tests remain unchanged.

**Acceptance**:

- All existing pcloud.server tests pass with the new URL assertions.
- Type-check, lint, format clean.

**Verification**: `pnpm test src/lib/pcloud.server.test.ts` + full suite green.

#### A.5/P1 — SPEC + plan amendments for byte-stream pivot

**Files**: `SPEC.md`, `tasks/plan.md`, `tasks/todo.md`. Single docs commit.

**Acceptance**:

- §7 "always do" updated to mention **byte-streaming** (not 302 redirects) for `/api/media/:uuid?variant=...`. The IP-binding rationale is in the bullet.
- §7 "never do" "Cache pCloud signed URLs" rule reworded — never **serialize** signed URLs outside one request; in-handler usage by `fetch()` is allowed.
- §11 "Hot path" gains a second bullet describing the route handler's per-request work (cache read → pCloud sign → fetch → pipe). `Cache-Control` strategy noted.
- §12 v3→v4 summary updated to describe the IP-mismatch fix as the real cause of v3-era "410s".
- This file (`tasks/plan.md`) gains the A.5 entries; `tasks/todo.md` un-checks the original Checkpoint A entries (the 410 verification didn't happen) and adds A.5/P1–P4.

**Approvals**: byte-streaming through Netlify is now an explicit design choice — pre-acked by the user in plan-mode review. Cite at commit time.

**Verification**: `pnpm format:check` clean. Spec read-through confirms every "302" reference now mentions byte-streaming or is gone.

#### A.5/P2 — Convert `/api/media/:fileid` route to streaming proxy

**Files**: MODIFY `src/routes/api/media/$fileid.ts`. NEW (or extend existing) test for the streaming path.

**Behavior change**:

- Validation (fileid + variant) and stat-based default-variant logic unchanged.
- After resolving the signed pCloud URL via `resolveMediaUrl`, call `fetch(url, { headers: { Range: request.headers.get('range') ?? '' } })` to fetch the bytes. Forward the browser's `Range` header so video seek works.
- Return `new Response(res.body, { status: res.status, headers })` where `headers` includes:
  - `content-type` from the cached `contenttype` (or pass through from upstream)
  - `accept-ranges: bytes`
  - `content-length` and `content-range` passed through from the upstream response
  - `cache-control`: `public, max-age=86400, immutable` for `image`/`poster`; `public, max-age=600` for `stream`
- 5xx from pCloud surface as 502 with a short message (existing pattern); IP-bound URL failures shouldn't happen any more because we're consuming the URL from the same IP that signed it.

**Test**:

- Mock `globalThis.fetch` (vitest `vi.spyOn(globalThis, 'fetch')`) to return a fake `Response` with a known body and headers. Assert:
  1. The route returns a streaming response with the upstream body.
  2. Headers include the variant-appropriate `cache-control` and `accept-ranges: bytes`.
  3. Browser `Range` header is forwarded to the upstream `fetch`.
  4. Upstream 206 responses pass through `content-range` and status.
- Existing validation tests (`abc` → 400, `?variant=bogus` → 400) stay green; manual curl smoke confirms locally.

**Acceptance**:

- All tests green, `type-check`, `lint`, `format:check`, `build` clean.
- Manual: `curl -I http://localhost:3000/api/media/<good-fileid>?variant=image` returns `200 OK` with image bytes (`-D headers` shows `content-type: image/...`, `cache-control: ...`).
- Manual on deploy preview (after push): same curl returns 200 + bytes, AND the home page renders images/video for a 30-min idle session without IP-mismatch errors.

**Verification**: pnpm test passing + manual deploy-preview smoke (user-driven).

#### CHECKPOINT A — Green + PR + IP-mismatch verification

- `pnpm test` (full suite)
- `pnpm type-check`
- `pnpm lint`
- `pnpm format:check`
- `pnpm netlify dev` — sign in, verify home renders all media; admin date picker works; video plays; empty state works for an off-day.
- Open PR `[v4]` (or use the existing PR #4) → `main`. Push of A.5 commits updates the deploy preview.
- On the deploy preview: hard reload home, scroll lazily after 5 min, leave the tab open and revisit after 30 min — **no "another IP address" errors, no 410s** in the network tab. Images render, videos play, video seek works (range request).
- Mark Checkpoint A complete only after deploy-preview verification (the local-only checks pass even with the 302-redirect bug because they all originate from one IP).

---

### Slice B — UUID indirection + expanded cache shape

#### B1 — `src/lib/media-cache.ts` + test

**Files**: NEW `src/lib/media-cache.ts`, NEW `src/lib/media-cache.test.ts`.

**API**:

```ts
export type CachedFileMeta = {
	fileid: number
	hash: string
	kind: 'image' | 'video'
	contenttype: string
	name: string
	captureDate: string | null
}

export type MediaCacheStore = {
	get(uuid: string): Promise<CachedFileMeta | undefined>
	set(uuid: string, value: CachedFileMeta): Promise<void>
	delete(uuid: string): Promise<void>
	list(): Promise<readonly string[]> // uuids
}

export type MediaCache = {
	lookup(uuid: string): Promise<CachedFileMeta | undefined>
	remember(uuid: string, value: CachedFileMeta): Promise<void>
	forget(uuid: string): Promise<void>
	listUuids(): Promise<readonly string[]>
}

export function createMediaCache(store: MediaCacheStore): MediaCache
```

Pure module. Tests use a `Map`-backed fake store.

**Acceptance**:

- All four operations round-trip correctly.
- Negative `captureDate` (`null`) round-trips.
- `listUuids()` returns the keys in the store (order not asserted).

**Verification**: `pnpm test src/lib/media-cache.test.ts` green.

#### B2 — `src/lib/media-cache.server.ts` + test

**Files**: NEW `src/lib/media-cache.server.ts`, NEW `src/lib/media-cache.server.test.ts`.

**API**: `getMediaCacheStore(): MediaCacheStore`. Memoized factory. Live store under key prefix `media/`. Same try/catch + no-op fallback pattern as v3 `getCaptureCacheStore`.

**Acceptance**:

- Memoization (same instance on repeated calls).
- No-op branch exercised: forced `getStore` failure → silent no-op + `console.warn` once.

**Verification**: `pnpm test src/lib/media-cache.server.test.ts` green.

#### B3 — `src/lib/fileid-index.ts` + test

**Files**: NEW `src/lib/fileid-index.ts`, NEW `src/lib/fileid-index.test.ts`.

**API**:

```ts
export type FileidIndexStore = {
	get(fileid: number): Promise<{ uuid: string } | undefined>
	set(fileid: number, value: { uuid: string }): Promise<void>
	delete(fileid: number): Promise<void>
}

export type FileidIndex = {
	lookup(fileid: number): Promise<string | undefined>
	remember(fileid: number, uuid: string): Promise<void>
	forget(fileid: number): Promise<void>
}

export function createFileidIndex(store: FileidIndexStore): FileidIndex
```

**Acceptance**: round-trip + delete via fake store.

**Verification**: `pnpm test src/lib/fileid-index.test.ts` green.

#### B4 — `src/lib/fileid-index.server.ts` + test

**Files**: NEW `src/lib/fileid-index.server.ts`, NEW `src/lib/fileid-index.server.test.ts`.

**API**: `getFileidIndexStore(): FileidIndexStore`. Same memoization + no-op fallback pattern. Key prefix `fileid-index/`.

**Acceptance / Verification**: same shape as B2.

#### B5 — Modify `src/lib/pcloud.server.ts` — replace capture-cache with media-cache + fileid-index

**Files**: MODIFY `src/lib/pcloud.server.ts`, MODIFY `src/lib/pcloud.server.test.ts`.

**New flow inside `fetchTodayMemories`**:

```
for each media file (parallel):
  uuid = fileidIndex.lookup(fileid) ?? crypto.randomUUID()
  meta = mediaCache.lookup(uuid)
  if !meta or meta.hash !== file.hash:
    captureDate = await safeExtractCaptureDate(client, file)  // pure now (no cache arg)
    meta = { fileid, hash: file.hash, kind, contenttype, name, captureDate: captureDate?.toISOString() ?? null }
    await mediaCache.remember(uuid, meta)
    await fileidIndex.remember(fileid, uuid)
  if meta.captureDate matches today's day:
    push MemoryItem with uuid + relative URLs
```

`MemoryItem` shape changes:

```ts
type MemoryItem =
	| { kind: 'image'; uuid: string; name: string; captureDate: string; url: string }
	| {
			kind: 'video'
			uuid: string
			mimeType: string
			name: string
			captureDate: string
			url: string
			posterUrl: string
	  }
```

URLs are still `/api/media/${uuid}?variant=...` (uuid now, not fileid).

**Test changes**:

- New tests: hit (no extractor calls, no `mediaCache.set`), miss (extractor + `mediaCache.set` + `fileidIndex.set` + uuid present in MemoryItem), hash mismatch (extractor + overwrite), existing-uuid reuse (no `fileidIndex.set` if lookup returned a value).
- Inject fake `MediaCacheStore` + `FileidIndexStore` via `vi.mock` of the `.server` modules.

**Acceptance**:

- `MemoryItem` carries `uuid`. No `fileid` field on it.
- All new + existing tests pass.

**Verification**: full suite green.

#### B6 — Rename `src/routes/api/media/$fileid.ts` → `$uuid.ts`

**Files**: RENAME + MODIFY route file.

**Behavior change**:

- Reads `mediaCache.lookup(uuid)`. 404 if not found.
- Resolves variant default from cached `kind` (image → `image`, video → `stream`).
- Calls `resolveMediaUrl(meta.fileid, variant, meta.contenttype)`.
- 302.

**Acceptance**:

- `curl -i http://localhost:8888/api/media/<uuid>?variant=image` → 302.
- `curl -i http://localhost:8888/api/media/<random-uuid>` → 404.
- The route never makes `client.stat` calls — only `media-cache.lookup` + the variant-specific pCloud endpoint.

**Verification**: manual curl + grep confirms `client.stat` is gone from the route.

#### B7 — `src/routes/index.tsx` — React keys use `uuid`

**Files**: MODIFY `src/routes/index.tsx`.

- `memoryKey(item)` returns `item.uuid`.

**Acceptance**: route renders; React no longer uses the composite `${captureDate}-${name}` key.

**Verification**: `pnpm test` green; manual smoke under `netlify dev`.

#### B8 — Delete v3 capture-cache files

**Files**: DELETE `src/lib/capture-cache.ts`, `src/lib/capture-cache.test.ts`, `src/lib/capture-cache.server.ts`, `src/lib/capture-cache.server.test.ts`.

**Acceptance**: nothing imports them; type-check + tests still green.

**Verification**: `rg 'capture-cache' src/` returns no results; full suite green.

#### CHECKPOINT B — Green + PR + no-fileid verification

- Standard gates (test, type-check, lint, format).
- `pnpm netlify dev` — view-source on the home page; **grep the HTML for the pCloud `fileid` of a known file → must not appear.** Only uuids + `/api/media/<uuid>` references should be present.
- Open PR `[v4-B] UUID indirection + expanded cache shape` targeting `v4`.
- Smoke deploy preview (no fileid leak; media still works).
- Merge into `v4`.

---

### Slice C — Cron + folder snapshot + stale cleanup

#### C1 — Add `@netlify/functions` dependency

**Files**: MODIFY `package.json`, `pnpm-lock.yaml`.

**Approval**: P1 above. Cite ack at commit.

**Acceptance**: `@netlify/functions` appears under `dependencies`. `pnpm install` runs clean. `pnpm build` does NOT include it in the client bundle (verify with `pnpm build` then a quick grep / size check on `dist/client/`).

**Verification**: `pnpm install` + `pnpm build`.

#### C2 — Add `[functions."refresh-cache"]` block to `netlify.toml`

**Files**: MODIFY `netlify.toml`.

**Approval**: P2 above. Cite ack at commit.

**Block**:

```toml
[functions."refresh-cache"]
schedule = "0 4 * * *"
```

**Acceptance**: `pnpm netlify dev` boots without complaining about the schedule. Netlify dashboard (post-deploy) lists the function under Scheduled Functions.

**Verification**: `pnpm netlify dev` boot logs; deploy preview dashboard inspection.

#### C3 — `src/lib/folder-cache.ts` + test

**Files**: NEW `src/lib/folder-cache.ts`, NEW `src/lib/folder-cache.test.ts`.

**API**:

```ts
export type FolderSnapshot = { refreshedAt: string; uuids: readonly string[] }

export type FolderCacheStore = {
	get(): Promise<FolderSnapshot | undefined>
	set(value: FolderSnapshot): Promise<void>
}

export type FolderCache = {
	lookup(): Promise<FolderSnapshot | undefined>
	remember(value: FolderSnapshot): Promise<void>
}

export function createFolderCache(store: FolderCacheStore): FolderCache
```

Pure module. Tests round-trip with a fake store.

**Acceptance / Verification**: standard.

#### C4 — `src/lib/folder-cache.server.ts` + test

**Files**: NEW `src/lib/folder-cache.server.ts`, NEW `src/lib/folder-cache.server.test.ts`.

**API**: `getFolderCacheStore(): FolderCacheStore`. Single key `folder/v1`. Same memoization + no-op fallback.

**Acceptance / Verification**: standard.

#### C5 — `netlify/functions/refresh-cache.ts` + test

**Files**: NEW `netlify/functions/refresh-cache.ts`, NEW `netlify/functions/refresh-cache.test.ts`.

**Handler outline** (using `@netlify/functions` `schedule()` wrapper):

```ts
export const handler = schedule('0 4 * * *', async () => {
  const client = createClient(...)
  const mediaCache = createMediaCache(getMediaCacheStore())
  const fileidIndex = createFileidIndex(getFileidIndexStore())
  const folderCache = createFolderCache(getFolderCacheStore())

  const files = await listMediaFiles(client, folderId)
  const uuids: string[] = []

  for (const file of files) {  // sequential or chunked Promise.all
    const existingUuid = await fileidIndex.lookup(file.fileid)
    const uuid = existingUuid ?? crypto.randomUUID()
    const cached = await mediaCache.lookup(uuid)
    if (!cached || cached.hash !== file.hash) {
      const captureDate = await safeExtractCaptureDate(client, file)
      await mediaCache.remember(uuid, {
        fileid: file.fileid,
        hash: file.hash,
        kind: file.contenttype.startsWith('video/') ? 'video' : 'image',
        contenttype: file.contenttype,
        name: file.name,
        captureDate: captureDate?.toISOString() ?? null,
      })
      if (!existingUuid) await fileidIndex.remember(file.fileid, uuid)
    }
    uuids.push(uuid)
  }

  await folderCache.remember({ refreshedAt: new Date().toISOString(), uuids })

  // Stale cleanup
  const aliveSet = new Set(uuids)
  const allCachedUuids = await mediaCache.listUuids()
  for (const uuid of allCachedUuids) {
    if (!aliveSet.has(uuid)) {
      const meta = await mediaCache.lookup(uuid)
      if (meta) await fileidIndex.forget(meta.fileid)
      await mediaCache.forget(uuid)
    }
  }

  console.log(`[refresh-cache] scanned=${files.length} alive=${uuids.length} removed=${allCachedUuids.length - aliveSet.size}`)
  return { statusCode: 200 }
})
```

(Code shape only; implementation is part of this task. Concurrency cap with chunked `Promise.all` if rate-limit issues surface — defer until proven necessary.)

**Test**: in-memory fakes for all three stores + a fake pcloud-kit client. Asserts:

- New files added (uuid minted, mediaCache + fileidIndex written).
- Existing-uuid reuse (no new uuid minted).
- Hash mismatch overwrites mediaCache, keeps uuid.
- Removed file (in cache, not in listfolder result) → both stores cleared.
- Snapshot is written with the correct uuid set.

**Acceptance**: all test cases pass.

**Verification**: `pnpm test netlify/functions/refresh-cache.test.ts` green.

#### C6 — Modify `src/lib/pcloud.ts` — loader reads from snapshot only

**Files**: MODIFY `src/lib/pcloud.ts`.

**New behavior**:

- `getTodayMemories` no longer calls `fetchTodayMemories`. Instead it imports a new `loadTodayMemoriesFromCache(today)` from `./pcloud.server`.
- That function: reads `folderCache.lookup()` → if missing, returns `[]` and `console.warn('[pcloud] folder snapshot missing — cron has not run yet')`. Otherwise reads each `media/${uuid}` in parallel, filters by today's day, sorts, returns `MemoryItem[]`.
- **No `client.listfolder` call anywhere on this path.** No pCloud API calls at all.

**Acceptance**: loader produces the same MemoryItem shape as before. New unit test in `pcloud.server.test.ts` exercises the cached-loader path with fake stores: snapshot present → memories returned; snapshot missing → empty array + warn.

**Verification**: full suite green; `grep -r 'listfolder' src/lib/pcloud.ts` returns nothing.

#### C7 — Refactor `src/lib/pcloud.server.ts` — pure populate path

**Files**: MODIFY `src/lib/pcloud.server.ts`.

**Changes**:

- Extract the v3-style "fill cache for one file" logic into `populateMediaCacheForFile(client, file, mediaCache, fileidIndex): Promise<{ uuid, meta }>`. Used by both the cron handler (slice C5) and the new `loadTodayMemoriesFromCache` is **NOT** wired here — loader doesn't populate.
- `fetchTodayMemories` is deleted. Its testable bits live in `populateMediaCacheForFile` (covered by the cron's tests) and in `loadTodayMemoriesFromCache` (covered by the new loader test in C6).
- The two `console.log('[memories] ...')` lines are already gone (v3 cleanup).

**Acceptance**: `pnpm test src/lib/pcloud.server.test.ts` rewritten + green; type-check + lint clean.

**Verification**: full suite green.

#### CHECKPOINT C — Green + cron e2e + smoke

- Standard gates.
- Open PR `[v4-C] Cron-warmed cache + stale cleanup` targeting `v4`.
- On the deploy preview:
  1. **Manually trigger the cron** via the Netlify dashboard ("Run now" on the scheduled function).
  2. Inspect Netlify Blobs panel: `folder/v1`, multiple `media/<uuid>`, multiple `fileid-index/<fileid>` entries.
  3. Visit `/` — verify network tab shows **zero** requests to pCloud hosts (`*.pcloud.com`); only `/api/media/<uuid>` requests.
  4. Verify admin date override + empty state still work.
  5. (Optional rename test) Rename a file in pCloud, wait for next cron run (or trigger manually), confirm cache update.
- Merge into `v4`.

**Pre-prod note**: before the eventual `v4 → main` merge, the prod cron must run at least once (or be triggered manually) so the snapshot exists in prod Blobs. Otherwise the prod home page renders empty until the next 04:00 UTC tick.

---

### Slice D — Refactor `routes/index.tsx` (nice-to-have)

#### D1 — `src/lib/date-utils.ts` + test

**Files**: NEW `src/lib/date-utils.ts`, NEW `src/lib/date-utils.test.ts`.

**Exports**: `parseSearchDate`, `isoToOverride`, `todayIso`, `formatCaptureDate` (functions lifted from `routes/index.tsx` verbatim — pure, no side-effects).

**Acceptance**: behavior matches the originals; unit tests cover each.

**Verification**: `pnpm test src/lib/date-utils.test.ts` green.

#### D2 — `src/components/MemoryView.tsx`

**Files**: NEW `src/components/MemoryView.tsx`.

**Exports**: `<MemoryView item={...} />`. Renders image or video block + capture date label.

**Acceptance**: component lifted verbatim from `routes/index.tsx`.

**Verification**: rendered HTML matches before/after under `netlify dev`.

#### D3 — `src/components/AdminDateOverride.tsx`

**Files**: NEW `src/components/AdminDateOverride.tsx`.

**Exports**: `<AdminDateOverride activeDate={...} />`. Receives the navigate function via a prop or uses a hook to be re-injected from the route (TBD during implementation — `Route.useNavigate` won't resolve outside the route file unless the import path is right).

**Note**: navigate dependency may force a small adjustment (pass `onSelectDate: (iso: string | null) => void` as a prop and let the route wire it up). Defer the exact API to implementation time.

**Acceptance**: component renders; date selection still navigates correctly.

**Verification**: e2e under `netlify dev`.

#### D4 — `src/components/Home.tsx`

**Files**: NEW `src/components/Home.tsx`.

**Props**:

```ts
type Props = {
	user: { email?: string; role?: string; roles?: readonly string[] }
	memories: readonly MemoryItem[]
	activeDate: string | undefined
	onLogout: () => void
	onSelectDate?: (iso: string | null) => void
}
```

**Acceptance**: pure presentational component; no router imports.

**Verification**: rendered output matches.

#### D5 — Modify `src/routes/index.tsx` — wiring only

**Files**: MODIFY `src/routes/index.tsx`.

**Target**: route definition (validateSearch, beforeLoad, loaderDeps, loader, component) plus a thin component that pulls loader data + identity context and forwards to `<Home>`. Aim ≤ 40 lines.

**Acceptance**:

- Route file ≤ ~40 lines.
- Home page renders identically.
- Type-check, lint, format clean.

**Verification**: `wc -l src/routes/index.tsx` + visual smoke.

#### CHECKPOINT D — Green + PR + visual smoke

- Standard gates.
- Open PR `[v4-D] Refactor home route into components/` targeting `v4`.
- Smoke deploy preview: home looks identical to slice C.
- Merge into `v4`.

---

### Final — `v4 → main`

- Open PR `v4 → main` (no slice tag).
- Smoke deploy preview end-to-end one more time.
- **Pre-prod**: trigger the prod cron manually so the snapshot exists in prod Blobs the moment the merge lands.
- Merge.
- Post-merge smoke on prod.

## Risks and mitigations

| Risk                                                                               | Impact                 | Mitigation                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TanStack Start API route convention not supported in `@tanstack/react-start@1.167` | High — slice A blocked | A1 spike; fallback to `netlify/functions/media.ts` + `netlify.toml` redirect.                                                                                                                                                                             |
| Cron fails silently in prod → empty home                                           | High                   | C6 logs a warn when snapshot missing; pre-prod manual cron run; check Netlify scheduled-function logs after first 24 h.                                                                                                                                   |
| pCloud `getfilelink` rate-limit during cron's first run on a large folder          | Medium                 | Cron only fills new / hash-changed files. If proven flaky, chunk extractor calls (8-at-a-time `Promise.all`).                                                                                                                                             |
| UUID collision                                                                     | Negligible             | `crypto.randomUUID()` v4 — collision probability irrelevant at this scale.                                                                                                                                                                                |
| Stale cleanup deletes a uuid the loader is mid-render with                         | Low                    | Loader reads the snapshot first; snapshot already excludes deleted uuids.                                                                                                                                                                                 |
| `@netlify/functions` import leaks into the client bundle                           | Low                    | Only imported from `netlify/functions/refresh-cache.ts` (Netlify-bundled, not Vite). Verify with `pnpm build`.                                                                                                                                            |
| Spike in Netlify Blobs read count on the hot path (N reads per visit)              | Low                    | N = files in the folder, not N = matched-day files. For 1000 files: 1000 Blob reads per `/` visit. Eventual-consistency reads are cheap and parallel; acceptable. If it ever bites, store the per-uuid metadata inside the snapshot itself (denormalize). |

## File touch list

| File                                                      | Slice   | Action                                    |
| --------------------------------------------------------- | ------- | ----------------------------------------- |
| `SPEC.md`                                                 | P0      | MODIFY (8 amendments)                     |
| `tasks/plan.md`                                           | P0      | REPLACE                                   |
| `tasks/todo.md`                                           | P0      | REPLACE                                   |
| `src/routes/api/ping.ts`                                  | A       | NEW (spike) → DELETE                      |
| `src/routes/api/media/$fileid.ts`                         | A       | NEW                                       |
| `src/lib/media-proxy.server.ts` (+ test)                  | A       | NEW                                       |
| `src/lib/pcloud.server.ts`                                | A, B, C | MODIFY                                    |
| `src/lib/pcloud.server.test.ts`                           | A, B, C | MODIFY                                    |
| `src/lib/pcloud.ts`                                       | C       | MODIFY                                    |
| `src/lib/capture-cache.ts` (+ tests, server, server-test) | B       | DELETE                                    |
| `src/lib/media-cache.ts` (+ test)                         | B       | NEW                                       |
| `src/lib/media-cache.server.ts` (+ test)                  | B       | NEW                                       |
| `src/lib/fileid-index.ts` (+ test)                        | B       | NEW                                       |
| `src/lib/fileid-index.server.ts` (+ test)                 | B       | NEW                                       |
| `src/routes/api/media/$fileid.ts` → `$uuid.ts`            | B       | RENAME + MODIFY                           |
| `src/routes/index.tsx`                                    | B, D    | MODIFY                                    |
| `src/lib/folder-cache.ts` (+ test)                        | C       | NEW                                       |
| `src/lib/folder-cache.server.ts` (+ test)                 | C       | NEW                                       |
| `netlify/functions/refresh-cache.ts` (+ test)             | C       | NEW                                       |
| `netlify.toml`                                            | C       | MODIFY (schedule block — ASK FIRST)       |
| `package.json` / `pnpm-lock.yaml`                         | C       | MODIFY (`@netlify/functions` — ASK FIRST) |
| `src/components/MemoryView.tsx`                           | D       | NEW                                       |
| `src/components/AdminDateOverride.tsx`                    | D       | NEW                                       |
| `src/components/Home.tsx`                                 | D       | NEW                                       |
| `src/lib/date-utils.ts` (+ test)                          | D       | NEW                                       |

## Out of scope (do not touch)

- `oxlint.config.ts`, `oxfmt.config.ts`, `tsconfig.json`, `vite.config.ts`, `.github/workflows/ci.yml` — `SPEC.md §7` "ask first."
- The `__root.tsx` and `login.tsx` routes.
- `src/lib/auth.ts`, `src/lib/auth.server.ts`, `src/lib/identity-context.tsx`, `src/lib/navigation.ts`.
- pCloud byte-streaming proxy. v4 stays at 302-redirect.
- Any change to v2 acceptance criteria (`SPEC.md §2`).
- Tagging / captioning / metadata-mutation UI.

## Open questions

None blocking. Items 4 and 5 of the SPEC amendments table need explicit ack at commit T0.1; both are pre-acked in plan-mode review. P1 (`@netlify/functions`) and P2 (netlify.toml schedule) are pre-acked for slice C.
