# v7 — Smaller media thumbs + true-original download — todo

Slice-by-slice checklist mirroring `plan.md`. Tick boxes as work lands. Each phase ends with an explicit checkpoint.

## Phase 1 — Backend: replace variants

### Task 1 — Reshape `MediaVariant` → `'thumb' | 'stream' | 'download'`

- [ ] `src/lib/memories/memory-route.server.ts`
  - [ ] Update `MediaVariant` type: `'thumb' | 'stream' | 'download'`.
  - [ ] Update `VARIANTS = ['thumb', 'stream', 'download'] as const`.
  - [ ] Update `CACHE_CONTROL`:
    - [ ] `thumb: 'private, max-age=86400, immutable'`
    - [ ] `stream: 'private, max-age=60'` _(unchanged)_
    - [ ] `download: 'private, max-age=0, no-store'`
  - [ ] Update `buildThumbUrl` to use `&size=640x640`.
  - [ ] Update `defaultVariant(kind)` to return `'thumb'` for image, `'stream'` for video.
  - [ ] In `handleMemoryRequest`:
    - [ ] `variant === 'thumb'` → `buildThumbUrl(meta.code)` + `streamFromUpstream` with the request `Range` forwarded (current behaviour for image/poster).
    - [ ] `variant === 'stream'` → unchanged.
    - [ ] `variant === 'download'`:
      - [ ] Resolve URL via `resolveStreamUrl(meta.code)`.
      - [ ] Call `fetchBytes(url, null)` (do **not** forward `Range`).
      - [ ] Build the response with `Content-Disposition: attachment; filename*=UTF-8''<encodeURIComponent(meta.name)>; filename="<asciiFallback>"`.
      - [ ] Force status `200`; do not propagate upstream `content-range`.
- [ ] `src/lib/memories/memory-route.server.test.ts`
  - [ ] Rewrite "image (default for kind=image) → fetches getpubthumb URL" → asserts `…&size=640x640`.
  - [ ] Rewrite "explicit variant=poster on a video → fetches getpubthumb" → "explicit variant=thumb on a video → `…&size=640x640`".
  - [ ] Update "encodes the code in the upstream URL" assertion to use `&size=640x640`.
  - [ ] Add: `?variant=download` (image) → calls `resolveStreamUrl`; `fetchBytes` called with `null` for range; response has `Content-Disposition: attachment`, `cache-control: …no-store`, status 200.
  - [ ] Add: `?variant=download` (video) → same flow.
  - [ ] Add: filename encoding test (spaces / accents / emoji → RFC 5987 + ASCII fallback).
  - [ ] Add: `?variant=download` ignores request `range: bytes=…` header.
  - [ ] Add: `?variant=download` strips upstream 206 + `content-range` and returns 200.
  - [ ] Add: `?variant=image` → 400; `?variant=poster` → 400.
- [ ] `pnpm test src/lib/memories/memory-route.server.test.ts`
- [ ] `pnpm type-check`
- [ ] `pnpm lint`

### Checkpoint A — backend

- [ ] `pnpm test`
- [ ] `pnpm type-check`
- [ ] `pnpm lint`
- [ ] `pnpm build`, then delete `dist/` + `.netlify/` cache (per SPEC §7).
- [ ] Manual curl on `pnpm dev`:
  - [ ] `?variant=thumb` → 200, image/jpeg, content-length much smaller than today's `?variant=image` baseline (capture for PR).
  - [ ] `?variant=download` → 200, `content-disposition: attachment`, `cache-control: …no-store`.
  - [ ] `?variant=image` → 400.
  - [ ] `?variant=poster` → 400.

## Phase 2 — Frontend wiring

### Task 2 — `Polaroid` uses `?variant=thumb`

- [ ] `src/components/Polaroid.tsx`
  - [ ] Replace the `kind === 'video' ? '…?variant=poster' : '…?variant=image'` ternary with a single `\`/api/memory/${item.uuid}?variant=thumb\``.
  - [ ] No other prop or layout changes.
- [ ] Visual smoke on `pnpm dev`:
  - [ ] Grid renders, aspect ratios still come from `width`/`height`.
  - [ ] Video tiles still show the "VÍDEO" badge.
  - [ ] Network panel: each tile is an order of magnitude lighter than `main`.

### Task 3 — `Lightbox` uses `?variant=thumb` for stills + posters; `?variant=download` for downloads

- [ ] `src/components/Lightbox.tsx`
  - [ ] Image carousel `<Image src>` → `?variant=thumb` (was `?variant=image`).
  - [ ] `<video poster>` → `?variant=thumb` (was `?variant=poster`).
  - [ ] `<video src>` → `?variant=stream` _(unchanged)_.
  - [ ] `getDownloadHref(uuid)` → `?variant=download` (was `?variant=image`).
  - [ ] `<a download target="_blank" rel="noopener noreferrer">` markup unchanged.
- [ ] Manual smoke:
  - [ ] Lightbox image at fullscreen → readable from the thumb (mobile target).
  - [ ] Lightbox video → poster from thumb, plays via stream.
  - [ ] Download an image → original file lands (HEIC / large JPEG / PNG).
  - [ ] Download a video → original MP4/MOV lands.

### Checkpoint B — preview

- [ ] PR opened from `v7-thumbs` → `main`.
- [ ] Cron triggered once on the preview (sanity; no cache-shape change).
- [ ] Smoke on the deploy-preview URL:
  - [ ] Timeline loads fast; all `<img>` requests use `?variant=thumb`.
  - [ ] No `<video>` element in the timeline DOM (DevTools → Elements).
  - [ ] Lightbox swipe: only the active slide loads video bytes.
  - [ ] Image + video downloads return originals with attachment disposition.
  - [ ] No requests reference `?variant=image` or `?variant=poster`.
- [ ] `curl -I https://<preview>.netlify.app/` → `Cache-Control: private` still set on the home HTML.
- [ ] Lighthouse perf delta noted in the PR body.

## Phase 3 — Ship

### Task 4 — Merge + prod smoke

- [ ] PR description includes before/after Network HAR weights for a representative day.
- [ ] CI green (type-check, test, lint, format-check).
- [ ] Reviewer signs off on visual diff at 1× and 2× DPR (mobile-first per Q1).
- [ ] Merge to `main`. Production deploy completes.
- [ ] Repeat Checkpoint B smoke on prod URL.
- [ ] File a follow-up issue for the deferred unpic-img + Netlify Image CDN spike.

## Open follow-ups (not in scope for v7)

- [ ] Spike: `@unpic/react` + Netlify Image CDN forwarding Identity cookies through to `/api/memory/<uuid>?variant=thumb`. Needs SPEC §7 "ask first" approval for the new dep.
- [ ] If desktop fullscreen lightbox softness is reported as a pain point, re-introduce a 1024×1024 `image` variant for desktop only (mobile keeps `thumb`).
