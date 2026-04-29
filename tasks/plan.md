# Recuerdea v4 Implementation Plan — UUID indirection + cron-warmed public links + 302 redirects

## Status before this revision

The `v4` branch currently contains:

- `4e3c0fa` Byte-stream `/api/media` proxy (works, shipped, IP-binding fix verified on deploy preview).
- `cbfb98f` SPEC + tasks docs flipped to "browser-side signing" — now incorrect.
- `c1af573` Loader returns `{ items, pcloudToken }`; browser uses `pcloud-kit` directly.
- `47b0a4f` Deleted `/api/media` and `media-proxy.server.ts`.

Browser-side signing fails: pCloud rejects `getfilelink` / `getthumblink` calls from browser origins with code `7010 "Invalid link referer"`. Verified on the HTTPS deploy preview, so it's not a localhost issue — it's pCloud's API gating those methods to server-to-server callers. The pivot is unsalvageable as designed.

## Curl-verified facts (2026-04-29)

User ran the public-link verification curls; results inform the design below.

- ✅ **`getfilepublink` is idempotent**: two calls for the same fileid return identical `{ code, linkid }`. Cron logic doesn't need a `listpublinks` dedup pass.
- ✅ **`getpubthumb` directly serves image bytes**: `https://eapi.pcloud.com/getpubthumb?code=XYZ&size=2048x1024` returns `200 + Content-Type: image/...`. Image and poster variants can 302 straight to this URL.
- ⚠️ **`getpublinkdownload` returns metadata, not bytes**: the API call returned `200` to a Range request — meaning the response was JSON `{ hosts, path }` (Range was ignored because there's nothing to range against). The actual file URL is `https://${hosts[0]}${path}` (a pCloud CDN host like `e1.pcloud.com`), which is what supports Range. So the stream variant route handler must call `getpublinkdownload` server-side, then 302 to the derived CDN URL.
- ✅ **API server is `eapi.pcloud.com`**, not `api.pcloud.com`. User has a European pCloud account; `api.pcloud.com` is the US server. pcloud-kit's default already matches (`apiServer ?? "eapi.pcloud.com"`).
- ✅ **Public-link traffic quota**: premium plan, plenty of headroom. No `Cache-Control` gymnastics required.

## The new design

Use pCloud **public links** instead. The cron creates one permanent public link per file (`getfilepublink`) and caches the resulting `code`. Every authenticated request to `/api/memory/<uuid>?variant=...` is auth-gated and **302-redirects** the browser to a stable, world-readable, non-IP-bound URL like `https://eapi.pcloud.com/getpubthumb?code=XYZ&size=2048x1024`. The pCloud token never leaves the server. UUID indirection keeps `fileid` and `code` server-only too.

Why this works where browser-signing didn't:

1. Public links are not Referer-gated (designed for embedding).
2. Public links are not IP-bound (anyone with the URL can fetch).
3. Public links are persistent, so the URL is content-stable and the browser can cache the bytes naturally.

302 is viable here precisely because of (2). The byte-stream proxy was forced on us by IP-binding; that constraint disappears with public links.

## Trade-offs

| Concern                                    | Decision                                                                                                                                                                                     |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public link world-readability              | Accepted. Single-owner app, codes are unguessable (62^7 keyspace), only served in HTML behind Netlify Identity. Same effective blast radius as the byte-stream proxy.                        |
| Permanent unless revoked                   | Cron's stale-cleanup calls `deletepublink(linkid)` for any uuid no longer in `listfolder`.                                                                                                   |
| Public-link traffic quota                  | One-time check via `account_ispublinktrafficlimited`; for ~30 photos/day with one viewer this is well within any tier.                                                                       |
| Public URL leaks via 302 `Location` header | Acceptable for a single-user app — user is the only viewer and already owns the pCloud account. If the app ever goes multi-user, switch to byte-stream variant (route stays the same shape). |
| `/api/memory/<uuid>` auth gate             | Required (per user direction: every API endpoint is auth-gated). `loadServerUser()` → 401 if unauth.                                                                                         |

## Architecture

```
Cron (daily, manual first run)
   ▼
listfolder → for each file:
   - lookup fileid-index/<fileid> → existing uuid? (or mint crypto.randomUUID())
   - lookup memory/<uuid> → cached?
     - if hash matches: noop (skip pCloud call)
     - else: getfilepublink({ fileid }) → { code, linkid }
       safeExtractCaptureDate(file)  (uses existing capture-cache logic, now folded into media-cache)
       cache memory/<uuid> = { fileid, hash, code, linkid, kind, contenttype, name, captureDate }
       cache fileid-index/<fileid> = { uuid }
   - sweep: for any cached uuid not in current listfolder result:
       deletepublink(linkid); memory-cache.forget(uuid); fileid-index.forget(fileid)
   - write folder/v1 snapshot { refreshedAt, uuids: [...] }
   ▼
SSR loader (src/lib/pcloud.server.ts)
   - loadServerUser() — hard auth gate
   - read folder/v1 snapshot
   - read each memory/<uuid> in parallel
   - filter by today's month/day, sort oldest year first
   - return MemoryItem[] with { uuid, kind, name, captureDate, contenttype? }
   - NO listfolder call, NO pCloud API call (when cache is warm)
   ▼
HTML (Cache-Control: private)
   - items embed `uuid` only
   - no fileid, no code, no token
   ▼
Browser <img src="/api/memory/<uuid>?variant=image" />
        <video><source src="/api/memory/<uuid>?variant=stream" />
   ▼
src/routes/api/memory/$uuid.ts
   - auth gate (loadServerUser → 401)
   - lookup memory/<uuid> → 404 if missing
   - resolve variant default from cached kind (image → image, video → stream)
   - resolve target URL:
       image/poster → https://eapi.pcloud.com/getpubthumb?code=XYZ&size=2048x1024  (direct bytes)
       stream       → call getpublinkdownload({ code }) → { hosts, path }
                      → https://${hosts[0]}${path}                               (CDN URL with Range)
   - return Response.redirect(targetUrl, 302) with Cache-Control: private, max-age=60
   ▼
Browser follows 302 → fetches bytes from pCloud CDN directly.
   Netlify is no longer in the data path.
```

Image/poster: zero pCloud API calls per request — the `code` is enough to construct the URL. Video stream: one lightweight `getpublinkdownload` API call per route hit (browser follows the 302 once, then makes Range requests directly against the resolved CDN URL — not back through our route).

Key + value shape:

```
memory/<uuid>           → { fileid, hash, code, linkid, kind, contenttype, name, captureDate }
fileid-index/<fileid>   → { uuid }
folder/v1               → { refreshedAt, uuids: readonly string[] }
```

## Dependency graph

```
SLICE F — Revert the failed pivot                       [single revert commit]
   ▼
SLICE G — UUID + public links + 302 (single PR, multiple commits)
  G1: SPEC + plan + todo amendments                     [docs commit]
  G2: media-cache, fileid-index, folder-cache modules   [+ tests]
  G3: cron handler + @netlify/functions dep + netlify.toml schedule
  G4: /api/memory/$uuid route                           [auth-gated 302]
  G5: pcloud.server.ts loader uses cache; pcloud.ts hard auth gate
  G6: routes/index.tsx — uuid keys, /api/memory URLs
  G7: delete /api/media + media-proxy.server.ts (replaced by G4)
  → CHECKPOINT G: green tests + manual cron trigger + deploy-preview smoke
```

## Tasks

### F — Revert the failed pivot

`git revert --no-commit 47b0a4f c1af573 cbfb98f && git commit -m "..."` — single combined revert restoring the working state at `4e3c0fa`.

**Acceptance**: `git diff 4e3c0fa HEAD~1 HEAD` (after the revert commit) is empty for code files; SPEC + tasks docs return to the byte-stream-proxy version (will be overwritten in G1 anyway). Local `pnpm test`, `pnpm type-check`, `pnpm lint`, `pnpm format:check`, `pnpm build` all clean.

### G1 — SPEC + plan + todo amendments (docs commit)

**Files**: `SPEC.md`, `tasks/plan.md` (this file), `tasks/todo.md`.

**SPEC edits**:

- §2: bullet — media URLs go through `/api/memory/<uuid>?variant=...`, an auth-gated 302 to a pCloud public link. UUID, fileid, code, and token are all server-only.
- §4: drop the v4 transitional `src/routes/api/media/$fileid.ts` + `src/lib/media-proxy.server.ts`. Add `src/routes/api/memory/$uuid.ts`, `src/lib/media-cache(.server).ts`, `src/lib/fileid-index(.server).ts`, `src/lib/folder-cache(.server).ts`, `netlify/functions/refresh-memories.ts`. v3 `capture-cache(.server).ts` is removed (folded into media-cache).
- §7 "always do" — replace the byte-stream rule with: _resolve media bytes via `/api/memory/<uuid>?variant=...`, an auth-gated 302 to a pCloud public link. The cron is the only writer; the route is read-only._ Add: _every API endpoint is auth-gated via `loadServerUser()` early-throw._ Keep the `Cache-Control: private` rule on the home page HTML (no token in HTML now, but the loader response is still per-user content).
- §7 "never do" — replace the v4 "serialize signed URLs" rule with: _Sign pCloud URLs server-side and pass them to the browser when the URL is IP-bound — the browser's IP won't match. Public-link URLs are exempt: they're not IP-bound by design._ Soften the "no server-only imports" rule to be specific about `*.server.ts` modules.
- §8: §8.4 → resolved as "auth-gated 302 to public link". §8.5 → resolved as "cron is the only writer; daily 04:00 UTC; manual first-run trigger". §8.6 → resolved as "cron deletes stale uuids + their public links". §8.7 — scalability budget unchanged.
- §11: rewrite — UUID indirection; cron-warmed public-link cache; auth-gated `/api/memory/<uuid>` 302; loader path zero pCloud API calls when warm; `Cache-Control: private` on `/`.
- §12: rewrite v3→v4 narrative. Mention the dead-end browser-signing pivot in passing as historical context.

**tasks files**: replace this file (current draft) and `tasks/todo.md` accordingly.

**Acceptance**: `pnpm format:check` clean. SPEC reads end-to-end without contradicting itself.

### G2 — Cache modules

**Files**: NEW `src/lib/media-cache.ts` (+ test), NEW `src/lib/media-cache.server.ts` (+ test), NEW `src/lib/fileid-index.ts` (+ test), NEW `src/lib/fileid-index.server.ts` (+ test), NEW `src/lib/folder-cache.ts` (+ test), NEW `src/lib/folder-cache.server.ts` (+ test).

**API**:

```ts
// media-cache.ts
export type CachedMedia = {
  fileid: number
  hash: string
  code: string
  linkid: number
  kind: 'image' | 'video'
  contenttype: string
  name: string
  captureDate: string | null
}

export type MediaCacheStore = {
  get(uuid: string): Promise<CachedMedia | undefined>
  set(uuid: string, value: CachedMedia): Promise<void>
  delete(uuid: string): Promise<void>
  list(): Promise<readonly string[]>
}

export type MediaCache = {
  lookup(uuid: string): Promise<CachedMedia | undefined>
  remember(uuid: string, value: CachedMedia): Promise<void>
  forget(uuid: string): Promise<void>
  listUuids(): Promise<readonly string[]>
}

export function createMediaCache(store: MediaCacheStore): MediaCache

// fileid-index.ts (sidecar: fileid → uuid)
export type FileidIndexStore = { ... }
export type FileidIndex = { lookup, remember, forget }

// folder-cache.ts (snapshot: { refreshedAt, uuids })
export type FolderSnapshot = { refreshedAt: string; uuids: readonly string[] }
export type FolderCacheStore = { get, set }
export type FolderCache = { lookup, remember }
```

The `.server.ts` modules expose memoized `getStore` factories backed by `@netlify/blobs` with the same try/catch + no-op fallback as v3's `capture-cache.server.ts:25`.

Key prefixes: `media/`, `fileid-index/`, single key `folder/v1`.

**Acceptance**: Pure modules round-trip correctly with fake `Map`-backed stores; no-op store fallback exercised on `getStore` failure; `pnpm test` green for all six new test files.

### G3 — Cron + scheduled-function dependency

**Files**: NEW `netlify/functions/refresh-memories.ts` (+ test). MODIFY `package.json` (`@netlify/functions` dep). MODIFY `netlify.toml` (schedule block).

**Approvals (pre-acked in earlier plan-mode review)**:

- `@netlify/functions` is added to `dependencies`.
- `netlify.toml` gains:
  ```toml
  [functions."refresh-memories"]
  schedule = "0 4 * * *"
  ```

**Handler outline**:

```ts
import { schedule } from '@netlify/functions'
import { createClient } from 'pcloud-kit'
// ... import cache stores + factories, listMediaFiles, safeExtractCaptureDate

export const handler = schedule('0 4 * * *', async () => {
	const client = createClient({ token: process.env.PCLOUD_TOKEN!, type: 'pcloud' })
	const folderId = Number(process.env.PCLOUD_MEMORIES_FOLDER_ID)
	const mediaCache = createMediaCache(getMediaCacheStore())
	const fileidIndex = createFileidIndex(getFileidIndexStore())
	const folderCache = createFolderCache(getFolderCacheStore())

	const files = await listMediaFiles(client, folderId)
	const aliveUuids: string[] = []

	for (const file of files) {
		const existingUuid = await fileidIndex.lookup(file.fileid)
		const uuid = existingUuid ?? crypto.randomUUID()
		const cached = await mediaCache.lookup(uuid)
		if (!cached || cached.hash !== file.hash) {
			// First-time link or content changed: ensure we have a public link.
			const link = cached?.code
				? { code: cached.code, linkid: cached.linkid }
				: await ensurePublink(client, file.fileid)
			const captureDate = await safeExtractCaptureDate(client, file)
			await mediaCache.remember(uuid, {
				fileid: file.fileid,
				hash: file.hash,
				code: link.code,
				linkid: link.linkid,
				kind: file.contenttype.startsWith('video/') ? 'video' : 'image',
				contenttype: file.contenttype,
				name: file.name,
				captureDate: captureDate?.toISOString() ?? null,
			})
			if (!existingUuid) await fileidIndex.remember(file.fileid, uuid)
		}
		aliveUuids.push(uuid)
	}

	// Stale cleanup: delete public links + cache entries for uuids no longer in folder.
	const aliveSet = new Set(aliveUuids)
	for (const uuid of await mediaCache.listUuids()) {
		if (aliveSet.has(uuid)) continue
		const meta = await mediaCache.lookup(uuid)
		if (meta) {
			try {
				await client.call('deletepublink', { linkid: meta.linkid })
			} catch {}
			await fileidIndex.forget(meta.fileid)
		}
		await mediaCache.forget(uuid)
	}

	await folderCache.remember({ refreshedAt: new Date().toISOString(), uuids: aliveUuids })
	return { statusCode: 200 }
})

async function ensurePublink(client, fileid) {
	// getfilepublink is idempotent for an existing fileid (returns the same code on
	// repeat calls). Verified by manual curl test before this slice — see G3
	// verification step.
	const res = await client.call('getfilepublink', { fileid })
	return { code: res.code, linkid: res.linkid }
}
```

**Test**: in-memory fake stores + a fake pcloud-kit client that returns deterministic listfolder + getfilepublink + deletepublink. Asserts new files added, existing-uuid reuse, hash mismatch, removed file → cache + public link cleared, folder snapshot updated.

**Acceptance**: tests pass; `pnpm build` does not bundle `@netlify/functions` into `dist/client/`.

**Verifications already confirmed by curl** (2026-04-29):

1. ✅ `getfilepublink` idempotency.
2. ✅ `getpubthumb` returns image bytes directly.
3. ⚠️ `getpublinkdownload` returns metadata JSON (not bytes); route handler must derive the CDN URL from the response. Range support of the _derived_ URL is verified at G4 local-dev smoke (next step).
4. ✅ Premium plan, no traffic-limit concerns.

### G4 — `/api/memory/$uuid` route (auth-gated 302)

**Files**: NEW `src/routes/api/memory/$uuid.ts` (+ test).

**Behavior**:

```ts
GET ({ request, params }) =>
  // 1. auth gate
  const user = await loadServerUser(); if (!user) return new Response('unauthorized', { status: 401 })
  // 2. parse + validate uuid (UUID v4 regex; 400 otherwise)
  // 3. parse + validate variant (image|stream|poster; 400 otherwise)
  // 4. lookup memory-cache.lookup(uuid); 404 if missing
  // 5. resolve default variant from cached kind (image → image, video → stream)
  // 6. resolve target URL:
  //    image/poster → https://eapi.pcloud.com/getpubthumb?code=${code}&size=2048x1024
  //    stream       → const { hosts, path } = await client.call('getpublinkdownload', { code })
  //                   target = `https://${hosts[0]}${path}`
  // 7. return Response.redirect(targetUrl, 302) with Cache-Control: private, max-age=60
  // 8. on pCloud failure (stream): 502 with short message
```

For the stream variant we instantiate a pCloud client (`createClient({ token: process.env.PCLOUD_TOKEN, type: 'pcloud' })`) per request — same pattern as the byte-stream proxy used. The client only calls one method (`getpublinkdownload`); no risk of construction overhead being hot.

**Test** (Vitest):

- Unauth caller → 401.
- Invalid uuid → 400.
- Invalid variant → 400.
- Cache miss → 404.
- Image + auth → 302 to `https://eapi.pcloud.com/getpubthumb?code=...&size=2048x1024`.
- Video + auth + default variant → 302 to the derived CDN URL (test asserts the route called `getpublinkdownload` with the right `code` and used `hosts[0]` + `path`).
- Video + `?variant=poster` → 302 to the `getpubthumb` URL.
- pCloud `getpublinkdownload` failure → 502.
- Mock `loadServerUser`, `getMediaCacheStore`, and `createClient` via `vi.mock`.

**Acceptance**: tests green; under `pnpm netlify dev` (with cache pre-populated):

- `curl -i .../api/memory/<image-uuid>?variant=image` → 302 to `eapi.pcloud.com/getpubthumb`. Following the redirect returns image bytes.
- `curl -iL .../api/memory/<video-uuid>?variant=stream` → 302 → CDN URL → bytes.
- `curl -iL -H 'Range: bytes=0-1023' .../api/memory/<video-uuid>?variant=stream` → final response is `206 Partial Content`. **If this fails, stop and switch the stream variant to byte-stream** (server fetches the CDN URL and pipes the response, forwarding Range — same shape as the prior byte-stream proxy).

### G5 — Loader switch (uuid + cache only)

**Files**: MODIFY `src/lib/pcloud.server.ts`, MODIFY `src/lib/pcloud.server.test.ts`, MODIFY `src/lib/pcloud.ts`.

**Changes in `pcloud.server.ts`**:

```ts
export type MemoryItem =
	| { kind: 'image'; uuid: string; name: string; captureDate: string }
	| { kind: 'video'; uuid: string; contenttype: string; name: string; captureDate: string }
```

`fetchTodayMemories(today)` is rewritten:

```ts
const folderCache = createFolderCache(getFolderCacheStore())
const mediaCache = createMediaCache(getMediaCacheStore())
const snapshot = await folderCache.lookup()
if (!snapshot) {
  console.warn('[pcloud] folder snapshot missing — cron has not run yet')
  return []
}
const cached = await Promise.all(snapshot.uuids.map((u) => mediaCache.lookup(u)))
const matches = cached
  .filter((m): m is CachedMedia => m !== undefined && m.captureDate !== null)
  .map((m) => ({ meta: m, captureDate: new Date(m.captureDate!) }))
  .filter(({ captureDate }) =>
    captureDate.getMonth() + 1 === today.month && captureDate.getDate() === today.day,
  )
matches.sort((a, b) =>
  a.captureDate.getFullYear() - b.captureDate.getFullYear() || a.meta.fileid - b.meta.fileid,
)
return matches.map(({ meta, captureDate }) =>
  meta.kind === 'image'
    ? { kind: 'image', uuid: <derive uuid from meta>, name: meta.name, captureDate: captureDate.toISOString() }
    : { kind: 'video', uuid: <...>, contenttype: meta.contenttype, name: meta.name, captureDate: captureDate.toISOString() },
)
```

The uuid is the snapshot key, so we need to plumb it alongside the `CachedMedia` value (zip the two arrays).

**Loader (`pcloud.ts`)** keeps the hard auth gate from the failed pivot; payload simplifies to `MemoryItem[]` (no token).

**Tests**: rewrite `pcloud.server.test.ts` to inject fake `MediaCacheStore` + `FolderCacheStore` via `vi.mock`. Snapshot present → expected items filtered/sorted; snapshot missing → `[]` + warn; capture-date null → skipped; pCloud client is **not constructed** on the loader path.

**Acceptance**: `pnpm test` green; `pnpm type-check` clean.

### G6 — `routes/index.tsx` consumer update

**Files**: MODIFY `src/routes/index.tsx`.

- Loader returns `MemoryItem[]` (no token, no destructuring needed).
- `<MemoryView>` becomes synchronous again — URLs are constructed inline:
  ```tsx
  const url = `/api/memory/${item.uuid}?variant=${item.kind === 'image' ? 'image' : 'stream'}`
  const posterUrl = item.kind === 'video' ? `/api/memory/${item.uuid}?variant=poster` : undefined
  ```
- `memoryKey(item)` returns `item.uuid`.
- Drop the `PcloudClientProvider` import + wrapper.

**Acceptance**: home page renders identically to the byte-stream proxy era under `pnpm dev` (assuming cron has populated the cache).

### G7 — Delete the byte-stream proxy

**Files**: DELETE `src/routes/api/media/$fileid.ts`, `src/lib/media-proxy.server.ts`, `src/lib/media-proxy.server.test.ts`. Remove empty parent dirs. DELETE `src/lib/capture-cache.ts` + `capture-cache.test.ts` + `capture-cache.server.ts` + `capture-cache.server.test.ts` (capture-date now lives in `media-cache`).

**Acceptance**: `rg -n 'media-proxy|/api/media|capture-cache' src/ test/ netlify/` returns 0 matches; `pnpm build` clean; `routeTree.gen.ts` regenerates without the deleted route.

### Checkpoint G — Deploy preview + PR

- Standard gates (`pnpm test`, `pnpm type-check`, `pnpm lint`, `pnpm format:check`, `pnpm build`).
- `pnpm netlify dev` smoke once we manually pre-populate Blobs (or run the cron locally).
- Push `v4`. PR (or update PR #4) → `main`. Deploy preview rebuilds.
- **On the deploy preview** (after manually triggering the cron via Netlify dashboard "Run now"):
  1. Inspect Netlify Blobs panel: `folder/v1`, multiple `media/<uuid>`, multiple `fileid-index/<fileid>` entries.
  2. Hard reload `/`. Network tab: `/api/memory/<uuid>?variant=...` → 302 → `eapi.pcloud.com/getpubthumb` (image) or pCloud CDN host (stream). **No** `/api/media/*` requests. **No** "another IP address" / 7010 / 410 errors. Verify the video stream's final URL returns `206` for Range requests.
  3. View source on `/`: HTML embeds uuids only — no fileid, no code, no token.
  4. Wait 30+ min idle, return — images render, video plays + seeks (range request via pCloud CDN).
  5. Hit `/api/memory/<some-uuid>?variant=image` without the auth cookie → 401.
  6. Hit `getTodayMemories` server-fn endpoint without auth → 401.
  7. (Optional rename test) Rename a file in pCloud, trigger the cron, confirm `media/<uuid>` updates (same uuid, fresh hash, same code).
  8. (Optional delete test) Delete a file in pCloud, trigger the cron, confirm `media/<uuid>` + `fileid-index/<fileid>` removed and the public link is gone from pCloud's "Public Links" panel.
- **Pre-prod**: trigger the prod cron manually so the snapshot exists when users hit production. Otherwise the home page renders empty until 04:00 UTC the next day.
- Merge `v4 → main`. Post-merge prod smoke.

## Risks and mitigations

| Risk                                                              | Impact                                                | Mitigation                                                                                                                                                                                         |
| ----------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getfilepublink` is NOT idempotent → duplicate links per fileid   | Low (cosmetic clutter in pCloud's Public Links panel) | G3 verification step #1 before code lands. If non-idempotent, prepend `listpublinks` lookup before `getfilepublink`.                                                                               |
| `getpubthumb` returns HTML preview instead of bytes               | High — would block the route                          | G3 verification step #2. If it doesn't work, fall back to byte-stream variant of the route (server fetches public URL, pipes back). Architecture is the same; only the route handler body changes. |
| `getpublinkdownload` doesn't accept Range requests for video seek | Medium — video renders but seek is broken             | G3 verification step #3. Same fallback as above.                                                                                                                                                   |
| Public-link traffic limit hit on prod                             | Low for personal scale                                | G3 verification step #4 confirms headroom. If quota is tight, add `Cache-Control: public, max-age=86400, immutable` on the 302 so browsers/edges cache aggressively.                               |
| Cron fails silently on first run → empty home                     | Medium                                                | Pre-prod manual trigger; loader logs `console.warn` when snapshot is missing; dashboard scheduled-function logs reviewed after first 24 h.                                                         |
| `@netlify/functions` import leaks into client bundle              | Low                                                   | Imported only from `netlify/functions/refresh-memories.ts` (Netlify-bundled, separate from Vite). Verify with `pnpm build` then `rg '@netlify/functions' dist/client/`.                            |
| Race: cron starts deletepublink while user is mid-render          | Negligible                                            | Loader reads the snapshot first; snapshot only contains alive uuids. By the time the route is hit, the uuid may be gone (404) but the user just sees a broken image — same UX as any deleted file. |

## File touch list

| File                                                           | Slice | Action                                                         |
| -------------------------------------------------------------- | ----- | -------------------------------------------------------------- |
| `SPEC.md`                                                      | G1    | MODIFY (§2/§4/§7/§8/§11/§12)                                   |
| `tasks/plan.md`                                                | G1    | REPLACE (this file)                                            |
| `tasks/todo.md`                                                | G1    | REPLACE                                                        |
| `src/lib/media-cache.ts` (+ test)                              | G2    | NEW                                                            |
| `src/lib/media-cache.server.ts` (+ test)                       | G2    | NEW                                                            |
| `src/lib/fileid-index.ts` (+ test)                             | G2    | NEW                                                            |
| `src/lib/fileid-index.server.ts` (+ test)                      | G2    | NEW                                                            |
| `src/lib/folder-cache.ts` (+ test)                             | G2    | NEW                                                            |
| `src/lib/folder-cache.server.ts` (+ test)                      | G2    | NEW                                                            |
| `package.json` / `pnpm-lock.yaml`                              | G3    | MODIFY (`@netlify/functions` — pre-acked)                      |
| `netlify.toml`                                                 | G3    | MODIFY (schedule block — pre-acked)                            |
| `netlify/functions/refresh-memories.ts` (+ test)               | G3    | NEW                                                            |
| `src/routes/api/memory/$uuid.ts` (+ test)                      | G4    | NEW                                                            |
| `src/lib/pcloud.server.ts`                                     | G5    | MODIFY (`MemoryItem` shape; loader reads cache only)           |
| `src/lib/pcloud.server.test.ts`                                | G5    | REWRITE                                                        |
| `src/lib/pcloud.ts`                                            | G5    | MODIFY (auth gate; payload `MemoryItem[]`)                     |
| `src/routes/index.tsx`                                         | G6    | MODIFY (uuid keys + uuid URLs; drop provider)                  |
| `src/lib/pcloud-client.tsx`                                    | G6    | DELETE (vestige of failed pivot — already removed by F revert) |
| `src/routes/api/media/$fileid.ts`                              | G7    | DELETE                                                         |
| `src/lib/media-proxy.server.ts` (+ test)                       | G7    | DELETE                                                         |
| `src/lib/capture-cache.ts` (+ test, + .server, + .server.test) | G7    | DELETE                                                         |

## Out of scope

- Multi-user / shared-album support — see SPEC §1 non-goal.
- Folder-scoped pCloud OAuth tokens — token stays server-only here, so the blast radius is already minimal.
- Slice D from earlier plans (refactor `routes/index.tsx` into `src/components/`) — orthogonal nice-to-have.
- Any change to `oxlint.config.ts`, `oxfmt.config.ts`, `tsconfig.json`, `vite.config.ts`, `.github/workflows/ci.yml`.

## G8 amendment — pivot from 302 to byte-stream (after Checkpoint G)

After Checkpoint G's deploy-preview verification surfaced that the 302 leaks the public-link URL to the browser's Network tab, the "byte-stream variant" parked above was promoted from a contingency to the actual implementation. The route's external contract is unchanged (`/api/memory/<uuid>?variant=...` with the same status codes for auth/validation/miss); only the success path swapped from `Response.redirect(upstreamUrl, 302)` to `fetch(upstreamUrl, { headers: { range } })` piped into a new `Response(upstream.body, ...)`.

Concrete changes (commit 3b714e3):

- `src/lib/memory-route.server.ts` — added `FetchBytes` dep type and a `streamFromUpstream(upstreamUrl, range, variant, contenttype, fetchBytes)` helper. Forwards `content-length`, `content-range`, and the upstream status (so a Range request becomes `206 Partial Content` end-to-end). Cache-control is set per-variant (`max-age=86400, immutable` for image/poster; `max-age=60` for stream).
- `src/routes/api/memory/$uuid.ts` — supplies a default `fetchBytes` impl that wires `globalThis.fetch` with the browser's `Range` header injected when present.
- Tests in `src/lib/memory-route.server.test.ts` — rewrote the success-path assertions to verify the upstream URL is fetched, the body is piped, and crucially that `res.headers.get('location')` is `null` so no public-link URL leaks.

Trade-off: every video Range request now goes through the function (Netlify bandwidth in the data path). Acceptable for a single-user app; the user has a premium pCloud plan and Netlify's free-tier bandwidth is not yet the bottleneck.

Verification still pending: deploy-preview hard reload + video seek + Network-tab inspection per `tasks/todo.md` G8 section.
