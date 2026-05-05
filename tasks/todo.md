# Switch video URLs to `getvideolink` — todo

> Replace `getpublinkdownload({ code })` with `getvideolink({ fileid, … })` on
> the video play + download paths. Pass `contenttype=<meta.contenttype>` for
> play, `forcedownload=1` for download. Proxy at `/api/video/<uuid>` stays —
> `getvideolink` URLs are still IP-bound. Image downloads untouched.
>
> Docs: <https://docs.pcloud.com/methods/streaming/getvideolink.html>

## Phase 1 — Server-side helper

- [ ] **Task 1** — `resolveVideoLink` helper + tests
  - [ ] `src/lib/memories/pcloud-urls.server.ts`
    - [ ] Export `resolveVideoLink(client, fileid, opts)` returning `https://${hosts[0]}${path}`
    - [ ] Export `VideoLinkOpts = { contenttype?: string; forcedownload?: boolean }`
    - [ ] When `forcedownload: true`, pass `forcedownload: 1` to `callRaw`; when absent/false, omit
    - [ ] When `contenttype` set, pass through; when absent, omit
    - [ ] Throws `TypeError('getvideolink: no hosts returned')` on empty `hosts` (parity with `resolveMediaUrl`)
    - [ ] Propagates `callRaw` errors
  - [ ] `src/lib/memories/pcloud-urls.server.test.ts`
    - [ ] Asserts `callRaw('getvideolink', { fileid, contenttype })` for stream-style call
    - [ ] Asserts `callRaw('getvideolink', { fileid, forcedownload: 1 })` for download-style call
    - [ ] Asserts `callRaw('getvideolink', { fileid })` when both opts omitted
    - [ ] Asserts `https://${hosts[0]}${path}` shape
    - [ ] Asserts empty-hosts throw
    - [ ] Asserts `callRaw` error propagation

### ✅ Checkpoint 1 — helper green
- [ ] `pnpm test:unit -- pcloud-urls.server` green
- [ ] `pnpm type-check` clean

## Phase 2 — Wire into the proxy

- [ ] **Task 2** — `video-stream.server.ts` uses `resolveVideoUrl` (fileid-based)
  - [ ] `src/lib/memories/video-stream.server.ts`
    - [ ] Replace `ResolveStreamUrl: (code) => Promise<string>` with `ResolveVideoUrl: (fileid: number, opts: { contenttype?: string; forcedownload?: boolean }) => Promise<string>`
    - [ ] `VideoStreamDeps.resolveVideoUrl` replaces `resolveStreamUrl`
    - [ ] Stream branch passes `{ contenttype: meta.contenttype }` to resolver
    - [ ] Download branch passes `{ forcedownload: true }` to resolver
    - [ ] All response shaping unchanged (range-forwarding, manual `content-type`, manual `Content-Disposition`, force-200 on download, 502 on errors)
    - [ ] Resolver called with `meta.fileid` (not `meta.code`)
  - [ ] `src/lib/memories/video-stream.server.test.ts`
    - [ ] Update mocks for new resolver signature
    - [ ] Stream test asserts resolver called with `(videoMeta.fileid, { contenttype: 'video/mp4' })`
    - [ ] Download test asserts resolver called with `(videoMeta.fileid, { forcedownload: true })`
    - [ ] All existing 401 / 400 / 404 / 502 / Range / Content-Disposition / UTF-8 filename tests stay green

- [ ] **Task 3** — Route shell uses `resolveVideoLink`
  - [ ] `src/routes/api/video/$uuid.ts`
    - [ ] Replace `resolveMediaUrl` import with `resolveVideoLink`
    - [ ] `resolveVideoUrl: async (fileid, opts) => { … resolveVideoLink(client, fileid, opts) }`
    - [ ] No other change to the shell

### ✅ Checkpoint 2 — proxy on `getvideolink`
- [ ] `pnpm test` (unit + browser) green
- [ ] `pnpm type-check` clean
- [ ] `pnpm lint` clean
- [ ] `pnpm format:check` clean
- [ ] Deploy-preview smoke: play a cached video; download the same video; both succeed; Network tab clean (no `another IP address` / `410 Gone`)
- [ ] Downloaded file lands with the original filename (incl. accents)

## Open questions

- [ ] (Optional) Drop the proxy's manual `'content-type'` override on the stream path? Default: keep.
- [ ] (Optional) Add a one-line note to SPEC §17 about the pCloud method swap? Default: skip in this PR.
