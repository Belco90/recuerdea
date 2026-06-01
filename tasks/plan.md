# Admin "Añadir más": three tabs (Hoy / Mañana / Navegar)

## Context

The admin add-content page (`/admin/collection/add`) recently gained a date filter — a
calendar `DatePicker` plus "Hoy"/"Mañana" preset buttons — but the admin still has to click
through nested pCloud folders one level at a time to find items. The goal is to flatten that:
the admin should see **every** matching item across the whole source tree at once.

Restructure the page into three Chakra v3 tabs:

- **Hoy** — all source media (recursively across nested folders) whose capture month+day match
  **today in Spain (Europe/Madrid)**, flattened into one grid. No folder navigation.
- **Mañana** — same, for tomorrow's month+day in Spain.
- **Navegar** — the existing folder navigator moved here as-is, keeping the calendar
  `DatePicker`. The "Hoy"/"Mañana" **preset buttons are removed** (they're now tabs).

Confirmed product decisions:

- **Timezone:** Hoy/Mañana resolve to Spain (Europe/Madrid), server-side — consistent with the
  home page memory matcher and the refresh cron. (The Navegar calendar stays browser-local; this
  divergence is intentional and documented in code.)
- **Default tab:** `Hoy` (the primary new use case).
- **Selection:** shared across all tabs — one running `picked` set and one sticky footer;
  `Guardar (N)` commits picks made across Hoy, Mañana and Navegar together.

## Approach

Per-tab data loads via a new `tab` URL search param that is a `loaderDep`; the route loader
**branches** so the slow recursive listing only runs for Hoy/Mañana and the existing folder fetch
only runs for Navegar. This reuses the route's existing `pendingComponent: AddSkeleton` for free
tab-switch loading and matches the established `folderid`/`date` URL-state pattern. Picking state
(`picked`/`saving`/`blocked`) and a single `StickyFooter` live at the page level, outside the tabs.

The recursive listing is one pCloud call: `listfolder` supports `recursive: 1`
(`ListFolderOptions.recursive`), returning nested `FolderMetadata.contents`; we walk it to collect
all media files. Day-matching derives each file's month+day from `created` in Europe/Madrid and
compares (year-agnostic) to the Spain target — the same "on this day" rule the home loader uses.

## Slices

Each slice is an independently verifiable path. Build in order.

### Slice 1 — Spain date helpers (pure, unit-tested first)

**Modify `src/lib/utils/spain-today.ts`** — add, reusing the existing `Europe/Madrid` formatter:

- `getTomorrowInSpain(now = new Date()): MonthDay` — resolve **tomorrow's** Madrid month+day.
  Use calendar (date-component) arithmetic, NOT `+24h` wall-clock: read Madrid's full Y-M-D for
  `now`, construct a UTC date from those parts, add one day, re-read month/day. Handles
  month/year rollover and DST correctly.
- `spainMonthDay(iso: string | null): MonthDay | null` — ISO instant → `{month, day}` in Madrid,
  or null for null/unparseable input. Used to match a file's `created` against the target.

**Modify `src/lib/utils/spain-today.test.ts`** — cases for `getTomorrowInSpain` (normal,
end-of-month rollover, year rollover, UTC-vs-Madrid late-evening boundary) and `spainMonthDay`
(valid, null/invalid, UTC-late instant landing on next Madrid day).

Verify: `npm run test:unit`, `npm run type-check`.

### Slice 2 — Server: recursive day-media fetch

**Modify `src/lib/admin/source-folder.server.ts`** — add, reusing existing `isMediaFile`,
`buildFiles`, `assertSourceFolderId`, `toIso`, `ListfolderResponse`:

- `collectMediaRecursive(node: FolderMetadata, out: FileMetadata[]): void` — walk `node.contents`;
  recurse into `item.isfolder`, push media files.
- `type SourceDayMedia = { which: 'today' | 'tomorrow'; target: MonthDay; files: readonly SourceFileItem[] }`
- `fetchAdminSourceDayMedia(client, { which, now? }): Promise<SourceDayMedia>`:
  - `const sourceRoot = assertSourceFolderId()`
  - `target = which === 'today' ? getTodayInSpain(now) : getTomorrowInSpain(now)`
  - `client.call<ListfolderResponse>('listfolder', { folderid: sourceRoot, recursive: 1, noshares: 1 })`
  - collect media recursively, filter by `spainMonthDay(toIso(f.created))` matching `target` month+day,
    sort newest-first (`Date.parse(b.created) - Date.parse(a.created)`), map via `buildFiles`.
  - Comment: day-match is in Europe/Madrid (Spain's today/tomorrow), unlike the browser-local
    Navegar calendar filter. No breadcrumbs / no `FolderNotPermittedError` (always starts at root).

**Modify `src/lib/admin/source-folder.ts`** — add a server fn mirroring `getAdminSourceFolder`'s
admin-gate + `makeClient` + dynamic `await import('./source-folder.server')` convention:

- `type AdminSourceDayResult = { status: 'ok'; day: SourceDayMedia } | { status: 'source-folder-id-missing' }`
- `parseDayInput(input): { which: 'today' | 'tomorrow' }`
- `getAdminSourceDayMedia = createServerFn({ method: 'GET' })` → gate, fetch, map
  `SourceFolderIdMissingError` to the missing-config status.
- Re-export the `SourceDayMedia` type alongside the existing re-exports.

**Modify `src/lib/admin/source-folder.server.test.ts`** — add `describe('fetchAdminSourceDayMedia')`
reusing the existing `makeClient`/`makeFolder`/`makeFile` test helpers: nested tree with files at
various `created` dates and mixed media/non-media; pass a fixed `now`; assert only matching
month-day files returned, flattened across nesting, non-media skipped, null/unparseable `created`
dropped, newest-first order, and that `listfolder` was called with `recursive: 1`.

Verify: `npm run test:unit`, `npm run type-check`.

### Slice 3 — Extract shared grid components

**Create `src/components/AdminMediaGrid.tsx`** — move `FileGrid`, `EmptyMedia`, `StickyFooter`
out of `AdminFolderNavigator.tsx` verbatim (plus `TileButton = chakra('button')` and the lucide
`Check`/`Play` imports they need); export all three.

- Change `FileGrid`'s `onToggle` to `(item: SourceFileItem) => void` and call `onToggle(file)`
  (was `onToggle(file.fileid)`) — needed so picks work across multiple datasets without per-dataset
  lookups (shared-selection decision).
- Add optional `emptyMessage?: string` to `EmptyMedia` (defaults to the current dateFilter logic)
  so Hoy/Mañana can show e.g. "No hay fotos ni vídeos de hoy en todo el archivo."

**Modify `src/components/AdminFolderNavigator.tsx`** — import `FileGrid`/`EmptyMedia` from
`./AdminMediaGrid`; remove their local defs and the now-unused `StickyFooter` (footer moves to page
level). Drop `onSave`/`onCancel`/`saving` from `AdminFolderNavigatorProps`; change `onToggle` prop
type to `(item: SourceFileItem) => void`. Keep `Breadcrumbs`/`SubfolderGrid` here (Navegar-only).

**Tests** — move Save/Cancel/footer assertions out of
`AdminFolderNavigator.browser.test.tsx` into a new `AdminMediaGrid.browser.test.tsx` (covers
`FileGrid` picked-border / blocked-aria / video-badge / toggle-passes-item, `StickyFooter`
count+disabled-while-saving+cancel, `EmptyMedia` default/date-filter/custom-message). Update the
navigator's toggle test to assert it fires with the **item**, not the fileid.

Verify: `npm run test:browser`, `npm run type-check`. Regenerate `__screenshots__` baselines for
moved/renamed tests and review diffs.

### Slice 4 — Date filter: drop preset buttons

**Modify `src/components/AdminMediaDateFilter.tsx`** — remove the two preset `Button`s and the
unused `todayLocal`/`tomorrowLocal` import + locals. Keep the `Text` label + `DatePicker.Root`
block intact. (`todayLocal`/`tomorrowLocal` remain exported in `date-filter.ts`, still unit-tested,
just no longer used here.)

**Modify `src/components/AdminMediaDateFilter.browser.test.tsx`** — remove the Hoy/Mañana
preset-toggle tests; keep/ensure a `DatePicker` onChange test.

Verify: `npm run test:browser`.

### Slice 5 — Route: tabs, branched loader, shared footer

**Modify `src/routes/admin/collection/add.tsx`**:

Search + loader:

- `type TabKey = 'hoy' | 'mañana' | 'navegar'`; add `tab?: TabKey` to `AddSearch`; validate in
  `validateSearch` (only accept the three literals).
- `loaderDeps: ({ search }) => ({ folderid: search.folderid, tab: search.tab ?? 'hoy' })`
  (default **Hoy**). Keep `date` out of `loaderDeps`.
- Loader returns a discriminated union on `mode`:
  - `tab` is `hoy`/`mañana` → `{ mode: 'day', day: await getAdminSourceDayMedia({ data: { which } }) }`
    (`which = tab === 'hoy' ? 'today' : 'tomorrow'`).
  - else → `{ mode: 'navigate', source: await getAdminSourceFolder({ data: { folderid } }) }`.

Component:

- Read `tab` (default `'hoy'`) and `date` from `Route.useSearch()`. Keep `picked`/`saving`/`blocked`
  at page level; use item-based `handleToggle(item: SourceFileItem)`.
- `handleTabChange(next)` → `router.navigate({ search: (prev) => ({ ...prev, tab: next }) })`.
- Controlled `Tabs.Root value={tab} onValueChange={(e) => handleTabChange(e.value as TabKey)}` with
  `Tabs.List` of three `Tabs.Trigger` (Hoy/Mañana/Navegar) and three `Tabs.Content`. Render the
  data-bearing body only in the active tab's `Tabs.Content`, keyed off `loaderData.mode`; inactive
  panels render nothing (clicking a trigger re-navigates → loader runs → `AddSkeleton`).
  - **Day body** (`mode === 'day'`): if `day.status === 'source-folder-id-missing'` →
    `SourceFolderMissingBanner`; else `FileGrid` with `files={day.day.files}`,
    `picked={new Set(picked.keys())}`, `blocked`, `onToggle={handleToggle}`; empty → `EmptyMedia`
    with the "todo el archivo" message.
  - **Navigate body** (`mode === 'navigate'`): existing `source.status` banners, then
    `<AdminMediaDateFilter value={date} onChange={handleDateChange} />` +
    `<AdminFolderNavigator listing={{...source.listing, files: filterFilesByDay(source.listing.files, date)}} ... dateFilterActive={date !== undefined} />`
    (now without `onSave`/`onCancel`/`saving`).
- **Shared footer:** one `StickyFooter` (from `AdminMediaGrid`) below the Tabs, gated on
  `picked.size > 0`, wired to `handleSave([...picked.keys()])` and `handleCancel`.
- Optional polish: add a three-tab strip to `AddSkeleton` in `RouteSkeletons.tsx`.

Optional route-level browser test if the harness supports mounting with mocked loader data;
otherwise rely on component-level coverage + manual verification.

Verify: `npm run type-check`, `npm run test`, `npm run build`.

## Critical files

- `src/routes/admin/collection/add.tsx` — tabs, branched loader, shared footer, item-toggle
- `src/lib/admin/source-folder.server.ts` — `collectMediaRecursive`, `fetchAdminSourceDayMedia`
- `src/lib/admin/source-folder.ts` — `getAdminSourceDayMedia` server fn
- `src/lib/utils/spain-today.ts` — `getTomorrowInSpain`, `spainMonthDay`
- `src/components/AdminMediaGrid.tsx` (new) — extracted `FileGrid`/`EmptyMedia`/`StickyFooter`
- `src/components/AdminFolderNavigator.tsx` — consume shared grid, drop footer/save props
- `src/components/AdminMediaDateFilter.tsx` — remove preset buttons, keep calendar

## Verification (end-to-end)

1. `npm run type-check` — clean (union loader return, item-based `onToggle`, new server fn types).
2. `npm run test:unit` — Spain helpers (Slice 1) + recursive day-media (Slice 2) green.
3. `npm run test:browser` — AdminMediaGrid (new), AdminFolderNavigator/AdminMediaDateFilter
   (updated); regenerate + review `__screenshots__` baselines.
4. `npm run lint` (oxlint) and `npm run format:check` (oxfmt).
5. `npm run build` — confirms the `.server.ts` dynamic-import convention keeps server-only code out
   of the client bundle.
6. Manual (`npm run dev`, admin login, `PCLOUD_SOURCE_FOLDER_ID` set):
   - Land on `/admin/collection/add` → opens on **Hoy** with a flat grid of all subtree items for
     today's Spain month-day (across nested folders, any year).
   - **Mañana** → `?tab=mañana`, flat grid for tomorrow.
   - **Navegar** → `?tab=navegar`, folder navigator + calendar; no Hoy/Mañana preset buttons.
   - Pick in Hoy, switch to Mañana, pick more, switch to Navegar, pick more → footer count
     accumulates across tabs; `Guardar (N)` commits all → redirect to `/admin/collection`;
     committed items show blocked.
   - Unset `PCLOUD_SOURCE_FOLDER_ID` → all tabs show the missing-config banner.

## Risks

- **Large recursive listing**: one `listfolder recursive:1` on a big archive can be slow/large.
  Runs server-side, gated, only when Hoy/Mañana active; `pendingComponent` covers latency. Future:
  server-side cache if needed (out of scope).
- **Thumbnail proxy load**: a dense day-grid hits `/api/admin/thumb/:fileid` per tile; `FileGrid`'s
  `loading="lazy"` bounds this to the viewport. Consider pagination later if days are very dense.
- **TZ edge cases**: `getTomorrowInSpain` must use calendar arithmetic (covered by Slice 1 tests).
- **Screenshot baselines** churn from moving `FileGrid`/`StickyFooter` and the `onToggle` signature
  change — regenerate and review.

> Note: this plan lives at the plan-mode path. The `/plan` request also mentioned `tasks/plan.md`
> and `tasks/todo.md`; those can be created at the start of implementation (plan mode only permits
> editing this plan file).
