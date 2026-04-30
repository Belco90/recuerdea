# Recuerdea v6 — Show capture location instead of filename caption

## Overview

Replace the polaroid caption (currently `captionFromName(item.name)`, the file's basename) with the **place where the photo/video was taken**, derived from the media's GPS metadata. The home page becomes "where + when" instead of "filename + when".

Branch: `v6-location` (to create from `main`). PR target: `main`. Cron remains the sole writer of the cache; loader stays read-only and zero-API.

## Resolved decisions (locked in)

| # | Decision | Outcome |
|---|---|---|
| Q1 | Reverse geocoding provider | **OpenCage Data API** (`https://api.opencagedata.com/geocode/v1/json`). Free tier: 2,500 req/day, 1 req/sec. Reads API key from `OPENCAGE_API_KEY` Netlify env var. Spanish output via `language=es`. |
| Q2 | Cache migration | **Clear Blobs manually before deploy.** No `schemaVersion` field. The cron rebuilds every entry on its first post-deploy run. (Slice 4 dropped vs the prior draft.) |
| Q3 | UI fallback when no place | Hide the caption entirely. No filename fallback, no "Sin ubicación" label. |
| Q4 | Lightbox header | Append place after the years-ago line (e.g. `2019 · hace 6 años · Madrid`). Hidden when null. |
| Q5 | Logging | **Never log any geo-derived data** — neither lat/lng, the OpenCage response, nor the resolved `place` string. Counts only (`[refresh] geocoded N/M`). |

## Confirmed assumptions

1. Caption is a short human-readable place string (e.g. "Madrid, España"); not raw coords; not a full street address.
2. Locale is Spanish (`language=es` to OpenCage).
3. Geocoding runs at cron time, not page time.
4. No-GPS / no-place items render with no caption.
5. `Lightbox` keeps `alt={item.name}` for a11y; only the *visible* header line uses `place`.
6. Existing cache cleared manually before deploy; no schema-version migration needed.

## Feasibility recap

| Source | Status | Notes |
|---|---|---|
| **JPEG / HEIC / TIFF (EXIF)** | ✅ `exifr` already in deps | Add `latitude` / `longitude` to requested tags. |
| **MP4 / MOV (Apple)** | ✅ extends existing `moov` walker | iPhone records GPS as ISO 6709 in `moov.udta.©xyz`. |
| **MP4 / MOV (other cameras)** | ⚠️ best-effort, degrades to `null` | Only `udta.©xyz` supported in v6; revisit if hit-rate is poor. |
| **Older / scanned photos** | ❌ no GPS → no caption | Per Q3. |

## Architecture

- **Two-stage extraction at cron time, both cached on `CachedMedia`:**
  1. Raw `location: { lat, lng } | null` from EXIF / `©xyz`.
  2. Display `place: string | null` from OpenCage. Stage 2 only runs when stage 1 succeeds **and** there's no cached `place` yet, so a flaky geocode call retries on the next cron run without re-doing the rest of the work.
- `place` is a denormalized display string. Structured data is not exposed to the browser; if we ever need city/country separately we still have `lat`/`lng` to re-derive.
- Reverse-geocoding is server-only (cron only). Loader and `/api/memory/...` route never call OpenCage.
- No new top-level dep: OpenCage is a plain HTTPS GET. Net new env var: `OPENCAGE_API_KEY`.
- Loader hot path unchanged: `MemoryItem` gains a `place: string | null` field; everything else is identical.

## Dependency graph

```
exif.ts (image GPS)        video-meta.ts (mp4 GPS)
        \                        /
         \                      /
          v                    v
     opencage.server.ts (reverse geocode, sequential, capped)
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

- **Slice 4: OpenCage client**
  - New file: `src/lib/media-meta/opencage.server.ts`.
  - Export `reverseGeocode({ lat, lng }, { apiKey, signal? }): Promise<string | null>`.
  - URL: `https://api.opencagedata.com/geocode/v1/json?q=${lat}+${lng}&key=${apiKey}&language=es&no_annotations=1&limit=1`.
  - Parse `results[0].components`. Display string preference order:
    `city || town || village || municipality || county || state` then append `, ${country}` if present and not already a duplicate.
    Fall back to `results[0].formatted` if no useful component exists. Fall back to `null` if no results.
  - Treat 401 / 402 / 429 / 5xx / network errors / malformed JSON as `null` (no throw).
  - **Never log** request URL, response body, lat/lng, or returned string. Only log a category on failure (`auth | quota | server | network`) and a count on success.
  - Tests in `opencage.server.test.ts`:
    - mocked OK → returns "City, Country".
    - prefers town when no city.
    - falls back to `formatted` when no useful component.
    - 4xx/5xx → `null`.
    - fetch throws → `null`.
    - request URL has correct query params + key + `language=es`.
    - on success/failure, no `console.log/info/warn/error` is called with the response or coords.

- **Slice 5: Wire OpenCage into `refresh-memories.server.ts`**
  - After `processFile` writes the per-uuid entry, if `location !== null && place === null`, call `reverseGeocode` and `mediaCache.remember` again with `place` set.
  - Run geocode calls **sequentially** at the cron level (not per-file `Promise.all`). Spacing ≥1100ms between consecutive calls (1 req/sec is OpenCage's free-tier ceiling; small headroom).
  - Per-cron cap: env-configurable, default 200; remaining items stay `place: null` and pick up on the next run.
  - Logs (counts only): `[refresh] geocoded N (capped at K)` and `[refresh] geocode failures: { auth: x, quota: y, server: z, network: w }`. **Zero** log lines containing the cached place string or coordinates.
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

#### Checkpoint D — End-to-end
- [ ] `pnpm test`, `pnpm type-check`, `pnpm lint`, `pnpm format:check` all green.
- [ ] Local: `pnpm dev:netlify` + `pnpm invoke:refresh-memories`. Visit `/`. Polaroids show place captions where GPS was extracted; no captions otherwise.
- [ ] Deploy preview: same on real pCloud data.
- [ ] `curl -I https://<preview>/` confirms `Cache-Control: private` (or `no-store`) on home HTML.
- [ ] `SPEC.md` updated with §13 v6 acceptance criteria + v5 → v6 changes summary, including: OpenCage as dependency-free third-party, the manual Blobs-clear pre-flight, and the no-geo-logging rule.
- [ ] Open PR `v6-location → main`.

## Pre-flight (before merge)

- [ ] `OPENCAGE_API_KEY` provisioned in Netlify env (deploy-preview scope first, then production on merge).
- [ ] Manually clear Blobs (`media/*`, `fileid-index/*`, `folder/v1`) on the deploy preview, then trigger cron once. Smoke `/` afterwards.
- [ ] On merge to `main`: clear Blobs in production, then trigger production cron once.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| OpenCage 2,500/day free quota exceeded during one-time backfill | Low | ~1000 files; one cron pass fits inside one day's quota with 1.5× headroom. Per-cron cap (default 200) means even an unexpectedly large folder spreads across multiple days rather than burning the daily quota in one shot. |
| OpenCage outage during cron | Low | Failures categorized + counted, entries left with `place: null`, retried next run. Cron remains idempotent. |
| MP4 GPS atom variants outside `udta.©xyz` (some Android cameras) | Low | Documented gap; iPhone covers the user's case. Revisit if hit-rate disappoints. |
| Spanish locale gaps in OpenCage results for some places | Low | Acceptable for v1; we can post-process if needed without changing the schema. |
| Accidental log of `place` or coords | Med | Lint-by-eye in PR review; tests assert no `console.*` calls receive geo data; doc the rule in `SPEC.md` boundaries. |
| Blobs clear forgotten in production after merge | Med | Listed twice in Pre-flight (preview + prod). Fail-loud: stale entries lack `location`/`place`, so users see the v5 (filename) caption — visible regression that triggers cleanup. |

## Out of scope

- Browsable map view of memories.
- Geo-clustering ("photos near X").
- Showing place + filename together.
- Editing / overriding place per item.
- MP4 GPS atoms outside `udta.©xyz`.

## Post-merge follow-up (offer at completion, do not queue now)

- ~1 week post-merge: schedule a one-time agent that reads Blobs and reports the % of GPS'd entries with non-null `place`. If <90%, surface the address shapes OpenCage is failing on and decide whether to refine the component-preference order.
