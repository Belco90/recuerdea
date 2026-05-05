# Implementation Plan: Switch video URLs to `getvideolink`

## Overview

Replace pCloud's `getpublinkdownload({ code })` with `getvideolink({ fileid, … })`
on the **video play + video download** paths. Pass `contenttype=<meta.contenttype>`
when playing and `forcedownload=1` when downloading. The proxy at
`/api/video/<uuid>` stays — `getvideolink` URLs are still IP-bound per SPEC §7,
so the function still resolves the CDN URL server-side and pipes bytes back.

Image downloads (lightbox download button on still images, via
`get-download-url.server.ts` → `getpublinkdownload({ code })`) are **not**
touched: `getvideolink` is video-only.

Docs: <https://docs.pcloud.com/methods/streaming/getvideolink.html>

## Surfaced Assumptions

1. `getvideolink` URLs are IP-bound (same family as `getfilelink` /
   `getthumblink`). The video proxy at `/api/video/<uuid>` stays — we just
   change which pCloud method the proxy calls server-side.
2. The change applies only to videos. Image downloads keep their existing
   `getpublinkdownload({ code })` path.
3. `CachedMedia.fileid` is always populated (schema-required), so we can
   resolve videos by `fileid` instead of `code`.
4. The proxy keeps overriding `Content-Type` and `Content-Disposition`
   itself. Passing `contenttype=…` and `forcedownload=1` upstream makes pCloud
   set them too, but we still want the proxy's own RFC 5987–compliant
   `Content-Disposition` for filename consistency, and our explicit
   `content-type: <meta.contenttype>` matches existing tests.

→ **If any assumption is wrong, raise it now** before `/agent-skills:build`.

## Architecture Decisions

- **New helper `resolveVideoLink(client, fileid, opts)` in
  `pcloud-urls.server.ts`.** Calls `client.callRaw('getvideolink', { fileid,
...opts })` and returns `https://${hosts[0]}${path}`. Mirrors the existing
  `resolveMediaUrl(client, code)` shape so the file stays cohesive. Existing
  `resolveMediaUrl` is kept (image downloads still use it).
- **Resolver dep on `video-stream.server.ts` becomes fileid-based.** Replace
  `ResolveStreamUrl: (code) => Promise<string>` with
  `ResolveVideoUrl: (fileid: number, opts: { contenttype?: string; forcedownload?: boolean }) => Promise<string>`.
  Handler chooses opts based on `isDownload`:
  - Stream: `{ contenttype: meta.contenttype }`
  - Download: `{ forcedownload: true }`
- **Keep the proxy's manual `Content-Type` + `Content-Disposition` headers.**
  Tested, RFC 5987 filename support, single source of truth.
- **`resolveMediaUrl` (used by `getpublinkdownload`) stays** for image
  downloads. Keeps the change narrow.
- **No SPEC change required.** §7 / §17 already describe the proxy + that
  `getvideolink` URLs are IP-bound. The pCloud method swap is an implementation
  detail of the proxy. (Optional follow-up: a one-liner in §17 noting the
  switch — out of scope for this PR.)

## Task List

### Phase 1: Server-side helper

- [ ] **Task 1** — Add `resolveVideoLink` to `pcloud-urls.server.ts` + tests

#### Checkpoint 1 (after Task 1)

- [ ] `pnpm test:unit -- pcloud-urls.server` green
- [ ] `pnpm type-check` clean

### Phase 2: Wire it into the proxy

- [ ] **Task 2** — Switch `video-stream.server.ts` to `resolveVideoUrl` + update tests
- [ ] **Task 3** — Update route shell `src/routes/api/video/$uuid.ts`

#### Checkpoint 2 (after Tasks 2–3)

- [ ] `pnpm test` (unit + browser) green
- [ ] `pnpm type-check` clean
- [ ] `pnpm lint` clean
- [ ] `pnpm format:check` clean
- [ ] **Manual smoke (deploy preview):** play a cached video; download the
      same video; both succeed; no `another IP address` / `410 Gone` errors in
      the Network tab; the downloaded file lands with the original filename.

---

## Tasks (detail)

### Task 1: Add `resolveVideoLink` to `pcloud-urls.server.ts` + tests

**Description:** Introduce `resolveVideoLink(client, fileid, opts)` alongside
`resolveMediaUrl`. Calls `callRaw('getvideolink', { fileid, ...opts })` and
returns `https://${hosts[0]}${path}`. Includes the same "no hosts" guard as
`resolveMediaUrl`.

Options shape:

```ts
type VideoLinkOpts = {
	contenttype?: string
	forcedownload?: boolean
}
```

- When `forcedownload` is `true`, pass `forcedownload: 1` (number) to
  `callRaw`. When `false` or absent, omit the key.
- When `contenttype` is set, pass it through verbatim. When absent, omit.

**Acceptance criteria:**

- [ ] `resolveVideoLink(client, 123, { contenttype: 'video/mp4' })` invokes
      `client.callRaw('getvideolink', { fileid: 123, contenttype: 'video/mp4' })`
      and returns `https://${hosts[0]}${path}`.
- [ ] `resolveVideoLink(client, 123, { forcedownload: true })` invokes
      `client.callRaw('getvideolink', { fileid: 123, forcedownload: 1 })`.
- [ ] `resolveVideoLink(client, 123, {})` invokes
      `client.callRaw('getvideolink', { fileid: 123 })` (no extra keys).
- [ ] Throws `TypeError('getvideolink: no hosts returned')` when `hosts` is
      empty (parity with `resolveMediaUrl`).
- [ ] Propagates errors thrown by `callRaw`.
- [ ] Public surface adds `resolveVideoLink` and `VideoLinkOpts` only.

