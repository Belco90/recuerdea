# Recuerdea v6 — Task list (location-as-caption)

See `tasks/plan.md` for full context. All open questions resolved (OpenCage, manual Blobs clear, hide caption when no place, lightbox appends place, never log geo data).

## Pre-flight

- [ ] Sign up for OpenCage Data, generate an API key on the free tier.
- [ ] Add `OPENCAGE_API_KEY` to Netlify env (deploy-preview scope first; production on merge).
- [x] Create branch `v6-location` from `main`.

## Slice 1 — Image GPS via `exifr` — `62c468c`

- [x] In `src/lib/media-meta/exif.ts`:
  - [x] Extend `ImageMeta` with `location: { lat: number; lng: number } | null`.
  - [x] Add `latitude`, `longitude` to `TAG_NAMES` and the `ExifTags` type.
  - [x] Add `pickLocation(tags)` helper: both finite, lat ∈ [-90, 90], lng ∈ [-180, 180]; otherwise null.
  - [x] Update `EMPTY` constant.
- [x] Tests in `exif.test.ts`:
  - [x] present → returns `{ lat, lng }`.
  - [x] missing → null.
  - [x] one of lat/lng missing → null.
  - [x] NaN / out-of-range → null.
  - [x] exifr throws → `location: null`, no exception.

**Verified:** `pnpm test` (130/130), `pnpm type-check`, `pnpm format:check`, `pnpm build` all green. Lint on the three changed files: 0/0.

## Slice 2 — Video GPS via `udta.©xyz` — `18dd94b`

