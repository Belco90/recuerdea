# Recuerdea v6 — Show capture location instead of filename caption

## Overview

Replace the polaroid caption (currently `captionFromName(item.name)`, the file's basename) with the **place where the photo/video was taken**, derived from the media's GPS metadata. The home page becomes "where + when" instead of "filename + when".

Branch: `v6-location` (to create from `main`). PR target: `main`. Cron remains the sole writer of the cache; loader stays read-only and zero-API.

## Resolved decisions (locked in)

| #   | Decision                   | Outcome                                                                                                                                                                                                                                                                                       |
| --- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Reverse geocoding provider | **Geoapify Reverse Geocoding API** (`https://api.geoapify.com/v1/geocode/reverse`). Free tier: 3,000 req/day, 5 req/sec. Reads API key from `GEOAPIFY_API_KEY` Netlify env var. Spanish output via `lang=es`. _History: started with OpenCage (Slices 4–7), switched to Geoapify in Slice 8._ |
| Q2  | Cache migration            | **Clear Blobs manually before deploy.** No `schemaVersion` field. The cron rebuilds every entry on its first post-deploy run. (Slice 4 dropped vs the prior draft.)                                                                                                                           |
| Q3  | UI fallback when no place  | Hide the caption entirely. No filename fallback, no "Sin ubicación" label.                                                                                                                                                                                                                    |
| Q4  | Lightbox header            | Append place after the years-ago line (e.g. `2019 · hace 6 años · Madrid`). Hidden when null.                                                                                                                                                                                                 |
| Q5  | Logging                    | **Never log any geo-derived data** — neither lat/lng, the Geoapify response, nor the resolved `place` string. Counts only (`[refresh] geocoded N/M`).                                                                                                                                         |

## Confirmed assumptions

1. Caption is a short human-readable place string (e.g. "Madrid, España"); not raw coords; not a full street address.
2. Locale is Spanish (`lang=es` to Geoapify).
3. Geocoding runs at cron time, not page time.
4. No-GPS / no-place items render with no caption.
5. `Lightbox` keeps `alt={item.name}` for a11y; only the _visible_ header line uses `place`.
6. Existing cache cleared manually before deploy; no schema-version migration needed.

## Feasibility recap

| Source                        | Status                             | Notes                                                          |
| ----------------------------- | ---------------------------------- | -------------------------------------------------------------- |
| **JPEG / HEIC / TIFF (EXIF)** | ✅ `exifr` already in deps         | Add `latitude` / `longitude` to requested tags.                |
| **MP4 / MOV (Apple)**         | ✅ extends existing `moov` walker  | iPhone records GPS as ISO 6709 in `moov.udta.©xyz`.            |
| **MP4 / MOV (other cameras)** | ⚠️ best-effort, degrades to `null` | Only `udta.©xyz` supported in v6; revisit if hit-rate is poor. |
| **Older / scanned photos**    | ❌ no GPS → no caption             | Per Q3.                                                        |

## Architecture

- **Two-stage extraction at cron time, both cached on `CachedMedia`:**
  1. Raw `location: { lat, lng } | null` from EXIF / `©xyz`.
  2. Display `place: string | null` from Geoapify. Stage 2 only runs when stage 1 succeeds **and** there's no cached `place` yet, so a flaky geocode call retries on the next cron run without re-doing the rest of the work.
- `place` is a denormalized display string. Structured data is not exposed to the browser; if we ever need city/country separately we still have `lat`/`lng` to re-derive.
- Reverse-geocoding is server-only (cron only). Loader and `/api/memory/...` route never call Geoapify.
- No new top-level dep: Geoapify is a plain HTTPS GET. Net new env var: `GEOAPIFY_API_KEY`.
- Loader hot path unchanged: `MemoryItem` gains a `place: string | null` field; everything else is identical.

## Dependency graph

```
exif.ts (image GPS)        video-meta.ts (mp4 GPS)
        \                        /
         \                      /
          v                    v
     geoapify.server.ts (reverse geocode, sequential, capped)
          |
          v
     refresh-memories.server.ts (extract + geocode + cache)
          |
          v
     CachedMedia (gains location + place)
          |
          v
     pcloud.server.ts (MemoryItem gains place)
          |
          v
     Polaroid.tsx (caption = item.place || none)
     Lightbox.tsx (header line conditionally appends place)
```

Bottom-up build order: extractors → cache shape → geocoder → cron orchestration → loader projection → UI.

## Phases, slices, checkpoints

### Phase 1 — Extraction primitives

- **Slice 1: Image GPS via `exifr`**
  - `extractImageMeta` returns `location: { lat: number; lng: number } | null` alongside existing fields.
  - Tags added: `latitude`, `longitude`. Validate finite + lat ∈ [-90, 90] + lng ∈ [-180, 180]; otherwise `null`.
  - Acceptance: `exif.test.ts` covers present / missing / one-side-missing / NaN / out-of-range / exifr-throws.

- **Slice 2: Video GPS via `udta.©xyz`**
  - Extend `moov` walker to descend into `udta` and find `©xyz` (`0xa9 'x' 'y' 'z'`).
  - Parse ISO 6709: `^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)(?:[+-]\d+(?:\.\d+)?)?\/?$`. Range-validate.
  - Acceptance: `video-meta.test.ts` covers synthetic mp4 with/without `udta`, malformed payload, moov-at-end fallback also reaches `udta`.

#### Checkpoint A — Extractors

- [ ] `pnpm test src/lib/media-meta` green.
- [ ] `pnpm type-check` clean.
- [ ] Both extractors return `location: null` for inputs without GPS, never throw.

### Phase 2 — Cache shape

- **Slice 3: Extend `CachedMedia` + cron writer**
  - Add `location: { lat: number; lng: number } | null` and `place: string | null` to `CachedMedia` in `src/lib/cache/media-cache.ts`.
  - `FileMeta` and `extractFileMeta` in `refresh-memories.server.ts` gain `location`.
  - `fileToCachedMedia` writes `location` from extractor and `place: null` (geocoder fills it in Slice 5).
  - Update existing tests' `CachedMedia` literals; add a happy-path test asserting `location` is persisted.
  - Acceptance: `pnpm test src/lib/memories src/lib/cache` green.

#### Checkpoint B — Cache shape

- [ ] Tests green.
- [ ] Type errors point only at intended call sites (no accidental shape leaks).

### Phase 3 — Reverse geocoding (OpenCage)

- **Slice 4: OpenCage client (refined per the official OpenCage skill)**
  - New file: `src/lib/media-meta/opencage.server.ts`.
  - Export `reverseGeocode({ lat, lng }, { apiKey, signal? }): Promise<Result>` where `Result = { ok: true; place: string | null } | { ok: false; reason: 'auth' | 'suspended' | 'quota' | 'ratelimit' | 'server' | 'network' | 'parse' }`.
  - **Stay on raw `fetch`** rather than adding the `opencage-api-client` SDK. Consistent with `exif.ts` / `video-meta.ts` / `memory-route.server.ts`, and avoids the "ask first" dep gate per spec §7.
  - URL: `https://api.opencagedata.com/geocode/v1/json?key=${apiKey}&q=${encodeURIComponent(lat + ',' + lng)}&language=es&no_annotations=1&limit=1` — comma-separated reverse query per the OpenCage spec, properly encoded (the comma becomes `%2C`).
  - **Trust the body's `status.code` over the HTTP code** — the OpenCage skill explicitly notes that some proxies can obscure HTTP status. Pseudocode:
    1. `await fetch(url, { signal, headers: { Accept: 'application/json' } })` → `network` on reject.
    2. Try `await res.json()` → `parse` on throw.
    3. Read `data?.status?.code` (fall back to `res.status`).
    4. Map: 200 → process; 401 → auth; 402 → quota; 403 → suspended; 429 → ratelimit; 5xx → server; anything else → server.
    5. On 200: `total_results === 0 || results.length === 0` → `{ ok: true, place: null }`.
  - Component preference (apply optional chaining throughout — the skill warns that none of these fields are guaranteed):
    `components.city ?? components.town ?? components.village ?? components.municipality ?? components.county ?? components.state ?? null`.
    If non-null and `components.country` exists and the head doesn't already end with the country, return `${head}, ${country}`. Else return `head`. If all are null, fall back to `results[0].formatted ?? null`.
  - **Never log** request URL, response body, `place` value, lat, lng, or `status.message`. The cron caller logs counts and reasons only. Aborting via `signal` is safe — no timer left dangling on cancel.
  - Tests in `opencage.server.test.ts` (mock `globalThis.fetch`):
    - request URL: contains `q=${encodeURIComponent('40.4,-3.7')}` (comma, encoded), `key`, `language=es`, `no_annotations=1`, `limit=1`. Lat/lng come from inputs, not test keys.
    - status.code 200 + `components.city` + `components.country` → `{ ok: true, place: 'Madrid, España' }`.
    - prefers `town` when no `city`.
    - prefers `village` over nothing-else.
    - falls back to `formatted` when none of city/town/village/municipality/county/state are present.
    - status.code 200, `total_results: 0` → `{ ok: true, place: null }`.
    - status.code 200, `results: []` → `{ ok: true, place: null }`.
    - body says `status.code: 402` even on HTTP 200 → `{ ok: false, reason: 'quota' }` (proxy-obscured case).
    - HTTP 401 → `{ ok: false, reason: 'auth' }`.
    - HTTP 402 → `{ ok: false, reason: 'quota' }`.
    - HTTP 403 → `{ ok: false, reason: 'suspended' }`.
    - HTTP 429 → `{ ok: false, reason: 'ratelimit' }`.
    - HTTP 503 → `{ ok: false, reason: 'server' }`.
    - fetch rejects → `{ ok: false, reason: 'network' }`.
    - non-JSON response → `{ ok: false, reason: 'parse' }`.
    - on every above path: assert `console.log/info/warn/error` is never called with `place`, lat, lng, response body, or `status.message`. Spy on each console method and assert via `expect.not.stringMatching`.

- **Slice 5: Wire OpenCage into `refresh-memories.server.ts`**
  - After `processFile` writes the per-uuid entry, if `location !== null && place === null`, call `reverseGeocode` and `mediaCache.remember` again with `place` set.
  - Run geocode calls **sequentially** at the cron level (not per-file `Promise.all`). Spacing ≥1100ms between consecutive calls (1 req/sec is OpenCage's free-tier ceiling; small headroom).
  - Per-cron cap: env-configurable (`RECUERDEA_GEOCODE_MAX_PER_RUN`), default 200; remaining items stay `place: null` and pick up on the next run.
  - On `quota` or `ratelimit` reason: **stop the geocode pass immediately** for the rest of this run (no point hammering the API once the quota's gone). Subsequent files keep `place: null`. The next cron run will retry.
  - On `auth` or `suspended` reason: also stop and log a single warn — these don't fix themselves between calls.
  - Logs (counts only): `[refresh] geocoded N (capped at K)` and `[refresh] geocode failures: { auth, suspended, quota, ratelimit, server, network, parse }`. **Zero** log lines containing the cached place string or coordinates.
  - Tests in `refresh-memories.server.test.ts`:
    - happy path: file with GPS → geocode called → entry remembered with `place`.
    - GPS missing → geocode not called.
    - cached entry already has `place` → geocode not called.
    - rate-limit spacing enforced (use fake timers).
    - cap respected — items beyond cap remain `place: null`.
    - geocode failure categorized but no console output containing geo data.

#### Checkpoint C — Geocoding live

- [ ] Tests green.
- [ ] `OPENCAGE_API_KEY` set in Netlify (deploy-preview + production scopes).
- [ ] **Manually clear Blobs** (`media/*`, `fileid-index/*`, `folder/v1`) on the deploy preview before triggering the cron.
- [ ] Trigger `refresh-memories` once via Netlify dashboard.
- [ ] Inspect 2–3 Blobs entries: contain `location` + `place` (where applicable).
- [ ] Inspect cron logs: contain only counts, no coords or place strings.

### Phase 4 — UI projection

- **Slice 6: `MemoryItem.place` + Polaroid render**
  - `MemoryItem` gains `place: string | null` on both variants in `src/lib/memories/pcloud.server.ts`.
  - `buildMemoryItem` passes `meta.place` through.
  - `Polaroid.tsx`: replace `caption = captionFromName(item.name)` with `caption = item.place`. Existing `{caption && <Text>...}` guard handles `null`. **Delete** `captionFromName`.
  - `aria-label` becomes `item.place ?? 'Recuerdo'`.
  - Tests: `pcloud.server.test.ts` asserts `place` flows through; `Polaroid` rendering is verified visually (no test required for trivial render).

- **Slice 7: Lightbox header (Q4 default)**
  - In `Lightbox.tsx` header `HStack`, after the years-ago line, add `· {item.place}` when non-null.
  - `alt={item.name}` unchanged.
  - Manual: open lightbox on a GPS'd photo and a non-GPS'd photo; layout doesn't break either way.

### Phase 5 — Provider migration (Slice 8)

OpenCage was the implementation through Slices 4–7. Mid-build the team switched providers to **Geoapify** (better fit for the project's account / pricing). This phase swaps the geocoder module under the existing cron interface — no UI or schema changes.

- **Slice 8: Switch geocoder from OpenCage to Geoapify**
  - **API surface (Geoapify):**
    - Endpoint: `https://api.geoapify.com/v1/geocode/reverse`
    - Params: `lat`, `lon` (separate, not `q=lat,lng`), `lang=es`, `apiKey=${env}`. Optional `limit=1` (default), no explicit `format` (default JSON / GeoJSON FeatureCollection), no `type` (let Geoapify pick the most precise feature; we filter properties).
    - No headers required besides `Accept: application/json`.
  - **Response shape:**
    ```jsonc
    {
    	"features": [
    		{
    			"properties": {
    				"country": "España",
    				"country_code": "es",
    				"state": "Comunidad de Madrid",
    				"city": "Madrid",
    				"postcode": "...",
    				"formatted": "Madrid, España",
    				"result_type": "city" /* or country/state/postcode/street/amenity */,
    			},
    		},
    	],
    }
    ```
  - **Place picker:** prefer `properties.city ?? properties.state ?? null`; if non-null and `properties.country` is present and the head doesn't already end with the country, return `${head}, ${country}`. Fall back to `properties.formatted ?? null`. Empty `features` → `{ ok: true, place: null }`.
  - **Status mapping:** Geoapify uses HTTP status only (no `status.code` body). 401 → `auth`, 403 → `suspended`, 429 → `ratelimit` (covers both per-second rate limit and daily quota), 5xx + unexpected → `server`. Network reject → `network`. JSON parse throw → `parse`.
  - **Drop `quota` from the `FailureReason` union.** Geoapify doesn't distinguish quota from rate limit; merging keeps the union honest. `refresh-memories.server.ts`'s stop set + the cron's failures log shrink accordingly.
  - **Module rename:** `src/lib/media-meta/opencage.server.ts` → `geoapify.server.ts` (and its test). `ReverseGeocodeResult` + `reverseGeocode` keep the same names — only the implementation changes.
  - **Env var rename:** `OPENCAGE_API_KEY` → `GEOAPIFY_API_KEY` in `netlify/functions/refresh-memories.ts` + Netlify dashboard.
  - **Logging hygiene unchanged:** zero `console.*` with coords, place, response body, or HTTP message. Tests assert this on every path.
  - **Tests** (rewrite of `opencage.server.test.ts` → `geoapify.server.test.ts`):
    - Request URL contains `lat=`, `lon=`, `lang=es`, `apiKey=`.
    - `Accept: application/json` header.
    - Forwards `signal`.
    - Component preference: city → state → formatted → null.
    - Country dedup (`{ city: 'España', country: 'España' }` → `'España'`, not `'España, España'`).
    - Empty `features` → `{ ok: true, place: null }`.
    - HTTP 401 → auth. 403 → suspended. 429 → ratelimit. 503 → server. Unexpected (418) → server.
    - fetch reject → network. Non-JSON body → parse.
    - Console hygiene assertions on success + every failure path.

#### Checkpoint E — Migration done

- [ ] `pnpm test`, `pnpm type-check`, `pnpm format:check`, `pnpm build`, lint on changed files all green.
- [ ] `opencage.server.{ts,test.ts}` removed; `geoapify.server.{ts,test.ts}` in their place.
- [ ] `quota` no longer appears in any `FailureReason` union or summary log.
- [ ] `netlify/functions/refresh-memories.ts` reads `GEOAPIFY_API_KEY` and the `[refresh-memories]` summary log line drops the `quota=` field.

#### Checkpoint D — End-to-end

- [ ] `pnpm test`, `pnpm type-check`, `pnpm lint`, `pnpm format:check` all green.
- [ ] Local: `pnpm dev:netlify` + `pnpm invoke:refresh-memories`. Visit `/`. Polaroids show place captions where GPS was extracted; no captions otherwise.
- [ ] Deploy preview: same on real pCloud data.
- [ ] `curl -I https://<preview>/` confirms `Cache-Control: private` (or `no-store`) on home HTML.
- [ ] `SPEC.md` updated with §13 v6 acceptance criteria + v5 → v6 changes summary, including: Geoapify as dependency-free third-party, the manual Blobs-clear pre-flight, and the no-geo-logging rule.
- [ ] Open PR `v6-location → main`.

## Pre-flight (before merge)

- [ ] `GEOAPIFY_API_KEY` provisioned in Netlify env (deploy-preview scope first, then production on merge).
- [ ] Manually clear Blobs (`media/*`, `fileid-index/*`, `folder/v1`) on the deploy preview, then trigger cron once. Smoke `/` afterwards.
- [ ] On merge to `main`: clear Blobs in production, then trigger production cron once.

## Risks and mitigations

| Risk                                                             | Impact | Mitigation                                                                                                                                                                                                                |
| ---------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Geoapify 3,000/day free quota exceeded during one-time backfill  | Low    | ~1000 files; one cron pass fits inside one day's quota with 3× headroom. Per-cron cap (default 200) means even an unexpectedly large folder spreads across multiple days rather than burning the daily quota in one shot. |
| Geoapify outage during cron                                      | Low    | Failures categorized + counted, entries left with `place: null`, retried next run. Cron remains idempotent.                                                                                                               |
| MP4 GPS atom variants outside `udta.©xyz` (some Android cameras) | Low    | Documented gap; iPhone covers the user's case. Revisit if hit-rate disappoints.                                                                                                                                           |
| Spanish locale gaps in Geoapify results for some places          | Low    | Acceptable for v1; we can post-process if needed without changing the schema.                                                                                                                                             |
| Accidental log of `place` or coords                              | Med    | Lint-by-eye in PR review; tests assert no `console.*` calls receive geo data; doc the rule in `SPEC.md` boundaries.                                                                                                       |
| Blobs clear forgotten in production after merge                  | Med    | Listed twice in Pre-flight (preview + prod). Fail-loud: stale entries lack `location`/`place`, so users see the v5 (filename) caption — visible regression that triggers cleanup.                                         |

## Out of scope

- Browsable map view of memories.
- Geo-clustering ("photos near X").
- Showing place + filename together.
- Editing / overriding place per item.
- MP4 GPS atoms outside `udta.©xyz`.

## Post-merge follow-up (offer at completion, do not queue now)

- ~1 week post-merge: schedule a one-time agent that reads Blobs and reports the % of GPS'd entries with non-null `place`. If <90%, surface the address shapes OpenCage is failing on and decide whether to refine the component-preference order.
