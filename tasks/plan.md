# Recuerdea v7 — Smaller media in timeline + lightbox; full size on download

## Overview

Today every `<img>` and `<video poster>` in the home page fetches `getpubthumb?size=2048x1024`, and the lightbox download button hands users that same 2048-px JPEG instead of the original. The polaroid grid renders ≤270 px wide tiles in 4 columns, so we are shipping ~6× more pixels than we display, on every tile, on every visit.

This plan rewires `/api/memory/<uuid>` so that:

1. **Polaroid grid** (images and video posters) loads a small pCloud thumbnail (`?variant=thumb`).
2. **Lightbox** uses the **same** small thumbnail for on-screen image slides and for the video `poster` attribute (`?variant=thumb`). Mobile is the primary target — 640 px wide is plenty.
3. **Video playback** in the lightbox keeps the existing range-streamed `?variant=stream`.
4. **Download buttons** (lightbox header) hand users the **original file** byte-for-byte (`?variant=download`, served via `getpublinkdownload` for both images and videos, with `Content-Disposition: attachment`).
5. The old `?variant=image` and `?variant=poster` are **removed** — no caller in our UI after this PR, and removing them keeps the route surface minimal.

Cache shape, cron, public-link lifecycle, and auth gate are unchanged. This is a route + UI change only.

Branch: `v7-thumbs` (to create from `main`). PR target: `main`.

## Resolved decisions

| #   | Decision                                                                                                                           | Outcome                                                                                                                                                                                                                                                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q1  | Thumb size                                                                                                                         | **`size=640x640`**, mobile-first per user's explicit answer. Acceptable on desktop fullscreen too — the existing 2K source is way oversampled.                                                                                                                                                                                       |
| Q2  | Lightbox image quality                                                                                                             | **Use the same `thumb` everywhere.** No separate "lightbox-only" larger variant. Mobile fullscreen ≤ 640 px CSS px ≈ 640–1280 device px depending on DPR, which the 640×640 thumbnail covers comfortably. Desktop fullscreen will look softer than today; user has signed off on this trade.                                          |
| Q3  | `?variant=image` and `?variant=poster`                                                                                             | **Remove both** in the same PR that adds `thumb` and `download`. No caller in our UI after the swap. Brief deploy window where in-flight requests from the previously-rendered HTML may 400; acceptable for a single-user app and resolved by reload.                                                                               |
| Q4  | Download for images + videos                                                                                                       | **Original file via `getpublinkdownload`**, same indirection used for video stream. Returns the raw HEIC/JPEG/MP4/MOV the user uploaded. The route sets `Content-Disposition: attachment; filename*=UTF-8''<encoded-name>`.                                                                                                          |
| Q5  | Video element lifecycle in the timeline                                                                                            | **Already correct.** `Polaroid.tsx` only renders an `<img>`. The `<video>` element only mounts inside `Lightbox.tsx`'s carousel slides, with `preload={i === idx ? 'metadata' : 'none'}` and `autoPlay` on the active slide. We will assert this in verification but not change the code path.                                       |
| Q6  | unpic-img + Netlify Image CDN                                                                                                      | **Deferred to a follow-up.** New top-level dep needs SPEC §7 "ask first" approval; Netlify Image CDN forwarding Identity cookies through to our auth-gated origin is unverified. v7 ships pCloud-side size shrink only.                                                                                                              |
| Q7  | Cache-Control for `thumb`                                                                                                          | `private, max-age=86400, immutable`. Hash is part of the cron's invalidation key, so on content change the cron mints a new uuid (rename) or refreshes the entry under the same uuid (hash mismatch). Browser cache is keyed on the URL `(uuid, variant)`.                                                                          |
| Q8  | Cache-Control for `download`                                                                                                       | `private, max-age=0, no-store`. Downloads are one-shot; we do not want a stale cached response if the user re-downloads after a content edit.                                                                                                                                                                                       |

## Confirmed assumptions

1. pCloud's `getpubthumb` accepts `size=640x640` and returns a JPEG/PNG that fits within those bounds while preserving aspect ratio. (Same family as the working `2048x1024`; if 640×640 is rejected in practice, fall back to the documented `512x512`.)
2. `getpublinkdownload({ code })` works for both images and videos. The cache entry already has `code` for both kinds.
3. `Content-Disposition: attachment` from a same-origin response triggers a browser save regardless of `<a download>` / `target="_blank"`. The existing markup is kept as belt-and-braces.
4. `meta.name` may contain accents/emoji; use `filename*=UTF-8''<encodeURIComponent>` per RFC 5987 plus an ASCII `filename="<sanitised>"` fallback.
5. The browser's HTTP cache for the previously-deployed `?variant=image|poster` URLs may briefly serve until a hard reload — fine for a single-user app.
6. No SPEC change required. §11 acceptance criteria (auth-gated, byte-streamed, public-link URL stays server-side) continue to hold.