- [x] In `src/lib/media-meta/video-meta.ts`:
  - [x] Extend `VideoMeta` with `location: { lat: number; lng: number } | null`.
  - [x] In `parseMoov`, call new `findUdtaXyz` walker.
  - [x] `findUdtaXyz`: walks `moov` children for `udta`, then `udta` children for `©xyz` via a new `walkForCopyrightBox` (the existing `walkForBox` uses ASCII type matching, which can't represent `0xA9`).
  - [x] `parseIso6709(string)`: regex per plan; reject non-finite or out-of-range.
  - [x] Update `EMPTY` and `parseMoov` return value (`scanForMoov` reuses `parseMoov`).
- [x] Tests in `video-meta.test.ts`:
  - [x] synthetic mp4 with `moov.udta.©xyz` of `+40.4378-003.7036+660.000/` → ~Madrid.
  - [x] without altitude (`+40.4378-003.7036/`) — also accepted.
  - [x] mp4 without `udta` → location null.
  - [x] mp4 with `udta` but no `©xyz` (other `©cmt` atom) → location null.
  - [x] malformed payload → location null.
  - [x] out-of-range latitude (`+91`) → location null.
  - [x] moov-at-end fallback also reaches `udta`.

**Verified:** `pnpm test` (137/137), `pnpm type-check`, `pnpm build` all green. Lint on changed files: 0/0.

## Checkpoint A — Extractors

- [ ] `pnpm test src/lib/media-meta` green.
- [ ] `pnpm type-check` clean.
- [ ] No extractor throws on any input shape.

## Slice 3 — Extend `CachedMedia` + cron writer — `6b75ea4`

- [x] In `src/lib/cache/media-cache.ts`: add `location: { lat: number; lng: number } | null` and `place: string | null` to `CachedMedia`.
- [x] In `src/lib/memories/refresh-memories.server.ts`:
  - [x] Extend `FileMeta` and `extractFileMeta` with `location`.
  - [x] `fileToCachedMedia` writes `location` from extractor and `place: null`.
- [x] Update existing `CachedMedia` literals in 5 test files: `media-cache.test.ts`, `media-cache.server.test.ts`, `pcloud.server.test.ts`, `memory-route.server.test.ts`, `refresh-memories.server.test.ts` (6 fixture sites).
- [x] Add happy-path tests: file with GPS via image extractor → location persisted; same via video extractor.

**Verified:** `pnpm test` (139/139), `pnpm type-check`, `pnpm format:check`, `pnpm build` all green. Lint on 7 changed files: 0/0.

## Checkpoint B — Cache shape ✅

- [x] All previously-green tests still green after literal updates.
- [x] Type errors are localized to intentional call sites only.

## Slice 4 — OpenCage client (raw fetch, refined per official OpenCage skill) — `05d1835`

- [x] New file `src/lib/media-meta/opencage.server.ts`:
  - [x] Signature: `reverseGeocode({ lat, lng }, { apiKey, signal? }) → ReverseGeocodeResult`.
  - [x] URL via `URLSearchParams` — comma in `q` becomes `%2C` after encoding.
  - [x] Authoritative status from `body.status.code`, fall back to `res.status`.
  - [x] Status mapping: 200 → success, 401 → auth, 402 → quota, 403 → suspended, 429 → ratelimit, 5xx + unexpected → server.
  - [x] Success path: `city ?? town ?? village ?? municipality ?? county ?? state`, append `, country` (deduped), fall back to `formatted`, then `null`.
  - [x] Network reject → network. JSON parse throw → parse.
  - [x] `Accept: application/json` header set. No User-Agent.
  - [x] Zero `console.*` calls anywhere on this module's path.
- [x] 25 tests in `opencage.server.test.ts` covering: URL shape (4), component preference (10), status mapping (8), and console hygiene (2).

**Verified:** 164/164 pnpm test, type-check, format:check, build all green; lint on the two new files: 0/0.

## Slice 5 — Wire OpenCage into the cron — `36fc4d2`

- [x] `refreshMemories` accepts an optional `geocodeOpts: { apiKey, cap?, sleepMs?, sleep?, geocoder? }`. Defaults: cap 200, sleepMs 1100, real `setTimeout`, real `reverseGeocode`.
- [x] Geocode pass runs sequentially after the folder snapshot is written.
- [x] Spacing: `await sleep(sleepMs)` between consecutive calls (not before first, not after last).
- [x] Cap respected; items beyond cap counted as `geocodeCapped`.
- [x] On success + non-null place: re-write cache entry. On success + null place: no-op (no second write).
- [x] `quota` / `ratelimit` → stop pass. `auth` / `suspended` → stop + warn once (no coords/message).
- [x] `server` / `network` / `parse` → counted, pass continues.
- [x] Disabled `no-await-in-loop` for the sequential loop with a why-comment.
- [x] Netlify entrypoint reads `OPENCAGE_API_KEY` and `RECUERDEA_GEOCODE_MAX_PER_RUN`; warns once when key is missing; logs counts + failures summary.
- [x] 10 new tests; full suite 175/175 green.

**Verified:** `pnpm test`, `pnpm type-check`, `pnpm format:check`, `pnpm build`, lint on 3 changed files all green.

## Checkpoint C — Geocoding live (deploy preview)

- [ ] Push branch; deploy preview built.
- [ ] In Netlify dashboard, **clear Blobs** for the deploy-preview context: `media/*`, `fileid-index/*`, `folder/v1`. (Verify they're empty.)
- [ ] Trigger `refresh-memories` once via Netlify dashboard.
- [ ] Inspect 3+ `media/<uuid>` Blobs entries: contain `location` (where GPS exists) and `place` (where geocoded).
- [ ] Inspect cron function logs: only summary counts. No coords, no place strings, no OpenCage URLs.
- [ ] Re-trigger cron: `geocoded` count should be 0 (everything already has `place` or no `location`).

## Slice 6 — `MemoryItem.place` + Polaroid render — `a515013`

- [x] `MemoryItem` gains `place: string | null` on both variants; `buildMemoryItem` passes `meta.place`.
- [x] `pcloud.server.test.ts`: existing fixtures updated; new test asserts place flow.
- [x] `Polaroid.tsx`: caption = `item.place`; aria-label = `item.place ?? 'Recuerdo'`; `captionFromName` deleted.
- [x] `memory-grouping.test.ts`: MemoryItem literals updated.

**Verified:** 176/176 pnpm test, type-check, format:check, build all green; lint on 4 changed files: 0/0.

## Slice 7 — Lightbox header

- [ ] In `src/components/Lightbox.tsx` header `HStack`:
  - [ ] After the `yearsAgoLowercase` span, render `· {item.place}` only when `item.place` is non-null. Use the same mono caps styling as the surrounding text.
- [ ] `alt={item.name}` stays unchanged for a11y.
- [ ] Manual smoke: open lightbox on a GPS'd item then on a non-GPS'd item; both layouts intact.

## Checkpoint D — End-to-end

- [ ] `pnpm test`, `pnpm type-check`, `pnpm lint`, `pnpm format:check` all green.
- [ ] Local smoke: `pnpm dev:netlify` → `pnpm invoke:refresh-memories` → visit `/`. Polaroids show place captions where extracted; no captions otherwise.
- [ ] Deploy-preview smoke on real data after Checkpoint C cron pass.
- [ ] `curl -I https://<preview>/` confirms `Cache-Control: private` (or `no-store`).
- [ ] Update `SPEC.md`:
  - [ ] §13 v6 acceptance criteria.
  - [ ] v5 → v6 changes summary.
  - [ ] "Always do" — never log geo-derived data.
  - [ ] "Ask first" — adding any new geocoding provider.
  - [ ] §4 project structure adds `opencage.server.ts`.
  - [ ] §8 open question on geocoder marked resolved (OpenCage).
- [ ] Open PR `v6-location → main`.

## Production cutover (post-PR-merge)

- [ ] `OPENCAGE_API_KEY` set in production env scope.
- [ ] Clear Blobs in production: `media/*`, `fileid-index/*`, `folder/v1`.
- [ ] Trigger production cron once via Netlify dashboard. Wait for completion.
- [ ] Visit `https://<prod>/` and confirm captions render.

## Post-merge follow-up

- Offer to schedule a one-time agent ~1 week post-merge to:
  - Read Blobs and report % of GPS'd entries with non-null `place`.
  - If <90%, identify which OpenCage component shapes are failing the preference order.
