# Recuerdea v3 Implementation Plan — Capture-date cache via Netlify Blobs

## Context

Recuerdea v2 (shipped) calls `client.listfolder` and then, **for every media file in the folder on every page load**, runs:

1. `client.getfilelink(fileid)` — 1 pCloud API call per file
2. `extractCaptureDate(url)` (image) or `extractVideoCaptureDate(url)` (video) — 1 HTTP range-fetch per image, 1–2 for videos with `moov` at the end of the file

That's the dominant latency on the home route and it doesn't get faster as the archive grows — it gets linearly worse. The capture date for a given file's bytes is _eternal_: the only thing that invalidates it is the file content itself changing.

`SPEC.md §8.3` already nominates **Netlify Blobs** as the future metadata store. v3 cashes that in for a single, narrow win: cache `(fileid, hash) → captureDate | null` so the home route stops range-fetching unchanged files on every visit.

**Out of scope for v3** (do not let this plan grow):

- Caching pCloud listing (cheap, and we _need_ it to detect new files).
- Caching `getfilelink` / `getthumblink` / `getvideolink` URLs — pCloud signs them with short expiry; cached values would 403.
- Any UI change. The route renders the same `MemoryItem[]` shape.
- Tagging / captioning / blob-stored user metadata — `SPEC.md §1` non-goal, future work.
- Cache GC / pruning of deleted files — stale blobs are harmless; revisit if it becomes a problem.

## Prerequisites

### P0: New top-level dep `@netlify/blobs` — **needs explicit ack**

