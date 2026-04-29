# Recuerdea v4 — Task List (revised: pivot to client-side signing)

See `tasks/plan.md` for full context. Phase 0 / Slice A / A.5 are already shipped (commits `8b13827` → `4e3c0fa`); the proxy they introduced is being torn out in this revision.

## Slice E — Pivot to client-side pCloud signing (single PR)

### E1 — SPEC + plan + todo amendments (docs commit)

- [x] Update `SPEC.md` §2, §4, §7, §8, §11, §12 per `tasks/plan.md` E1.
- [x] Replace `tasks/plan.md`.
- [x] Replace `tasks/todo.md` (this file).
- [ ] `pnpm format:check` clean.
- [ ] `rg -n 'byte-?stream|uuid indirection|fileid-index|folder-cache|refresh-cache|cron' SPEC.md` shows matches only in §8 / §12 (withdrawn or historical).
- [ ] Commit as a single docs commit.

### E2 — Server side: loader returns `{ items, pcloudToken }`

- [ ] `src/lib/pcloud.server.ts`: drop URL fields from `MemoryItem`. New shape: `{ kind: 'image', fileid, name, captureDate }` and `{ kind: 'video', fileid, contenttype, name, captureDate }`. `buildMemoryItem` becomes synchronous, no URL string-building.
- [ ] `src/lib/pcloud.server.test.ts`: drop `MemoryItem.url` / `posterUrl` assertions; assert `fileid`, `kind`, `name`, `captureDate`, plus `contenttype` for video.
- [ ] `src/lib/pcloud.ts`: `getTodayMemories` handler hard-requires `loadServerUser()` (throw if unauth), reads `process.env.PCLOUD_TOKEN`, returns `{ items, pcloudToken }`.
- [ ] `pnpm test src/lib/pcloud.server.test.ts` green.
- [ ] `pnpm type-check` green.
- [ ] Commit.

### E3 — Client side: `<MemoryView>` signs URLs in browser

- [ ] NEW `src/lib/pcloud-client.tsx`: `PcloudClientProvider` (useState lazy init) + `usePcloudClient` + `useMemoryUrls(item)`. Lift `getThumbUrl` / `getStreamUrl` verbatim from `media-proxy.server.ts:resolveMediaUrl`.
- [ ] MODIFY `src/routes/index.tsx`: `loader` returns the loader payload as-is (`{ items, pcloudToken }` instead of `{ memories }`).
- [ ] `<Home>` threads the loader payload, wraps memory list in `<PcloudClientProvider token={pcloudToken}>`.
- [ ] `<MemoryView>` becomes effect-driven — placeholder while URLs resolve, then `<Image>` / `<video>` with the signed URLs.
- [ ] `memoryKey(item)` returns `String(item.fileid)`.
- [ ] `pnpm test` (full suite) green.
- [ ] `pnpm type-check`, `pnpm lint`, `pnpm format:check` clean.
- [ ] `pnpm dev` smoke: home renders images + videos; network tab shows direct `*.pcloud.com` requests; no `/api/media/*` requests.
- [ ] Commit.

### E4 — Cleanup: delete the proxy

- [ ] DELETE `src/routes/api/media/$fileid.ts`.
- [ ] DELETE `src/lib/media-proxy.server.ts`.
- [ ] DELETE `src/lib/media-proxy.server.test.ts`.
- [ ] Remove `src/routes/api/media/` directory if empty (and `src/routes/api/` if empty after that).
- [ ] `rg -n 'media-proxy|/api/media' src/ test/` returns 0 matches.
- [ ] `pnpm build` clean; `pnpm test` green; route tree regenerates without the deleted route.
- [ ] Commit.

## Checkpoint E — Deploy preview verification

- [ ] `pnpm test`, `pnpm type-check`, `pnpm lint`, `pnpm format:check`, `pnpm build` all clean.
- [ ] Push `v4`. PR #4 (or new PR `[v4] Switch /api/media → client-side pcloud-kit signing`) → `main`. Deploy preview rebuilds.
- [ ] On the deploy preview:
  - [ ] Hard reload `/`. Network tab: direct `*.pcloud.com` requests; **no** `/api/media/*`; no 410s; no "another IP address" errors.
  - [ ] Wait 30+ min, return — re-mount re-signs URLs, images render, video plays + seeks.
  - [ ] View source on `/`: HTML embeds `pcloudToken`; HTML does **not** contain pCloud signed URLs (signing is post-hydration).
  - [ ] `curl -I https://<deploy-preview>/` — `cache-control` is `private` / `no-store` / absent (never `public, s-maxage=...`).
  - [ ] Hit `getTodayMemories` server-fn endpoint without the auth cookie — must throw, not return a token.
- [ ] Merge `v4 → main`. Post-merge prod smoke.

## Parked / follow-up

- Slice D (refactor `src/routes/index.tsx` into `src/components/Home.tsx` + `MemoryView.tsx` + `AdminDateOverride.tsx`) — separate PR after E lands.
