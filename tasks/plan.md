# Recuerdea v2 Implementation Plan — Multi-media + video support

## Context

`SPEC.md` v2 (commit `6ae4e88`) expands scope from "single image" to "every photo and video taken on today's month/day in any past year." Three concrete shifts vs. v1:

1. **Multi-item return** — server returns `MemoryItem[]`, not a single image.
2. **Videos as first-class** — videos parse `creation_time` from MP4/MOV `mvhd` atoms; render via `<video controls>` with a poster.
3. **Random fallback retired** — empty state is just text; no "show random" button.

Sort rule (oldest year first, fileid tiebreak), admin date override, EXIF for images, and route auth all carry over from v1 unchanged.

This plan slices the work vertically: each task delivers a complete, testable layer the next task builds on. SPEC §7 boundaries are honored — no stack swaps, secrets stay behind `createServerFn`, all `src/lib/` logic colocated with Vitest tests.

## Prerequisite (resolved)

### P0: MP4/MOV metadata parser approach — **APPROVED: hand-rolled `mvhd` reader**

User selected hand-rolled over `mp4box` (~80KB) and `mediainfo.js` (~3MB WASM). Rationale carried into the implementation:

- The `mvhd` atom is 100 bytes inside the `moov` box. Pulling `creation_time` (32-bit seconds since 1904-01-01 in v0; 64-bit in v1) is a tight, well-specified parse.
- Works for both MP4 and MOV — both use ISO Base Media File Format with the same atom layout.
- Reuses the existing Range-fetch primitive in `src/lib/exif.ts:14`.
- Zero new top-level deps → no `package.json` / `pnpm-lock.yaml` churn.

T1 may begin immediately.

## Dependency Graph

```
P0: parser-approach approval
    │
    ▼
T1: src/lib/video-meta.ts (extractVideoCaptureDate)
    + src/lib/video-meta.test.ts
    │
    ▼
T2: src/lib/pcloud.server.ts
    (MemoryImage → MemoryItem, fetchTodayMemoryImage → fetchTodayMemories,
     drop fetchRandomMemoryImage, broaden isImageFile → isMediaFile,
     per-kind capture-date dispatch)
    + update src/lib/pcloud.server.test.ts
    │
    ▼
T3: src/lib/pcloud.ts
    (getTodayMemoryImage → getTodayMemories returning array,
     drop getRandomMemoryImage)
    │
    ▼
[CHECKPOINT 1: server layer returns the array shape]
    │
    ▼
T4: src/routes/index.tsx
    (loader → array, render vertical feed, MemoryView dispatches kind,
     drop random state + button)
    │
    ▼
[CHECKPOINT 2: end-to-end via pnpm dev]
```

## Architecture Decisions

### Type shape

```ts
export type MemoryItem =
	| { kind: 'image'; url: string; name: string; captureDate: string }
	| { kind: 'video'; url: string; posterUrl: string; name: string; captureDate: string }
```