**Verification:**

- [ ] `pnpm test:unit src/lib/memories/pcloud-urls.server.test.ts` passes
- [ ] `pnpm type-check` clean
- [ ] `pnpm lint` clean

**Dependencies:** None.

**Files likely touched:**

- `src/lib/memories/pcloud-urls.server.ts`
- `src/lib/memories/pcloud-urls.server.test.ts`

**Estimated scope:** S (2 files).

---

### Task 2: Switch `video-stream.server.ts` to a fileid-based resolver

**Description:** Rename the dep from `resolveStreamUrl` to `resolveVideoUrl`
and change its signature to `(fileid, opts)`. The handler picks opts based on
`isDownload`:

```ts
const opts = isDownload ? { forcedownload: true } : { contenttype: meta.contenttype }
const upstreamUrl = await deps.resolveVideoUrl(meta.fileid, opts)
```

All response shaping (`buildStreamResponse`, `buildDownloadResponse`,
filename handling, range-forwarding semantics) stays identical. The change is
purely how the upstream URL is resolved.

Update `video-stream.server.test.ts`:

- Mocks intercept `resolveVideoUrl(fileid, opts)`.
- New assertions:
  - Stream path calls resolver with `(meta.fileid, { contenttype: meta.contenttype })`.
  - Download path calls resolver with `(meta.fileid, { forcedownload: true })`.
- Existing 401 / 400 / 404 / 502 / Range-forwarding / `Content-Disposition`
  tests continue to pass with updated mock signatures.

**Acceptance criteria:**

- [ ] Public types updated: `ResolveStreamUrl` removed; `ResolveVideoUrl`
      exported as
      `(fileid: number, opts: { contenttype?: string; forcedownload?: boolean }) => Promise<string>`.
- [ ] `VideoStreamDeps.resolveVideoUrl` replaces
      `VideoStreamDeps.resolveStreamUrl`.
- [ ] Stream branch resolves with `{ contenttype: meta.contenttype }`.
- [ ] Download branch resolves with `{ forcedownload: true }`.
- [ ] Existing response semantics preserved (Range forwarding on stream;
      no-Range + manual `Content-Disposition` + 200 on download; manual
      `content-type` override; 502 on resolver/fetch errors).
- [ ] No reference to the removed `code`-based resolver remains.

**Verification:**

- [ ] `pnpm test:unit src/lib/memories/video-stream.server.test.ts` passes
- [ ] `pnpm test:unit` (full unit project) passes
- [ ] `pnpm type-check` clean
- [ ] `pnpm lint` clean

**Dependencies:** Task 1.

**Files likely touched:**

- `src/lib/memories/video-stream.server.ts`
- `src/lib/memories/video-stream.server.test.ts`

**Estimated scope:** M (test churn dominates).

---

### Task 3: Wire `getvideolink` into the route shell

**Description:** `src/routes/api/video/$uuid.ts` constructs the new
`resolveVideoUrl` closure using `resolveVideoLink`. The shell stays thin —
owns `PCLOUD_TOKEN` + client construction, forwards `(fileid, opts)`.

```ts
resolveVideoUrl: async (fileid, opts) => {
	const token = process.env.PCLOUD_TOKEN
	if (!token) throw new Error('PCLOUD_TOKEN is not set')
	const client = createClient({ token })
	return resolveVideoLink(client, fileid, opts)
}
```

**Acceptance criteria:**

- [ ] Route shell imports `resolveVideoLink` (replaces `resolveMediaUrl`
      import in this file).
- [ ] No other behavior change (`fetchBytes`, auth, cache deps unchanged).
- [ ] `pnpm test:browser` green (no Lightbox regression).
- [ ] Manual deploy-preview smoke: play + download a known cached video;
      Network tab clean.

**Verification:**

- [ ] `pnpm test` (both projects) passes
- [ ] `pnpm type-check` clean
- [ ] `pnpm lint` clean
- [ ] `pnpm format:check` clean
- [ ] Deploy-preview smoke pass (see acceptance criterion above).

**Dependencies:** Tasks 1 + 2.

**Files likely touched:**

- `src/routes/api/video/$uuid.ts`

**Estimated scope:** XS (1 file).

---

## Risks and Mitigations

| Risk                                                                                                                | Impact | Mitigation                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------- |
| `getvideolink` URLs behave differently than `getpublinkdownload` (token expiry, IP-binding strictness, hosts shape) | Med    | Per-request resolution + immediate proxy fetch keeps the URL alive in the same call. Smoke on deploy preview before merge. |
| pCloud's `forcedownload=1` upstream `Content-Disposition` clashes with the proxy's manual one                       | Low    | Proxy always overrides `Content-Disposition`; upstream value never reaches the browser.                                    |
| `contenttype` parameter encoding (slashes)                                                                          | Low    | `pcloud-kit`'s `callRaw` URL-encodes params. Helper test asserts the call arguments shape.                                 |
| Hidden consumer of `resolveStreamUrl`/`ResolveStreamUrl` breaks on rename                                           | Low    | Single consumer (`$uuid.ts` route shell). Verify with grep before/after.                                                   |
| Browser cache serves stale `?download=1` responses with old upstream bytes                                          | Low    | Existing `cache-control: private, max-age=0, no-store` on download responses already handles this.                         |

## Open Questions

- **Drop the proxy's manual `'content-type'` override on the stream path now
  that pCloud sets it via `contenttype=<x>`?** Default: **no** (preserves
  tests + current behavior). Separate cleanup PR if we want it.
- **SPEC update?** §17 mentions `getpublinkdownload` for the video proxy.
  Default: skip in this PR; one-line note in §17 as a follow-up if we want
  the swap on the record.
