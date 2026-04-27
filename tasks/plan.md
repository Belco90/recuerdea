# Recuerdea v1 Implementation Plan — "Today's Memory"

## Context

`SPEC.md` defines v1 as a single feature: visiting `/` shows an image whose EXIF capture date matches today's month/day across past years, with a friendly empty state + random fallback when nothing matches.

The current home page (`src/routes/index.tsx:17`) calls `getFirstMemoryImage()` which lists a pCloud folder and returns the first image with no date filtering. To meet v1 acceptance criteria, we need to (a) read EXIF capture dates, (b) filter by today's month/day, (c) wire a "show random memory" fallback.

This plan slices the work vertically: each task delivers a complete, testable layer that the next task builds on. Stack constraints from `SPEC.md` §7 are honored — no framework swaps, all secrets stay behind `createServerFn`, all `src/lib/` logic colocated with Vitest browser-mode tests.

## Prerequisite (blocking — needs human approval)

### P0: EXIF library decision

`SPEC.md` §8.1 flags this as "ask first." Recommended candidate:

- **`exifr`** — works in both browser and Node (we run server-side via `createServerFn`), supports tag-scoped parsing (`exifr.parse(buf, ['DateTimeOriginal'])`), tiny segment-only build available, ~6KB minified. Most active npm package (last release 2024).
- Alternatives: `exif-reader` (Node-only, no Range support), `exif-parser` (Node-only, unmaintained), `piexifjs` (browser-only, has writer support we don't need).

**Decision needed before T1 begins.** No code changes commit until this is approved.

## Dependency Graph

```
P0: EXIF library approval
    │
    ▼
T1: src/lib/exif.ts (extractCaptureDate)
    + src/lib/exif.test.ts
    │
    ▼
T2: src/lib/pcloud.server.ts
    (fetchTodayMemoryImage, fetchRandomMemoryImage)
    + update src/lib/pcloud.server.test.ts
    │
    ▼
T3: src/lib/pcloud.ts
    (getTodayMemoryImage, getRandomMemoryImage server functions)
    │
    ▼
[CHECKPOINT 1: server layer returns correct shape]
    │
    ▼
T4: src/routes/index.tsx
    (loader + today/empty/random UI)
    │
    ▼
[CHECKPOINT 2: end-to-end via dev server]
```

## Architecture Decisions

### How EXIF is read from pCloud images

`pcloud-kit` `FileMetadata` exposes `created` and `modified` (filesystem dates from pCloud, not EXIF). To get true EXIF capture dates we must read the image's binary header.

For each image in the folder:

1. Call `client.getfilelink(fileid)` → direct download URL (typed `Client` method).
2. Fetch first 65536 bytes via HTTP `Range: bytes=0-65535` header — EXIF lives in the first JPEG segments, almost always under 64KB.
3. Pass `ArrayBuffer` to `exifr.parse(buf, ['DateTimeOriginal', 'DateTime'])`.
4. Prefer `DateTimeOriginal`; fall back to `DateTime`; return `null` if neither present.

This is acceptable for v1's expected library size (a personal photo folder, 10² order of magnitude). For larger libraries this becomes O(N) network fan-out per page load — `SPEC.md` §8.3 flags Netlify Blobs caching as a v2 concern.

### Multi-match tie-break (resolves SPEC §8.2)

When multiple images share today's month/day, sort by EXIF year ascending and pick the first (oldest year wins). Tie-break ties by `fileid` ascending. **Deterministic per (folder state, today)** — same image surfaces all day. Decision is documented in code via a comment on the sort.

### Random fallback

`fetchRandomMemoryImage` lists images and picks one at uniform random per request (`Math.random`). No EXIF parse needed for the fallback — random is "show me anything," and parsing every image again would be wasteful. `MemoryImage.captureDate` is `string | null` so the random path can return `null` for the date.

### Type changes

`MemoryImage` (in `pcloud.server.ts`) gains an optional `captureDate: string | null` field — ISO date string or null. `Date` objects don't survive the `createServerFn` JSON boundary, so we serialize as ISO and format on the client.

## Tasks

### T1: EXIF extraction utility

**Files:**

- NEW `src/lib/exif.ts`
- NEW `src/lib/exif.test.ts`

**API:**

```ts
export async function extractCaptureDate(downloadUrl: string): Promise<Date | null>
```

**Behavior:**

- Fetches `downloadUrl` with `Range: bytes=0-65535`.
- Parses EXIF via `exifr.parse(buffer, ['DateTimeOriginal', 'DateTime'])`.
- Returns `Date` from `DateTimeOriginal`, falling back to `DateTime`, then `null`.
- Throws on network errors (caller decides whether to swallow).

**Acceptance criteria:**

- Given a JPEG buffer with `DateTimeOriginal: 2019-04-27 14:30:00`, returns a `Date` with year 2019, month 4, day 27.
- Given a JPEG without EXIF, returns `null`.
- Given a non-image response, returns `null` (does not throw — `exifr` handles this).

**Verification:**

- `pnpm test src/lib/exif.test.ts` passes.
- Mock `fetch` in tests; do not hit the network.

---

### T2: pCloud "today" + random selection

**Files:**

- MODIFY `src/lib/pcloud.server.ts`
- MODIFY `src/lib/pcloud.server.test.ts` (existing — adapt expectations)

**API:**

```ts
export type MemoryImage = {
	url: string
	name: string
	captureDate: string | null // ISO date string
}

export async function fetchTodayMemoryImage(today: {
	month: number
	day: number
}): Promise<MemoryImage | null>

export async function fetchRandomMemoryImage(): Promise<MemoryImage | null>
```

**Behavior — `fetchTodayMemoryImage`:**

1. Read `PCLOUD_TOKEN` and `PCLOUD_MEMORIES_FOLDER_ID` from env (existing logic — extract to a small helper or keep inline).
2. `client.listfolder(folderId)` → filter to image files (existing predicate at `pcloud.server.ts:21`).
3. For each image:
   - `client.getfilelink(fileid)` → direct URL.
   - `extractCaptureDate(url)` → `Date | null`.
   - Skip if null or month/day doesn't match `today`.
4. Sort matches by `captureDate.getFullYear()` asc, then `fileid` asc.
5. Pick `[0]`. Get its thumbnail via `getthumblink` (existing pattern at `pcloud.server.ts:25`).
6. Return `{ url, name, captureDate: capture.toISOString() }` or `null` if no matches.

**Behavior — `fetchRandomMemoryImage`:**

1. Same env + listfolder + image-filter as above.
2. `Math.floor(Math.random() * images.length)` → pick.
3. Get thumbnail URL.
4. Return `{ url, name, captureDate: null }` or `null` if folder empty.

**Cleanup:** Remove `fetchFirstMemoryImage` — it's only referenced by `pcloud.ts` which T3 rewrites.

**Acceptance criteria:**

- With a mocked client returning 3 images (one matching today by EXIF, one matching by EXIF on a different day, one without EXIF), `fetchTodayMemoryImage(today)` returns the matching one with correct ISO `captureDate`.
- With no matches, returns `null`.
- `fetchRandomMemoryImage()` always returns a `MemoryImage` when folder is non-empty.

**Verification:**

- `pnpm test src/lib/pcloud.server.test.ts` passes after expectations are updated.
- Mock `pcloud-kit`'s `createClient` and `extractCaptureDate` (or `fetch`); no real network.

---

### T3: Server function contract

**Files:**

- MODIFY `src/lib/pcloud.ts`

**API:**

```ts
export const getTodayMemoryImage = createServerFn({ method: 'GET' }).handler(
	async (): Promise<MemoryImage | null> => {
		const { fetchTodayMemoryImage } = await import('./pcloud.server')
		const now = new Date()
		return fetchTodayMemoryImage({ month: now.getMonth() + 1, day: now.getDate() })
	},
)

export const getRandomMemoryImage = createServerFn({ method: 'GET' }).handler(
	async (): Promise<MemoryImage | null> => {
		const { fetchRandomMemoryImage } = await import('./pcloud.server')
		return fetchRandomMemoryImage()
	},
)
```

**Notes:**

- Today's date is computed server-side. No client input → no validators needed → no input-injection surface.
- `getFirstMemoryImage` is removed (caller updated in T4).

**Acceptance criteria:**

- `pnpm typecheck` passes.
- Both functions are callable from the client (any module that imports them) and return the typed `Promise<MemoryImage | null>`.

---

### CHECKPOINT 1 — Server layer verified

Before touching the route, verify the server layer in isolation:

- `pnpm typecheck` clean.
- `pnpm test` green (T1 + updated T2 tests pass).
- Manually call `getTodayMemoryImage()` from a scratch script or temporary log in dev to confirm shape against a real pCloud folder. (Optional but cheap insurance against EXIF-parse surprises with real data.)

If any of these fails, fix before starting T4.

---

### T4: Home route + today/empty/random UI

**Files:**

- MODIFY `src/routes/index.tsx`

**Loader:**

```ts
loader: async () => ({ memory: await getTodayMemoryImage() }),
```

**Component:**

- Three render states:
  1. **Today match** (`memory != null`): `<Image>` + `<Text>` showing formatted year (e.g. "Taken 27 April 2019" — derived from `memory.captureDate` via `Intl.DateTimeFormat`).
  2. **Empty + no random yet** (`memory == null && randomMemory == null`): heading "No memories on this day" + Chakra `<Button>` "Show me a random memory" calling `getRandomMemoryImage()`.
  3. **Random shown** (`randomMemory != null`): same image+caption layout as state 1, plus "Show another random memory" button.
- Local state: `const [randomMemory, setRandomMemory] = useState<MemoryImage | null>(null)` and `const [isLoading, setIsLoading] = useState(false)`.
- The "Show random" handler calls `getRandomMemoryImage()` directly (it's a `createServerFn`, callable from the browser).
- Existing pieces preserved: `beforeLoad` auth guard (`pcloud.server.ts:8` pattern), Chakra layout, sign-out button, `useIdentity()`.

**Acceptance criteria:**

- When today's pCloud folder has a matching image: the image + capture year render at `/`.
- When no match: empty-state heading + button render. Clicking the button replaces the empty state with a random image and shows a "Show another" button.
- Authenticated guard still works (unauthenticated → `/login`).
- Sign-out still works.

**Verification:**

- `pnpm dev` and visit `/` in a browser:
  - Verify match path with a date that has photos.
  - Verify empty path by temporarily forcing `getTodayMemoryImage` to return `null` (or by visiting on a date with no matches).
  - Verify random button flow.
- `pnpm typecheck && pnpm test && pnpm lint` clean.

---

### CHECKPOINT 2 — End-to-end verification

Final gate before declaring v1 complete:

- All tests green: `pnpm test`.
- Typecheck clean: `pnpm typecheck`.
- Lint + format clean: `pnpm lint && pnpm format` (the pre-commit hook also enforces this).
- Manual browser walk-through of all three render states.
- `git status` shows only the expected files modified (no `routeTree.gen.ts` hand-edits, no stray config changes).
- No new top-level deps beyond the approved EXIF library.

## Out of scope for this plan (do not touch)

- Tagging UI, metadata writes, gallery view, search — `SPEC.md` §1 non-goals.
- Netlify Blobs caching — `SPEC.md` §8.3 v2 concern.
- pCloud caching layer / Range-fetch optimizer — call out as v2 if performance hurts in practice.
- Any change to `oxlint.config.ts`, `oxfmt.config.ts`, `vite.config.ts`, `tsconfig.json`, or `.github/workflows/ci.yml` — `SPEC.md` §7 "ask first."

## File touch list

| File                            | Action                                                     |
| ------------------------------- | ---------------------------------------------------------- |
| `src/lib/exif.ts`               | NEW (T1)                                                   |
| `src/lib/exif.test.ts`          | NEW (T1)                                                   |
| `src/lib/pcloud.server.ts`      | MODIFY (T2)                                                |
| `src/lib/pcloud.server.test.ts` | MODIFY (T2)                                                |
| `src/lib/pcloud.ts`             | MODIFY (T3)                                                |
| `src/routes/index.tsx`          | MODIFY (T4)                                                |
| `package.json`                  | MODIFY — add `exifr` (or chosen library) after P0 approval |
| `pnpm-lock.yaml`                | MODIFY — auto-generated by `pnpm add`                      |