Discriminated union by `kind`. `captureDate` is required (SPEC §2: items without a parseable date are skipped, so v1's `string | null` collapses to `string`). Video gets an additional `posterUrl` for the `<video poster>` attribute.

### Per-kind capture-date dispatch (in `fetchTodayMemories`)

For each file in the folder:

- **Image** (`contenttype.startsWith('image/')`): `client.getfilelink(fileid)` → `extractCaptureDate(url)` (existing).
- **Video** (`contenttype.startsWith('video/')`): `client.getfilelink(fileid)` → `extractVideoCaptureDate(url)` (new).
- Returns `null` → skip the file.

The fan-out stays parallel (`Promise.all`), like v1.

### Display URL dispatch

After the file qualifies for "today":

- **Image**: `getthumblink` → `https://${host}${path}` (existing).
- **Video**: `getthumblink` → poster URL; `getvideolink` → streaming URL.
  - `getvideolink` isn't typed in `pcloud-kit` — call via `client.call<VideoLinkResponse>('getvideolink', { fileid })`. Response shape verified during T2.
  - Fallback if `getvideolink`'s response is awkward: use `getfilelink(fileid)` (returns a direct file URL) for the video `src`. Browsers handle MP4/MOV natively. Document the choice in code.

### `mvhd` parsing strategy (T1 internals)

The `mvhd` atom lives inside the `moov` box. The `moov` box can be:

1. **At the start of the file** (`moov` first, `mdat` after) — common for streaming-optimized files. First 64KB will contain `moov`.
2. **At the end of the file** (`mdat` first, `moov` last) — common for camera-recorded files (the recorder writes `mdat` as it captures and finalizes `moov` last).

Algorithm in `extractVideoCaptureDate(url)`:

1. Range-fetch bytes `0-65535`.
2. Walk top-level atoms (each atom = 4-byte size + 4-byte type + body). If `moov` found, dive in for `mvhd`, extract `creation_time` (offset 4 in mvhd v0, offset 8 in v1), convert from 1904 epoch to JS `Date`.
3. If no `moov` found in the first 64KB but `mdat` was, do a HEAD request for `Content-Length`, then Range-fetch the last 1MB, and re-walk.
4. If still no `moov`, return `null`.

Edge cases handled by tests: 64-bit atom sizes (`size === 1` → next 8 bytes are the actual size), version-1 mvhd (64-bit `creation_time`), invalid bytes → return `null` not throw.

## Tasks

### T1: Video capture-date extraction

**Files:**

- NEW `src/lib/video-meta.ts`
- NEW `src/lib/video-meta.test.ts`

**API:**

```ts
export async function extractVideoCaptureDate(downloadUrl: string): Promise<Date | null>
```

**Behavior:**

- Range-fetch bytes 0-65535. Walk top-level atoms looking for `moov` (Box ↗ `mvhd` Box).
- If `moov` not found at start, HEAD the URL, then Range-fetch last ~1MB and walk again.
- Parse `mvhd.creation_time` (v0: 32-bit, v1: 64-bit) — seconds since 1904-01-01 → JS `Date`.
- Return `null` on parse error, missing `moov`, or invalid date.
- Throws on network errors (caller decides).

**Acceptance criteria:**

- Given a fixture buffer with `moov` first containing v0 `mvhd` with `creation_time` for `2019-04-27T14:30:00Z`, returns matching `Date`.
- Given a fixture with `moov` at the end (mdat-first layout), returns the same date after the second range fetch.
- Given a fixture with no `mvhd`, returns `null`.
- Given an HTTP 4xx/5xx, returns `null` (does not throw).

**Verification:**

- `pnpm test src/lib/video-meta.test.ts` — all assertions pass.
- Mock `fetch` in tests; never hit the network.

---

### T2: pCloud server-side multi-item fetch

**Files:**

- MODIFY `src/lib/pcloud.server.ts`
- MODIFY `src/lib/pcloud.server.test.ts`

**API:**

```ts
export type MemoryItem =
	| { kind: 'image'; url: string; name: string; captureDate: string }
	| { kind: 'video'; url: string; posterUrl: string; name: string; captureDate: string }

export async function fetchTodayMemories(today: {
	month: number
	day: number
}): Promise<MemoryItem[]>
```

**Behavior:**

1. Read env (existing helper `getEnvConfig`).
2. `client.listfolder(folderId)` → filter via new `isMediaFile` predicate (image/_ OR video/_).
3. For each media file, dispatch capture-date extraction by content type:
   - image → `extractCaptureDate(url)`
   - video → `extractVideoCaptureDate(url)`
   - Skip if `null` or month/day mismatch.
4. Sort matches: `captureDate.getFullYear()` asc, then `fileid` asc.
5. For each match, build a `MemoryItem`:
   - image → `getthumblink` → `{ kind: 'image', url, name, captureDate: iso }`
   - video → `getvideolink` (streaming URL) + `getthumblink` (poster) → `{ kind: 'video', url, posterUrl, name, captureDate: iso }`
6. Return the array (possibly empty).

**Cleanup:** Remove `fetchRandomMemoryImage`, `MemoryImage`, `fetchTodayMemoryImage` (this task supersedes them). Remove `isImageFile`; replace with `isMediaFile`.

**Acceptance criteria:**

- Mocked client with one matching image, one matching video, one non-matching image → returns 2 items in correct order, with correct `kind` and URLs.
- Items without a parseable capture date are skipped.
- Empty folder → returns `[]`.
- Two matches with same year → ordered by `fileid` asc.
- Existing env-validation tests still pass.

**Verification:**

- `pnpm test src/lib/pcloud.server.test.ts` passes.
- All `pcloud-kit` calls mocked; `extractCaptureDate` and `extractVideoCaptureDate` mocked.

---

### T3: Server function contract

**Files:**

- MODIFY `src/lib/pcloud.ts`

**API:**

```ts
export const getTodayMemories = createServerFn({ method: 'GET' })
  .inputValidator(...)  // unchanged
  .handler(async ({ data }): Promise<MemoryItem[]> => {
    const { fetchTodayMemories } = await import('./pcloud.server')
    let target = realToday()
    if (data) {
      const { loadServerUser } = await import('./auth.server')
      const user = await loadServerUser()
      if (user?.isAdmin) target = data
    }
    return fetchTodayMemories(target)
  })
```

**Cleanup:** Remove `getRandomMemoryImage` and the `MemoryImage` re-export.

**Acceptance criteria:**

- `pnpm type-check` clean.
- Admin override flow unchanged: validator parses `{ month, day }`, handler re-checks `isAdmin`.
- No `getRandomMemoryImage` callers remain (verified by typecheck after T4).

---

### CHECKPOINT 1 — Server layer green

Before touching the route:

- `pnpm type-check` clean (will still flag `index.tsx` calling old names — that's T4's territory).
- `pnpm test` green for `pcloud.server.test.ts` and `video-meta.test.ts`.
- `pnpm lint` clean for the new/changed `src/lib/` files.

---

### T4: Route — vertical feed of memories

**Files:**

- MODIFY `src/routes/index.tsx`

**Loader:**

```ts
loader: async ({ deps }) => ({ memories: await getTodayMemories({ data: override }) }),
```

**Render:**

- `Route.useLoaderData()` returns `{ memories: MemoryItem[] }`.
- Wrap the feed in a `Stack` (`gap={8}`).
- Each item renders via `MemoryView` (refactored):
  - `kind === 'image'` → `<Image src={item.url} alt={item.name} />` (existing).
  - `kind === 'video'` → `<chakra.video controls poster={item.posterUrl} src={item.url} />` (or a styled `<video>`).
- Capture date rendered below media (existing pattern).
- Empty state (`memories.length === 0`): show "No memories on this day." (or with admin override caption). **No fallback button.**
- Drop `randomMemory` state, `isLoadingRandom` state, `handleShowRandom`, "Show me a random memory" button, and "Show another random memory" button.
- Admin `DatePicker` stays as-is.
- Sign-out button stays.

**Acceptance criteria:**

- Authenticated visit to `/`:
  - Folder has matching media → vertical feed renders all matches in order, mixed images and videos play/display correctly.
  - Folder has no matches → friendly empty state, no random button visible.
- Admin date override (`?date=YYYY-MM-DD`) re-fetches the array for that month/day.
- Non-admin visiting `/?date=...` silently falls back to real today (server-side gate from v1 unchanged).
- Sign-out works.
- `pnpm type-check`, `pnpm test`, `pnpm lint`, `pnpm format:check` all clean.

**Verification:**

- `pnpm dev` and visit `/` after signing in:
  - On a day with multiple matches (use the admin DatePicker to navigate), confirm feed order and that videos play.
  - On a day with no matches, confirm empty state with no random button.
- Browser DevTools network tab: confirm `getvideolink` returns a usable streaming URL.

---

### CHECKPOINT 2 — End-to-end

Final gate before declaring v2 complete:

- All tests green: `pnpm test`.
- Typecheck clean: `pnpm type-check`.
- Lint + format clean.
- Browser walkthrough of feed rendering, video playback, empty state, admin override.
- No new top-level deps beyond the approved P0 parser approach.
- `git status` shows only the expected files.

## Out of scope for v2 (do not touch)

- Tagging UI / metadata writes / gallery view / search — `SPEC §1` non-goals.
- Netlify Blobs caching — `SPEC §8.3` deferred.
- Video transcoding, thumbnail generation, or any pCloud-side mutation.
- Re-introducing the random fallback — `SPEC §7` "never do."
- Any change to `oxlint.config.ts`, `oxfmt.config.ts`, `vite.config.ts`, `tsconfig.json`, or `.github/workflows/ci.yml` — `SPEC §7` "ask first."

## File touch list

| File                              | Action                                      |
| --------------------------------- | ------------------------------------------- |
| `src/lib/video-meta.ts`           | NEW (T1)                                    |
| `src/lib/video-meta.test.ts`      | NEW (T1)                                    |
| `src/lib/pcloud.server.ts`        | MODIFY (T2)                                 |
| `src/lib/pcloud.server.test.ts`   | MODIFY (T2)                                 |
| `src/lib/pcloud.ts`               | MODIFY (T3)                                 |
| `src/routes/index.tsx`            | MODIFY (T4)                                 |
| `package.json` / `pnpm-lock.yaml` | UNTOUCHED — hand-rolled parser, no new deps |
