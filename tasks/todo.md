# v9 — Server-resolved pCloud URLs in the route loader; demolish `/api/memory/<uuid>` proxy — todo

> Loader resolves URLs server-side per item via `getpubthumblink` (640 + 1025) + `getpublinkdownload` (videos), returns CDN URLs in `MemoryItem`. Frontend renders `<img src>` / `<video src>` directly against `*.pcloud.com`. Download via client-side blob. **Cache shape unchanged. Cron unchanged.** Per-file `code` stays server-only. Token stays server-only.

## Phase 0 — Spike (no code changes)

- [ ] **Task 0** — Confirm pCloud calls work as needed
  - [ ] Server-side: `client.callRaw('getpubthumblink', { code: <existing per-file code>, size: '640x640' })` → `{ result: 0, hosts, path }`
  - [ ] Server-side: `client.callRaw('getpubthumblink', { code: <existing per-file code>, size: '1025x1025' })` → `{ result: 0, hosts, path }`. **If `1025x1025` is rejected**, capture the closest accepted size and update the plan
  - [ ] Server-side: `client.callRaw('getpublinkdownload', { code })` → `{ result: 0, hosts, path }` (sanity)
  - [ ] Browser devtools (preview): `fetch('https://${hosts[0]}${path}', { headers: { Range: 'bytes=0-1023' } })` → 206 (video stream sanity)
  - [ ] Browser devtools: `fetch('https://${hosts[0]}${path}').then(r => r.blob())` succeeds (CORS-permissive — confirms client-side download)
  - [ ] Capture results in PR description (incl. final lightbox size)
  - [ ] **If any check fails, STOP** — fall back per `plan.md` "Spike-gated assumptions"

### ✅ Checkpoint 0 — Architecture viable

- [ ] All checks pass

## Phase 1 — Server-side URL resolution

- [ ] **Task 1** — Pure URL-resolution helpers + tests
  - [ ] `src/lib/memories/pcloud-urls.server.ts` 🆕
    - [ ] `resolveThumbUrl(client, code, size)` → `https://${hosts[0]}${path}` (calls `getpubthumblink` via `callRaw`)
    - [ ] `resolveMediaUrl(client, code)` → `https://${hosts[0]}${path}` (calls `getpublinkdownload` via `callRaw`)
    - [ ] `size` typed as literal union (`'640x640' | '1025x1025'`)
    - [ ] Throws on `result !== 0`; throws on missing/empty `hosts`
  - [ ] `src/lib/memories/pcloud-urls.server.test.ts` 🆕 (mocked `callRaw`)

- [ ] **Task 2** — Loader resolves URLs; `MemoryItem` gains `thumbUrl` + `lightboxUrl` + (videos) `mediaUrl`
  - [ ] `src/lib/memories/pcloud.server.ts`
    - [ ] Instantiate pCloud client (`createClient({ token: process.env.PCLOUD_TOKEN })`); missing token → `[]` + warn
    - [ ] Per match: parallel `resolveThumbUrl(640)` + `resolveThumbUrl(1025)` + (videos only) `resolveMediaUrl`
    - [ ] All resolutions across all matches in one `Promise.allSettled`
    - [ ] Per-item failure → drop the item with a single warn (no fileid/code/place in logs)
  - [ ] `MemoryItem` shape:
    - [ ] image: `{ kind, uuid, name, captureDate, w, h, place, thumbUrl, lightboxUrl }`
    - [ ] video: `{ kind, uuid, contenttype, name, captureDate, w, h, place, thumbUrl, lightboxUrl, mediaUrl }`
  - [ ] `src/lib/memories/pcloud.server.test.ts` — happy path, partial failure, missing token, video resolution failure
  - [ ] `src/lib/memories/pcloud.ts` — type-only follow-on

### ✅ Checkpoint A — Loader returns CDN URLs

- [ ] `pnpm test`, `pnpm type-check`, `pnpm lint`, `pnpm build` all pass
- [ ] React DevTools shows `thumbUrl` + `lightboxUrl` (all items) + `mediaUrl` (videos) on the loader response

## Phase 2 — Frontend uses direct CDN URLs