## Architecture

### Variants on `/api/memory/<uuid>?variant=…`

| Variant      | Used by                                                          | Upstream                                                  | Cache-Control                          | Disposition  |
| ------------ | ---------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------- | ------------ |
| `thumb` 🆕    | `Polaroid` + `Lightbox` image slides + `<video poster>`          | `getpubthumb?code=…&size=640x640`                          | `private, max-age=86400, immutable`    | inline       |
| `stream`     | `Lightbox` video slides *(unchanged)*                            | `getpublinkdownload` → CDN host *(unchanged)*              | `private, max-age=60`                  | inline       |
| `download` 🆕 | `Lightbox` header download button (both kinds)                   | `getpublinkdownload` → CDN host (same path as `stream`)    | `private, max-age=0, no-store`         | attachment   |
| ~~`image`~~  | — (removed)                                                       | —                                                         | —                                      | —            |
| ~~`poster`~~ | — (removed)                                                       | —                                                         | —                                      | —            |

`defaultVariant(kind)` becomes `kind === 'video' ? 'stream' : 'thumb'`.

`download` reuses `streamFromUpstream` and the existing `resolveStreamUrl` injection point — adding `Content-Disposition` is a header-set on the response we already build. The request `Range` header is **not** forwarded for `download`, and the response is forced to status 200 (drop any upstream 206 + `content-range`) since downloads are one-shot.

### Component changes

- `src/components/Polaroid.tsx` — single `?variant=thumb` URL for both image and video kinds. The `<Play>` "VÍDEO" badge is unchanged.
- `src/components/Lightbox.tsx` — image slides switch from `?variant=image` to `?variant=thumb`. `<video poster>` switches from `?variant=poster` to `?variant=thumb`. `<video src>` keeps `?variant=stream`. `getDownloadHref` returns `?variant=download`.

## Task list

### Phase 1 — Backend: replace variants

#### Task 1: Reshape `MediaVariant` → `'thumb' | 'stream' | 'download'`

**Description:** Single coherent route change. Add `thumb` (640×640) and `download` (attachment via `getpublinkdownload`); remove `image` and `poster`. Update tests to match the new variant set.

**Acceptance criteria:**

