# Recuerdea v4 — Task List (UUID indirection + cron-warmed public links + 302)

See `tasks/plan.md` for full context. Current `v4` HEAD is `47b0a4f` and includes the failed browser-signing pivot. Slice F reverts that; Slice G is the new work.

## Slice F — Revert the failed pivot

- [ ] `git revert --no-commit 47b0a4f c1af573 cbfb98f && git commit` — single combined revert. Tree returns to `4e3c0fa` (byte-stream proxy state).
- [ ] `pnpm test`, `pnpm type-check`, `pnpm lint`, `pnpm format:check`, `pnpm build` clean.

## Slice G — UUID + public links + 302 (single PR)

### G1 — SPEC + plan + todo amendments (docs commit)

- [ ] `SPEC.md` §2/§4/§7/§8/§11/§12 rewritten per `tasks/plan.md` G1 (UUID, cron, public links, 302, every-endpoint-auth-gate).
- [ ] `tasks/plan.md` (already this revision).
- [ ] `tasks/todo.md` (this file).
- [ ] `pnpm format:check` clean.
- [ ] Commit as a single docs commit.

### G2 — Cache modules

- [ ] `src/lib/media-cache.ts` + test. Pure abstraction over `MediaCacheStore`. `CachedMedia = { fileid, hash, code, linkid, kind, contenttype, name, captureDate }`.
- [ ] `src/lib/media-cache.server.ts` + test. Memoized `getMediaCacheStore()` with `media/` prefix, no-op fallback (mirrors v3's `capture-cache.server.ts:25` pattern).
- [ ] `src/lib/fileid-index.ts` + test. Pure sidecar (`fileid → uuid`).
- [ ] `src/lib/fileid-index.server.ts` + test. Memoized factory; `fileid-index/` prefix.
- [ ] `src/lib/folder-cache.ts` + test. Pure snapshot abstraction (`{ refreshedAt, uuids }`).
- [ ] `src/lib/folder-cache.server.ts` + test. Single key `folder/v1`.
- [ ] `pnpm test` green for the six new test files.
- [ ] Commit.

### G3 — Cron + dependency add (pre-acked in plan-mode review)

Curl verifications are done (2026-04-29 — see `tasks/plan.md` "Curl-verified facts"). All pass; no API gate remains before this task.

- [ ] Add `@netlify/functions` to `dependencies` in `package.json`. `pnpm install` re-runs.
- [ ] Add `[functions."refresh-memories"]` block with `schedule = "0 4 * * *"` to `netlify.toml`.
- [ ] NEW `netlify/functions/refresh-memories.ts` per the outline in `tasks/plan.md` G3 (handler + `ensurePublink` helper + stale cleanup).
- [ ] NEW `netlify/functions/refresh-memories.test.ts` with in-memory fake stores + fake pcloud-kit client. Cases: new file added, existing-uuid reuse, hash mismatch, removed file (cache + public link cleared), folder snapshot updated.
- [ ] `pnpm test` green; `pnpm build` clean; `rg '@netlify/functions' dist/client/` returns 0 matches.
- [ ] Commit.

### G4 — `/api/memory/$uuid` route (auth-gated 302)

- [ ] NEW `src/routes/api/memory/$uuid.ts`. GET handler: auth gate → uuid + variant validation → cache lookup → `Response.redirect(publicUrl, 302)` with `Cache-Control: private, max-age=60`.
- [ ] Variant defaults from cached `kind` (image → image, video → stream).
- [ ] URL templates:
  - image/poster → `https://eapi.pcloud.com/getpubthumb?code=${code}&size=2048x1024` (direct bytes)
  - stream → server calls `getpublinkdownload({ code })`, derives `https://${hosts[0]}${path}` from the response, 302s to that CDN URL
- [ ] NEW `src/routes/api/memory/$uuid.test.ts` (Vitest): unauth → 401, bad uuid → 400, bad variant → 400, miss → 404, image → 302 to `eapi.pcloud.com/getpubthumb`, video default → 302 to derived CDN URL (mock `getpublinkdownload`), video poster → 302 to `getpubthumb`, getpublinkdownload throw → 502.
- [ ] Manual curl smoke under `pnpm netlify dev` (with cache pre-populated):
  - [ ] `curl -i .../api/memory/<image-uuid>?variant=image` → 302; following the redirect returns image bytes.
  - [ ] `curl -iL .../api/memory/<video-uuid>?variant=stream` → 302 → CDN URL → bytes.
  - [ ] `curl -iL -H 'Range: bytes=0-1023' .../api/memory/<video-uuid>?variant=stream` → final response `206 Partial Content`. **If 200, switch stream variant to byte-stream (server fetches CDN URL and pipes Response with Range forwarding) and re-test.**
- [ ] Commit.

### G5 — Loader: read from cache, drop pCloud calls

- [ ] `src/lib/pcloud.server.ts`: `MemoryItem` becomes `{ kind, uuid, name, captureDate, contenttype? }`. `fetchTodayMemories` reads `folder-cache.lookup()` + parallel `media-cache.lookup(uuid)`; filters by today; sorts by year asc / fileid asc; returns `MemoryItem[]`. **No `client.listfolder`, no pCloud API client constructed in this path.**
- [ ] `src/lib/pcloud.server.test.ts` rewritten — mocks `getMediaCacheStore` + `getFolderCacheStore`; asserts cache-only behavior (snapshot present → items, snapshot missing → [] + warn).
- [ ] `src/lib/pcloud.ts`: hard auth gate (`loadServerUser` early-throw), payload simplifies to `MemoryItem[]` (no token).
- [ ] `pnpm test`, `pnpm type-check` green.
- [ ] Commit.

### G6 — `routes/index.tsx` consumer update

- [ ] Loader returns `MemoryItem[]` directly (drop the `{ items, pcloudToken }` destructure).
- [ ] `<MemoryView>` becomes synchronous; URLs constructed inline from `item.uuid` + variant.
- [ ] `memoryKey(item)` returns `item.uuid`.
- [ ] Drop `PcloudClientProvider` import + wrapper (already removed by F revert; verify `rg PcloudClientProvider src/` returns 0).
- [ ] `pnpm test`, `pnpm type-check`, `pnpm lint`, `pnpm format:check` clean.
- [ ] Commit.

### G7 — Delete the byte-stream proxy + capture-cache

- [ ] DELETE `src/routes/api/media/$fileid.ts`.
- [ ] DELETE `src/lib/media-proxy.server.ts`, `src/lib/media-proxy.server.test.ts`.
- [ ] DELETE `src/lib/capture-cache.ts`, `capture-cache.test.ts`, `capture-cache.server.ts`, `capture-cache.server.test.ts`.
- [ ] Remove empty `src/routes/api/media/` and `src/routes/api/` (only if `api/memory/` no longer makes them empty — keep `src/routes/api/memory/`).
- [ ] `rg -n 'media-proxy|/api/media|capture-cache' src/ test/ netlify/` returns 0 matches.
- [ ] `pnpm build` clean; `routeTree.gen.ts` regenerates without `/api/media/$fileid`.
- [ ] Commit.

## Checkpoint G — Deploy preview + PR

- [ ] All standard gates clean (`test`, `type-check`, `lint`, `format:check`, `build`).
- [ ] Push `v4`. PR #4 (or new PR `[v4] UUID indirection + cron-warmed public links + 302`) → `main`. Deploy preview rebuilds.
- [ ] **Manually trigger the cron** via Netlify dashboard ("Run now" on `refresh-memories`).
- [ ] Inspect Netlify Blobs panel: `folder/v1`, multiple `media/<uuid>`, multiple `fileid-index/<fileid>`.
- [ ] On the deploy preview:
  - [ ] Hard reload `/`. Network tab: `/api/memory/<uuid>` → 302 → direct `*.pcloud.com` fetch. No `/api/media/*`. No 7010 / 410 / "another IP address" errors.
  - [ ] View source on `/`: only uuids in HTML — no fileid, no code, no token.
  - [ ] Wait 30+ min, return — images render, video plays + seeks.
  - [ ] `curl -i https://<deploy-preview>/api/memory/<uuid>?variant=image` without auth cookie → 401.
  - [ ] `getTodayMemories` server-fn endpoint without auth → 401.
  - [ ] `curl -I https://<deploy-preview>/` — `cache-control: private` (or `no-store` / absent), never `public, s-maxage=...`.
  - [ ] (Optional) Rename a file in pCloud → trigger cron → confirm `media/<uuid>` updates with the new hash, same code.
  - [ ] (Optional) Delete a file in pCloud → trigger cron → confirm `media/<uuid>` + `fileid-index/<fileid>` removed; pCloud's Public Links panel shows the link gone.
- [ ] **Pre-prod**: trigger the prod cron manually so the snapshot exists at merge time.
- [ ] Merge `v4 → main`. Post-merge prod smoke (same checks on prod URL).

## Parked / follow-up

- Slice D from earlier plans — refactor `src/routes/index.tsx` into `src/components/Home.tsx` + `MemoryView.tsx` + `AdminDateOverride.tsx`. Separate PR after this lands.
- Byte-stream variant of `/api/memory/$uuid` — only if multi-user becomes a goal or if G3 manual verifications #2/#3 fail.