- [ ] **Task 3** — `Polaroid` + `Lightbox` render direct pCloud URLs
  - [ ] `src/components/Polaroid.tsx` — `<Image src={item.thumbUrl}>`
  - [ ] `src/components/Lightbox.tsx`
    - [ ] Image slide → `<Image src={item.lightboxUrl}>`
    - [ ] Video slide → `<video src={item.mediaUrl} poster={item.thumbUrl}>`
    - [ ] Download button untouched in this task (still hits proxy)
  - [ ] DevTools Network: zero `?variant=thumb` / `?variant=stream` requests during timeline + lightbox playback
  - [ ] Lightbox image natural width = 1025 (DevTools)

### ✅ Checkpoint B — Display path off the proxy

- [ ] DevTools Network on `/`: `*.pcloud.com` for all `<img>` and `<video>`; zero proxy requests for thumb/stream
- [ ] Proxy is used by the download button only

## Phase 3 — Client-side downloads

- [ ] **Task 4** — `getMediaDownloadUrl` server-fn + `download.ts` blob helper
  - [ ] `src/lib/memories/get-download-url.ts` 🆕 + test
    - [ ] Auth-gates; reads media-cache; `resolveMediaUrl(client, meta.code)`; returns `{ url, name, contenttype }`
    - [ ] 401 unauth, 404 cache miss
  - [ ] `src/lib/memories/download.ts` 🆕 + test
    - [ ] `downloadAs({ url, name })`: `fetch → blob → createObjectURL → click anchor → revoke`
    - [ ] Browser-safe; mocked `fetch` + DOM stubs in tests

- [ ] **Task 5** — Lightbox download button → blob download
  - [ ] `src/components/Lightbox.tsx`
    - [ ] Replace `<a href="/api/memory/<uuid>?variant=download">` with a button calling `getMediaDownloadUrl` → `downloadAs`
    - [ ] Chakra `Spinner` + `disabled` during the operation
    - [ ] Errors surface visibly (no silent fail)
  - [ ] Filenames with accents/emoji save correctly
  - [ ] Zero `?variant=download` requests anywhere

### ✅ Checkpoint C — Proxy unused

- [ ] Network panel on `/` and inside the lightbox: zero `/api/memory/<uuid>` requests across timeline, lightbox, swipe, play, scrub, download
- [ ] `curl -I https://<preview>.netlify.app/` → `Cache-Control: private`

## Phase 4 — Demolition

- [ ] **Task 6** — Delete `/api/memory/$uuid` route + `memory-route.server.ts`
  - [ ] Delete `src/routes/api/memory/$uuid.ts`
  - [ ] Delete `src/lib/memories/memory-route.server.ts` + test
  - [ ] `src/routeTree.gen.ts` regenerated
  - [ ] `grep -r 'api/memory' src/ netlify/` empty (or generated-only)
  - [ ] CI green

## Phase 5 — SPEC + ship

- [ ] **Task 7** — `SPEC.md` update
  - [ ] §17 v9 Acceptance Criteria
  - [ ] §18 v8 → v9 changes summary
  - [ ] §7 boundaries:
    - [ ] **Always do** unchanged
    - [ ] **Never do**: keep "pCloud token in browser"; replace "Sign IP-bound URL on server, pass to browser" with: **Always** mint public-link CDN URLs server-side via `getpubthumblink` / `getpublinkdownload`; embed `https://${hosts[0]}${path}` in the loader response; **never** embed the public-link `code` in browser-visible HTML/JSON/loader
  - [ ] Close §8.4 (or equivalent); add a new §8.X recording the spike result + loader latency profile

- [ ] **Task 8** — Merge + prod smoke
  - [ ] PR description: spike output (incl. final lightbox size) + HAR + Lighthouse + SPEC diff + deleted-files list
  - [ ] CI green
  - [ ] Reviewer sign-off on visual diff (lightbox at 1025) + SPEC §7 update
  - [ ] Post-merge: smoke `/` on prod; zero `/api/memory/...` traffic
  - [ ] Watch Netlify bandwidth dashboard 24 h

## Open questions

None blocking. Phase 0 closes the only spike-gated assumptions (chiefly: confirm `1025x1025` is accepted; if not, pick the closest grid size).