- [ ] `MediaVariant = 'thumb' | 'stream' | 'download'`.
- [ ] `VARIANTS = ['thumb', 'stream', 'download'] as const`.
- [ ] `CACHE_CONTROL = { thumb: 'private, max-age=86400, immutable', stream: 'private, max-age=60', download: 'private, max-age=0, no-store' }`.
- [ ] `buildThumbUrl(code)` produces `https://eapi.pcloud.com/getpubthumb?code=<encoded>&size=640x640`.
- [ ] `defaultVariant(kind)` returns `'stream'` for video, `'thumb'` for image.
- [ ] `?variant=thumb` → fetch `buildThumbUrl(meta.code)` and pipe via `streamFromUpstream`. Forward request `Range` header (consistent with today's image/poster behaviour).
- [ ] `?variant=stream` → unchanged: `resolveStreamUrl`, forward `Range`, propagate 206 + `content-range`.
- [ ] `?variant=download` → `resolveStreamUrl(meta.code)`, **do not** forward `Range`, force response status `200` (strip upstream `content-range`), set `Content-Disposition: attachment; filename*=UTF-8''<encodeURIComponent(meta.name)>; filename="<asciiFallback>"`.
- [ ] `?variant=image` and `?variant=poster` now return `400 invalid variant` (same path the existing 400 test uses).
- [ ] `code` continues to be `encodeURIComponent`-encoded in the upstream URL (defence against odd characters; existing test guards this).

**Verification:**

- [ ] `pnpm test src/lib/memories/memory-route.server.test.ts` — passes.
- [ ] Tests updated:
  - [ ] Existing "default for kind=image" test → asserts `getpubthumb…&size=640x640`.
  - [ ] Existing "explicit poster on a video" test → rewritten to "explicit thumb on a video → `getpubthumb…&size=640x640`".
  - [ ] Existing "encodes the code" test → asserts the new size in the URL.
  - [ ] **New** test: `?variant=download` (image kind) → calls `resolveStreamUrl`, no Range forwarded to `fetchBytes`, response has `Content-Disposition: attachment`, `cache-control` includes `no-store`, status 200.
  - [ ] **New** test: `?variant=download` (video kind) → same flow.
  - [ ] **New** test: `meta.name` containing spaces/accents/emoji is encoded in `filename*=UTF-8''…` and the ASCII `filename="…"` fallback is sanitised (no quote chars, no control chars).
  - [ ] **New** test: even when the request includes `range: bytes=…`, `fetchBytes` is called with `null` for `download`.
  - [ ] **New** test: when upstream returns 206 + `content-range` for a `download` request, the response from our handler is status 200 with no `content-range` header.
  - [ ] **New** test: `?variant=image` → 400; `?variant=poster` → 400.
- [ ] `pnpm type-check`.
- [ ] `pnpm lint`.
- [ ] `pnpm build`, then delete `dist/` + `.netlify/` cache (per SPEC §7).

**Dependencies:** None.

**Files likely touched:**

- `src/lib/memories/memory-route.server.ts`
- `src/lib/memories/memory-route.server.test.ts`

**Estimated scope:** S (1 file + 1 test file, but a meaningful rewrite of the test fixtures).

---

### Checkpoint A — Backend ready

- [ ] `pnpm test`, `pnpm type-check`, `pnpm lint`, `pnpm build` all pass; `dist/` + `.netlify/` cache wiped.
- [ ] Manual curl on `pnpm dev`:
  - [ ] `curl -I http://localhost:3000/api/memory/<uuid>?variant=thumb` → 200, content-type image/jpeg, content-length much smaller than today's `?variant=image` baseline (capture both for the PR description).
  - [ ] `curl -I http://localhost:3000/api/memory/<uuid>?variant=download` → 200, `content-disposition: attachment`, `cache-control: private, max-age=0, no-store`.
  - [ ] `curl -I http://localhost:3000/api/memory/<uuid>?variant=image` → 400.
  - [ ] `curl -I http://localhost:3000/api/memory/<uuid>?variant=poster` → 400.

---

### Phase 2 — Frontend wiring

#### Task 2: `Polaroid` uses `?variant=thumb`

**Description:** Replace the kind-conditional URL in `Polaroid.tsx` with a single `?variant=thumb`. Visual output is unchanged at 1× DPR; on 2–3× DPR tiles may look a hair softer than today (today's 2K source is heavily oversampled). Compare on the deploy preview before merging.

**Acceptance criteria:**

- [ ] `photoSrc` is `\`/api/memory/${item.uuid}?variant=thumb\`` for both kinds.
- [ ] `<Play>` "VÍDEO" badge still renders when `kind === 'video'`.
- [ ] No new props or layout changes.

**Verification:**

- [ ] `pnpm dev` → home route loads, grid renders, aspect ratios driven by `width`/`height` (unchanged).
- [ ] DevTools → Network: every grid tile request is `?variant=thumb`, total weight an order of magnitude lighter than `main`.

**Dependencies:** Task 1.

**Files likely touched:** `src/components/Polaroid.tsx`.

**Estimated scope:** XS.

---

#### Task 3: `Lightbox` uses `?variant=thumb` for stills + posters; `?variant=download` for downloads

**Description:** Lightbox image carousel slides switch from `?variant=image` to `?variant=thumb`. `<video poster>` switches from `?variant=poster` to `?variant=thumb`. `<video src>` keeps `?variant=stream` (unchanged). `getDownloadHref` returns `?variant=download`.

**Acceptance criteria:**

- [ ] `<Image src>` on image slides → `\`/api/memory/${it.uuid}?variant=thumb\``.
- [ ] `<video poster>` → `\`/api/memory/${it.uuid}?variant=thumb\``.
- [ ] `<video src>` → `\`/api/memory/${it.uuid}?variant=stream\`` (unchanged).
- [ ] `getDownloadHref(uuid)` returns `\`/api/memory/${uuid}?variant=download\``.
- [ ] `<a download target="_blank" rel="noopener noreferrer">` markup unchanged.

**Verification:**

- [ ] Manual smoke on `pnpm dev`:
  - [ ] Open lightbox on an image — image fills the viewport from the small thumb. Acceptable softness at desktop fullscreen per Q1/Q2.
  - [ ] Open lightbox on a video — poster shows from the thumb; pressing play streams via `?variant=stream`.
  - [ ] Click download on an image → the saved file is the **original** (HEIC / large JPEG / PNG), not a 2K JPEG.
  - [ ] Click download on a video → the saved file is the **original** MP4/MOV.
  - [ ] DevTools → Network for the download: `Content-Disposition: attachment`, `Cache-Control: …no-store`.

**Dependencies:** Task 1.

**Files likely touched:** `src/components/Lightbox.tsx`.

**Estimated scope:** XS.

---

### Checkpoint B — End-to-end on the deploy preview

- [ ] PR opened from `v7-thumbs` → `main`. Netlify spins a deploy preview.
- [ ] Trigger the cron once via the Netlify dashboard (no cache-shape change; sanity step).
- [ ] Smoke `/` while logged in:
  - [ ] Timeline tiles load fast; Network panel shows only `?variant=thumb` for grid tiles.
  - [ ] No `<video>` element appears in the timeline DOM (DevTools → Elements).
  - [ ] Open the lightbox, swipe a year. Active slide loads video; non-active slides do not (`preload="none"`).
  - [ ] Image + video downloads return originals with attachment disposition.
  - [ ] No requests in the Network panel reference `?variant=image` or `?variant=poster`.
- [ ] `curl -I https://<preview>.netlify.app/` still shows `Cache-Control: private` (per SPEC §7).
- [ ] Lighthouse perf delta on `/` noted in the PR description (target: ≥ +10 on a 12-tile day; not a hard gate).

---

### Phase 3 — Ship

#### Task 4: Merge + prod smoke

**Description:** Standard merge checklist. No production data migration; no SPEC update.

**Acceptance criteria:**

- [ ] PR description includes before/after Network HAR weights for a representative day.
- [ ] CI green (`type-check`, `test`, `lint`, `format-check`).
- [ ] Reviewer signs off on visual diff at 1× and 2× DPR (mobile-first, per Q1).

**Verification:**

- [ ] After merge, smoke prod `/` once. Repeat the lightbox + download checks from Checkpoint B against the prod URL.
- [ ] File a follow-up issue for the deferred unpic-img + Netlify Image CDN spike.

**Dependencies:** Tasks 1–3.

**Files likely touched:** none (process step).

**Estimated scope:** XS.

---

## Risks and mitigations

| Risk                                                                                                                      | Impact | Mitigation                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pCloud rejects `size=640x640` (size grid quirk).                                                                          | Med    | Fall back to `512x512` (documented, widely used). Decision happens during Task 1 verification (curl returns non-2xx ⇒ swap the constant).                                                                                                            |
| 640-px source looks too soft at desktop fullscreen in the lightbox.                                                       | Low    | User explicitly accepts a mobile-first trade. If desktop softness is unbearable post-launch, the cheap fix is a second `image` variant at 1024×1024 (re-add); we'd revisit only after observed user feedback.                                        |
| `Content-Disposition: attachment` causes Safari to drop `target="_blank"` and replace the page.                            | Low    | Same-origin attachment downloads do not navigate. The existing `<a download>` is the failsafe.                                                                                                                                                        |
| `meta.name` contains characters that break a `filename=` header.                                                           | Low    | RFC 5987 `filename*=UTF-8''<encodeURIComponent>` plus a sanitised ASCII `filename="…"` fallback.                                                                                                                                                      |
| In-flight requests from a still-loading user tab keep hitting `?variant=image` / `?variant=poster` after deploy and 400.   | Low    | Single-user app; reload fixes it. Documented in §6 of confirmed assumptions.                                                                                                                                                                          |
| Adding `?variant=download` raises Netlify bandwidth if originals are large and downloads spike.                            | Low    | Same upstream pipe as today's `stream`. Download is a manual user action, not auto-fired. Monitor Netlify bandwidth post-launch.                                                                                                                      |

## Open questions

1. **Is `640x640` accepted by `getpubthumb`?** Resolves during Task 1 verification (curl real pCloud, eyeball the output). Prep alternative: `512x512` if 640 is rejected.
2. **`@unpic/react` + Netlify Image CDN spike** (deferred). Open as a follow-up issue with: (a) verify Netlify Image CDN forwards Identity cookies to the auth-gated origin, (b) prototype `<Image cdn="netlify">` against the `thumb` variant, (c) measure DPR-aware `srcSet` win vs the v7 baseline. Needs SPEC §7 "ask first" approval for the new dep.
