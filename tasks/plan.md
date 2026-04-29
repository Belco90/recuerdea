# Recuerdea v4 Implementation Plan — Pivot to client-side pCloud signing

## Status before this revision

- Phase 0 + Slice A + A.5 are **shipped on `v4`** (commits `8b13827` → `4e3c0fa`):
  - `/api/media/:fileid` route exists and byte-streams pCloud bytes through Netlify.
  - `MemoryItem` URLs are relative `/api/media/<fileid>?variant=...` strings.
  - The byte-stream proxy works — IP-mismatch (the v3-era "410") is fixed.
- Slices B (UUID indirection), C (cron), D (refactor) were planned but **not started**.

The user has reviewed the working state and judged it over-engineered for the scope of the app. This revision pivots the architecture to **client-side URL signing**, deletes the byte-stream proxy, and drops the cron + UUID-indirection work entirely. The on-disk SPEC has been amended accordingly.

## Why this works

pCloud signs `getfilelink` / `getthumblink` URLs **bound to the IP of the caller**. That's exactly why the byte-stream proxy was needed: the function's IP signed the URL, the browser's IP couldn't use it. If the **browser itself** calls `getthumblink`, the URL is bound to the browser's IP and the browser uses it — IP match by construction.

`pcloud-kit` is browser-safe for the methods we need. `node:fs`/`node:path`/`node:stream` are only imported dynamically inside `download` / `downloadfile` / `uploadfile` (filesystem helpers we don't call). The library ships an `oauth-browser` entry point and is `sideEffects: false`. Vite tree-shakes the unused Node imports out of the client bundle.

## Trade-off accepted

- pCloud's auth token now ships in the SSR response and lives in browser memory of every authenticated session.
- Blast radius if leaked (XSS, malware): full pCloud account read/write, not just the memories folder.
- Mitigation in scope: SSR responses for `/` must not be public-cacheable (`Cache-Control: private` / `no-store` on the loader's HTML). Auth gate hardened so the server function won't return the token to unauthenticated callers.
- Folder-scoped pCloud OAuth tokens — out of scope.

## What gets ripped out

- `src/routes/api/media/$fileid.ts` (the route handler).
- `src/lib/media-proxy.server.ts` + its test (the streaming/url helpers).
- All A.5 byte-streaming machinery.

## What gets kept

- `capture-cache.ts` + `capture-cache.server.ts` — v3's per-fileid `{hash, captureDate}` cache stays.
- `getTodayMemories` server fn shape (loader still hits it via `createServerFn`).
- `fetchTodayMemories` in `pcloud.server.ts` — folder listing + capture-date extraction + filter + sort. URL-building is removed.

## Slices dropped vs. the old plan

| Old slice                    | Status             | Why                                                                            |
| ---------------------------- | ------------------ | ------------------------------------------------------------------------------ |
| Slice A (proxy + 302)        | shipped → reverted | Architectural pivot; the route is going away.                                  |
| Slice A.5 (byte-stream)      | shipped → reverted | Same. The IP-binding learning lives in SPEC §12 as historical context.         |
| Slice B (UUID indirection)   | dropped            | If `fileid` ships to the browser, hiding it behind a UUID is wasted machinery. |
| Slice C (cron-warmed cache)  | dropped            | One `listfolder` per visit is bounded and acceptable for ~1000 files.          |
| Slice D (refactor index.tsx) | parked             | Orthogonal nice-to-have; follow-up PR.                                         |

## Architecture after this slice

```
Browser
   │ GET /
   ▼
Home loader (src/lib/pcloud.ts → fetchTodayMemories)
   │  client.listfolder(folderId)
   │  capture-cache lookups + extraction (warm cache → 0 extractor calls)
   │  filter by today, sort
   │  return { items: MemoryItem[], pcloudToken }
   ▼
HTML (SSR, Cache-Control: private)
   │ items embed `fileid`, `kind`, `contenttype`, `name`, `captureDate`
   │ pcloudToken embedded alongside
   ▼
Browser <Home> wraps memory list in <PcloudClientProvider token={pcloudToken}>
   │ Provider stores one pcloud-kit Client in useState lazy init
   ▼
Browser <MemoryView item={...}>
   │ const client = usePcloudClient()
   │ const urls = useMemoryUrls(item)         (effect-driven; placeholder until resolved)
   │ getthumblink(fileid, '2048x1024')        for image / poster
   │ getfilelink(fileid)                      for video stream
   ▼
Browser <img src=...> / <video><source src=...>>
   │ direct fetch from pCloud CDN (browser-IP-bound URL)
   ▼
Bytes rendered. Netlify is no longer in the data path.
```

## Dependency graph

```
SLICE E — pivot to client-side signing (single PR)
  E1: SPEC + plan + todo amendments (docs only)             [docs commit]
  E2: server side — MemoryItem carries fileid + contenttype;
       loader returns { items, pcloudToken };
       getTodayMemories enforces auth before returning token
  E3: client side — PcloudClientProvider + usePcloudClient + useMemoryUrls;
       routes/index.tsx wraps memory list in provider; <MemoryView> becomes effect-driven
  E4: cleanup — delete /api/media/$fileid.ts, media-proxy.server.ts + tests
  → CHECKPOINT E: green tests + deploy-preview smoke (image render, video play, seek, 30-min idle, server-fn auth gate)
```

## Tasks

### E1 — SPEC + plan + todo amendments

**Files**: `SPEC.md` (DONE — amendments landed), `tasks/plan.md` (this file), `tasks/todo.md`. Single docs commit.

**Acceptance**:

- `rg -n 'byte-?stream|uuid indirection|fileid-index|folder-cache|refresh-cache|cron' SPEC.md` shows matches only in §8 (withdrawn entries) and §12 (historical context).
- `tasks/plan.md` and `tasks/todo.md` reflect this revision.
- `pnpm format:check` clean.

### E2 — Server: loader returns `{ items, pcloudToken }`, hard auth gate

**Files**: MODIFY `src/lib/pcloud.server.ts`, MODIFY `src/lib/pcloud.server.test.ts`, MODIFY `src/lib/pcloud.ts`.

**Changes in `pcloud.server.ts`**:

```ts
export type MemoryItem =
	| { kind: 'image'; fileid: number; name: string; captureDate: string }
	| { kind: 'video'; fileid: number; contenttype: string; name: string; captureDate: string }
```

`buildMemoryItem` becomes synchronous and stops constructing `/api/media/...` strings.

**Changes in `pcloud.ts`**:

```ts
type LoaderPayload = { items: readonly MemoryItem[]; pcloudToken: string }

export const getTodayMemories = createServerFn({ method: 'GET' })
  .inputValidator(...)
  .handler(async ({ data }): Promise<LoaderPayload> => {
    const { loadServerUser } = await import('./auth.server')
    const user = await loadServerUser()
    if (!user) throw new Error('unauthenticated')
    let target = realToday()
    if (data && user.isAdmin) target = data
    const { fetchTodayMemories } = await import('./pcloud.server')
    const items = await fetchTodayMemories(target)
    const pcloudToken = process.env.PCLOUD_TOKEN
    if (!pcloudToken) throw new Error('PCLOUD_TOKEN not set')
    return { items, pcloudToken }
  })
```

**Test updates** (`pcloud.server.test.ts`):

- Drop `MemoryItem.url` / `MemoryItem.posterUrl` assertions.
- Assert `MemoryItem.fileid`, `kind`, `name`, `captureDate`, plus `contenttype` for video.

**Acceptance**: `pnpm test` green; `pnpm type-check` green.

### E3 — Client: `PcloudClientProvider` + `useMemoryUrls`

**Files**: NEW `src/lib/pcloud-client.tsx`. MODIFY `src/routes/index.tsx`.

`pcloud-client.tsx` mirrors the existing `IdentityProvider` pattern at `src/lib/identity-context.tsx:17`:

```tsx
const PcloudClientContext = createContext<Client | null>(null)

export function PcloudClientProvider({ token, children }) {
	const [client] = useState<Client>(() => createClient({ token, type: 'pcloud' }))
	return <PcloudClientContext value={client}>{children}</PcloudClientContext>
}

export function usePcloudClient(): Client {
	const client = useContext(PcloudClientContext)
	if (!client) throw new Error('usePcloudClient must be used within PcloudClientProvider')
	return client
}

export function useMemoryUrls(item: MemoryItem): { url: string; posterUrl?: string } | undefined {
	const client = usePcloudClient()
	const [urls, setUrls] = useState(undefined)
	useEffect(() => {
		let cancelled = false
		async function resolve() {
			if (item.kind === 'image') {
				const url = await getThumbUrl(client, item.fileid)
				if (!cancelled) setUrls({ url })
			} else {
				const [url, posterUrl] = await Promise.all([
					getStreamUrl(client, item.fileid),
					getThumbUrl(client, item.fileid),
				])
				if (!cancelled) setUrls({ url, posterUrl })
			}
		}
		void resolve()
		return () => {
			cancelled = true
		}
	}, [client, item.fileid, item.kind])
	return urls
}
```

`getThumbUrl` / `getStreamUrl` lift verbatim from `src/lib/media-proxy.server.ts` (`resolveMediaUrl`) — same `client.call('getthumblink', ...)` / `client.getfilelink(...)` shape, same `https://${host}${path}` stitch.

**`routes/index.tsx` changes**:

- `loader` returns `{ items, pcloudToken }` directly (drops the `{ memories: ... }` wrapping).
- `<Home>` reads loader payload, wraps memory list in `<PcloudClientProvider token={pcloudToken}>`.
- `<MemoryView>` becomes effect-driven via `useMemoryUrls(item)`. Placeholder while resolving.
- `memoryKey(item)` returns `String(item.fileid)`.

**Acceptance**: full test suite green; type-check, lint, format:check clean. Local `pnpm dev` smoke: home renders images and videos, network tab shows direct `*.pcloud.com` requests.

### E4 — Cleanup

DELETE:

- `src/routes/api/media/$fileid.ts`
- `src/lib/media-proxy.server.ts`
- `src/lib/media-proxy.server.test.ts`
- `src/routes/api/media/` directory if empty; `src/routes/api/` if empty.

**Acceptance**: `rg -n 'media-proxy|/api/media' src/ test/` returns 0 matches. `pnpm build` clean. Route tree regenerates without the deleted route.

### CHECKPOINT E — Deploy-preview verification

- Standard gates (`test`, `type-check`, `lint`, `format:check`, `build`).
- `pnpm dev` smoke locally.
- Push `v4`. PR (or update PR #4) → `main`.
- On the deploy preview:
  1.  Hard reload `/` — direct `*.pcloud.com` requests, no `/api/media/*`, no 410s, no "another IP address" errors.
  2.  Wait 30+ min, return — re-mount re-signs URLs, images render, video plays, seek works.
  3.  View source on `/` — HTML embeds `pcloudToken`; HTML does NOT contain pCloud signed URLs.
  4.  `curl -I https://<deploy-preview>/` — `cache-control` is `private` / `no-store` / absent (never `public, s-maxage=...`). If it's public-cacheable, add an explicit response header and re-verify.
  5.  Hit `getTodayMemories` server-fn endpoint without the auth cookie — must throw, not return a token.
- Merge `v4 → main`. Post-merge prod smoke.

## Risks and mitigations

| Risk                                                                        | Impact                             | Mitigation                                                                                                           |
| --------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Token leak via XSS → full pCloud account access                             | High but bounded (single-user app) | SPEC §7 documents the trade-off; HTML is `private` / `no-store`; rely on Chakra/React's escaping.                    |
| pcloud-kit's `node:fs` dynamic imports leak into the client bundle          | Low                                | Imports are inside unreachable methods; Vite tree-shakes. Verify with `pnpm build` then `rg 'node:fs' dist/client/`. |
| Per-image URL-signing API call adds RTT                                     | Low                                | ~30 items, parallel sign on mount, HTTP/2 multiplexing. UX shows a placeholder until URL resolves.                   |
| Long-idle tabs hit expired URLs on re-render                                | Low                                | Re-mount re-signs. If broken images on focus-return, add a focus-driven re-sign in `useMemoryUrls`.                  |
| pCloud API CORS rejects browser calls                                       | High — would block this pivot      | pcloud-kit ships `oauth-browser`; verify in local-dev smoke before pushing E2/E3.                                    |
| `getTodayMemories` server-fn endpoint hit unauthenticated returns the token | High                               | E2 hard auth gate (`loadServerUser()` early-throw).                                                                  |

## File touch list

| File                                 | Slice | Action                                                                             |
| ------------------------------------ | ----- | ---------------------------------------------------------------------------------- |
| `SPEC.md`                            | E1    | MODIFY (done — §2/§4/§7/§8/§11/§12)                                                |
| `tasks/plan.md`                      | E1    | REPLACE (this file)                                                                |
| `tasks/todo.md`                      | E1    | REPLACE                                                                            |
| `src/lib/pcloud.server.ts`           | E2    | MODIFY (`MemoryItem` shape; `buildMemoryItem` drops URLs)                          |
| `src/lib/pcloud.server.test.ts`      | E2    | MODIFY (drop URL assertions)                                                       |
| `src/lib/pcloud.ts`                  | E2    | MODIFY (auth gate; loader payload `{ items, pcloudToken }`)                        |
| `src/lib/pcloud-client.tsx`          | E3    | NEW (provider + `usePcloudClient` + `useMemoryUrls`)                               |
| `src/routes/index.tsx`               | E3    | MODIFY (loader payload destructure; provider wraps list; `<MemoryView>` uses hook) |
| `src/routes/api/media/$fileid.ts`    | E4    | DELETE                                                                             |
| `src/lib/media-proxy.server.ts`      | E4    | DELETE                                                                             |
| `src/lib/media-proxy.server.test.ts` | E4    | DELETE                                                                             |

## Out of scope

- Folder-scoped pCloud OAuth tokens.
- Slice D (refactor `routes/index.tsx` into `src/components/`) — follow-up PR.
- Any change to `oxlint.config.ts`, `oxfmt.config.ts`, `tsconfig.json`, `vite.config.ts`, `.github/workflows/ci.yml`, `netlify.toml`.
- Any change to `src/lib/auth.ts` / `auth.server.ts` (other than reading `loadServerUser` from the new auth gate) / `identity-context.tsx` / `navigation.ts`.
- `capture-cache.ts` / `capture-cache.server.ts` — kept verbatim.
