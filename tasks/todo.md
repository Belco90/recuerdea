# Admin "Añadir más": three tabs (Hoy / Mañana / Navegar)

> Flatten the admin add-content page: today/tomorrow tabs surface every matching
> item across the whole pCloud source tree (Spain TZ), no folder drilling.
> See `tasks/plan.md` for rationale, decisions, and risks.

## Slice 1 — Spain date helpers (pure, unit-tested first)

- [x] `getTomorrowInSpain(now?)` in `src/lib/utils/spain-today.ts` (calendar arithmetic)
- [x] `spainMonthDay(iso)` in `src/lib/utils/spain-today.ts`
- [x] Unit tests: rollover (month/year), UTC↔Madrid boundary, null/invalid
- [x] Verify: `npm run test:unit`, `npm run type-check`

## Slice 2 — Server: recursive day-media fetch

- [x] `collectMediaRecursive` + `fetchAdminSourceDayMedia` + `SourceDayMedia` in `source-folder.server.ts`
- [x] `getAdminSourceDayMedia` server fn + `AdminSourceDayResult` in `source-folder.ts`
- [x] Server tests: flatten across nesting, day-match, skip non-media/null, newest-first, `recursive:1`
- [x] Verify: `npm run test:unit`, `npm run type-check`

## Slice 3 — Extract shared grid components

- [x] Create `src/components/AdminMediaGrid.tsx` (FileGrid/EmptyMedia/StickyFooter, item-based onToggle, `emptyMessage`)
- [x] Update `AdminFolderNavigator.tsx` to consume it; drop footer + save/cancel/saving props
- [x] New `AdminMediaGrid.browser.test.tsx`; update navigator test (toggle → item)
- [x] Verify: `npm run test:browser`, `npm run type-check`; regenerate screenshots

## Slice 4 — Date filter: drop preset buttons

- [x] Remove Hoy/Mañana buttons from `AdminMediaDateFilter.tsx`; keep calendar
- [x] Update `AdminMediaDateFilter.browser.test.tsx`
- [x] Verify: `npm run test:browser`

## Slice 5 — Route: tabs, branched loader, shared footer

- [x] `tab` search param + validation; `loaderDeps` default `hoy`; branched loader (day vs navigate)
- [x] Controlled `Tabs.Root` (Hoy/Mañana/Navegar); active-tab body keyed off `mode`
- [x] Page-level shared `StickyFooter` + item-based `handleToggle`
- [x] (optional) tab strip in `AddSkeleton`
- [x] Verify: `npm run type-check`, `npm run test`, `npm run build`

## Final gate

- [x] `npm run lint`, `npm run format:check`
- [ ] Manual walkthrough (admin login, PCLOUD_SOURCE_FOLDER_ID set): default Hoy, Mañana, Navegar,
      cross-tab selection + Guardar, missing-config banner — **pending: needs running dev server**