`SPEC.md §7` ("ask first") flags new top-level deps. The dep is `@netlify/blobs` (Netlify's own SDK, ~small, no transitive concerns, the canonical way to use Blobs from a Netlify-hosted server function). Picking it is implied by the v3 direction, but listing it here so the boundary check is explicit before T1 begins.

Add to `dependencies` (not `devDependencies` — it runs in the server function bundle).

## Architecture decisions

### What gets cached

Exactly one thing: **the final result of `safeExtractCaptureDate`** for a given file. That includes the EXIF/mvhd parse _and_ the `parseFilenameCaptureDate` fallback, so a cache hit means zero `getfilelink` calls and zero range fetches for that file.

### Key + value shape

```
key:   capture-date/v1/${fileid}
value: { hash: string, captureDate: string | null }   // ISO string or explicit null (negative cache)
```

- `hash` is `FileMetadata.hash` (pcloud-kit types it as `string`). Cache hit requires both `fileid` match (key) and `hash` match (value).
- `null` is cached on purpose — files we tried and failed to date should not be re-fetched on every visit.
- The `v1/` prefix lets us bulk-invalidate by bumping to `v2/` if the extraction logic (EXIF tags considered, filename parser, mvhd reader) changes in a way that could yield different results for the same bytes.

### Local-dev fallback

`@netlify/blobs` requires a Netlify runtime context (auto-injected by `netlify dev` and prod). Plain `pnpm dev` (Vite, port 3000) has no context and `getStore()` will throw on first access. Two-mode store:

- **Live store** when `getStore` resolves (prod, `netlify dev`).
- **No-op store** otherwise: `get` always returns `undefined` (miss), `set` is a no-op, both still return Promises so the call sites stay async.

Detection happens once at module load (lazy `getStore` inside a try/catch wrapped in a memoized factory). `pnpm dev` keeps working with no setup; full caching kicks in under `netlify dev` and prod.

### Per-file flow after v3

```
listfolder
  └─ for each media file (parallel):
       └─ cache.get(fileid, hash)
             ├─ hit  → use cached captureDate (no API call, no range fetch)
             └─ miss → getfilelink → extractor → fallback parse
                        └─ cache.set(fileid, hash, result)
```

Match check, sort, and per-kind URL build (which still need fresh `getthumblink` / `getfilelink` per visit) are unchanged.

### Concurrency / write contention

`Promise.all` over many files can fire many `cache.set` writes in parallel. Netlify Blobs handles concurrent writes safely (last-writer-wins), and we never read the same key inside the same request twice, so no coordination is needed. No locking, no debouncing.

## Dependency graph

```
P0: dep ack (@netlify/blobs)
    │
    ▼
T1: src/lib/capture-cache.ts          (pure cache abstraction + types)
    + src/lib/capture-cache.test.ts   (in-memory fake store)
    │
    ▼
T2: src/lib/capture-cache.server.ts   (Netlify-Blobs-backed store + no-op fallback)
    + src/lib/capture-cache.server.test.ts (only the no-op-on-error branch is unit-testable)
    │
    ▼
T3: src/lib/pcloud.server.ts          (wire cache into safeExtractCaptureDate)
    + src/lib/pcloud.server.test.ts   (assert hit skips network; miss writes; hash mismatch invalidates)
    │
    ▼
[CHECKPOINT 1: server tests + typecheck + lint]
    │
    ▼
T4: Manual e2e under `netlify dev` — confirm 2nd visit is dramatically faster
    + drop the v2 [memories] console.log lines now that we have a real signal
    │
    ▼
[CHECKPOINT 2: prod deploy + manual smoke]
```

## Tasks

### T1 — Cache abstraction (pure)

**Files:**

- NEW `src/lib/capture-cache.ts`
- NEW `src/lib/capture-cache.test.ts`

**API:**

```ts
export type CaptureCacheValue = { hash: string; captureDate: string | null }

export type CaptureCacheStore = {
	get(fileid: number): Promise<CaptureCacheValue | undefined>
	set(fileid: number, value: CaptureCacheValue): Promise<void>
}

export function createCaptureCache(store: CaptureCacheStore): {
	lookup(fileid: number, hash: string): Promise<Date | null | undefined> // undefined = miss
	remember(fileid: number, hash: string, captureDate: Date | null): Promise<void>
}
```

**Behavior:**

- `lookup` reads, returns `undefined` on miss _or_ hash mismatch (treat mismatch as miss so caller refetches), returns the parsed `Date` or `null` on hit.
- `remember` writes `{ hash, captureDate: capture?.toISOString() ?? null }`.
- Pure module — receives the store, never imports `@netlify/blobs`.

**Acceptance criteria:**

- Hit returns the right `Date` instance (round-trips ISO string).
- Hit on `null` returns `null` (not `undefined`).
- Hash mismatch returns `undefined`.
- Miss returns `undefined`.
- `remember(... null)` writes `captureDate: null`.

**Verification:** `pnpm test src/lib/capture-cache.test.ts` green; tests use a `Map`-backed fake store.

---

### T2 — Netlify-Blobs-backed store + no-op fallback

**Files:**

- NEW `src/lib/capture-cache.server.ts`
- NEW `src/lib/capture-cache.server.test.ts`

**API:**

```ts
export function getCaptureCacheStore(): CaptureCacheStore
```

**Behavior:**

- Memoized factory. First call: try `getStore({ name: 'capture-date-cache', consistency: 'eventual' })` from `@netlify/blobs`. Wrap in try/catch.
- On success: return a real store — keys formatted `v1/${fileid}`, values via `getJSON` / `setJSON`.
- On failure (no Netlify runtime in `pnpm dev`): return a no-op store (`get` → `undefined`, `set` → resolved void). Log once at `console.warn` so the dev knows caching is off.
- Server-only — uses `@netlify/blobs`. Import only from `*.server.ts` callers, per `SPEC.md §7` "never import server-only modules from client code."

**Acceptance criteria:**

- Factory returns the same store instance on repeated calls (memoized).
- The no-op branch is exercised by a test that forces `getStore` to throw and asserts `set` is silently a no-op and `get` returns `undefined`.

**Verification:** `pnpm test src/lib/capture-cache.server.test.ts` green. Live-store branch is _not_ unit-tested (no Netlify runtime in Vitest); covered by T4's manual run.

---

### T3 — Wire cache into `pcloud.server.ts`

**Files:**

- MODIFY `src/lib/pcloud.server.ts`
- MODIFY `src/lib/pcloud.server.test.ts`

**Change:** `safeExtractCaptureDate(client, file)` becomes `safeExtractCaptureDate(client, file, cache)`. New flow:

```ts
async function safeExtractCaptureDate(
	client: Client,
	file: FileMetadata,
	cache: ReturnType<typeof createCaptureCache>,
): Promise<Date | null> {
	const cached = await cache.lookup(file.fileid, file.hash)
	if (cached !== undefined) return cached

	let result: Date | null = null
	try {
		const url = await client.getfilelink(file.fileid)
		const exif = isVideo(file)
			? await extractVideoCaptureDate(url)
			: await extractCaptureDate(url)
		result = exif ?? parseFilenameCaptureDate(file.name) ?? null
	} catch {
		result = null
	}
	await cache.remember(file.fileid, file.hash, result)
	return result
}
```

`fetchTodayMemories` instantiates the cache once at the top:

```ts
const cache = createCaptureCache(getCaptureCacheStore())
```

and threads it into the `Promise.all` map. No other behavior changes; per-kind URL build for matched items is untouched.

**Cleanup in this same task:** the two `console.log('[memories] ...')` blocks at `src/lib/pcloud.server.ts:118–125` and `:130–135` go away. They were debugging breadcrumbs from v2; once cache hit/miss is observable through latency they have no audience. (`a3c1b23` already removed siblings; these two were left for the v2 cache-gap investigation.)

**Acceptance criteria:**

- Existing `pcloud.server.test.ts` still passes once tests pass an injected cache (use the in-memory fake from T1 or a tiny inline one).
- New test: hit case — cache pre-populated, neither `getfilelink` nor extractor mocks are called.
- New test: miss case — extractors called once, then `cache.remember` called with the right `(fileid, hash, captureDate)`.
- New test: hash mismatch — pre-populated cache with stale `hash`, extractors run, cache overwritten.

**Verification:**

- `pnpm test src/lib/pcloud.server.test.ts` green.
- `pnpm type-check` clean across the repo.
- `pnpm lint` clean for changed files.

---

### CHECKPOINT 1 — Server layer green

- `pnpm test` (full suite).
- `pnpm type-check`.
- `pnpm lint`.
- `pnpm format:check`.

---

### T4 — Manual e2e under `netlify dev`

Not a code task — a verification gate. Done in this order:

1. `pnpm install` (picks up `@netlify/blobs`).
2. `pnpm netlify dev` (launches on port 8888 with Blobs runtime injected).
3. Sign in, hit `/`. First visit: similar latency to v2 (cache cold).
4. Reload `/`. Second visit: should be visibly faster — most files hit the cache, only newly-added ones run through the extractor.
5. Browser DevTools network tab: confirm there are far fewer `getfilelink` calls on the second visit (one per matched file for the URL build, but none for capture-date extraction on cached files).
6. Admin date override (`?date=YYYY-MM-DD`) still works, hits the same cache (cache is keyed on file, not on day).

**Acceptance criteria:**

- Second visit is observably faster (eyeball or network tab; no perf budgets in CI).
- No regression in feed correctness, video playback, empty state, admin override.
- No `[memories] ...` console noise in dev (cleanup from T3 landed).

---

### CHECKPOINT 2 — Prod smoke

After merge + Netlify deploy:

- Visit prod home. Hard reload, then reload again. Second reload is visibly faster.
- Netlify dashboard → Blobs → `capture-date-cache` store has entries.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| `@netlify/blobs` API drift between minor versions | Low | Pin via lockfile (`pnpm-lock.yaml`); the surface we use (`getStore`, `getJSON`, `setJSON`) is stable. |
| `getStore()` throws at runtime in prod (mis-config) | Medium — page would crash | Same try/catch as the dev fallback wraps `getStore()` itself; on failure we degrade to no-op cache and log a warn. Page still renders. |
| Stale negative cache after extractor improvement | Low | `v1/` key prefix; bump to `v2/` when the extractor's null/non-null decision boundary changes. |
| Cache write storm on first visit to a large folder | Low | Netlify Blobs handles concurrent writes; each `set` is independent, last-writer-wins on a per-key basis. |
| File renamed but content unchanged → wasted re-parse | Negligible | pCloud's `hash` is content-derived, so rename alone doesn't change `hash` — cache still hits. (Verify in T4 by renaming a known file in pCloud and reloading.) |

## Open questions

None blocking. P0 (dep ack) is the only gate before T1.

## File touch list

| File | Action |
|---|---|
| `src/lib/capture-cache.ts` | NEW (T1) |
| `src/lib/capture-cache.test.ts` | NEW (T1) |
| `src/lib/capture-cache.server.ts` | NEW (T2) |
| `src/lib/capture-cache.server.test.ts` | NEW (T2) |
| `src/lib/pcloud.server.ts` | MODIFY (T3) — add cache wiring; drop `[memories]` logs |
| `src/lib/pcloud.server.test.ts` | MODIFY (T3) — pass injected cache; new hit/miss/mismatch tests |
| `package.json` / `pnpm-lock.yaml` | MODIFY (P0) — add `@netlify/blobs` to `dependencies` |
| `SPEC.md` | MODIFY (small) — add a §10 "v3 changes" entry mirroring §9; update §8.3 from "agreed direction" to "shipped for capture-date cache" |

## Out of scope (do not touch)

- `oxlint.config.ts`, `oxfmt.config.ts`, `tsconfig.json`, `vite.config.ts`, `.github/workflows/ci.yml` — `SPEC.md §7` "ask first."
- Any UI change in `src/routes/index.tsx`. `MemoryItem[]` shape is unchanged.
- Cache eviction / GC of files no longer in the folder.
- pCloud listing cache.
- Anything tagging/captioning related — separate v4 spec when that arrives.
