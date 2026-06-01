# v16 — Loading screens via TanStack Router pending states

## Overview

Navigating into the admin curation flow (and, to a lesser extent, the home
page) currently shows **no feedback while loaders run**. The worst offender is
folder navigation in `/admin/collection/add`: each subfolder click re-runs the
`getAdminSourceFolder` loader (a slow pCloud `listfolder` call, because
`loaderDeps` keys on `folderid`), and the UI just sits on the previous folder's
content with no indication anything is happening. First entry into
`/admin/collection` and `/admin/collection/add` also renders a blank `Outlet`
region until the loader resolves.

This work adds loading affordances built on **TanStack Router's own pending
machinery** — a global navigation progress bar driven by `useRouterState`, plus
per-route `pendingComponent` skeletons for the routes whose loaders are slow.

Scope is deliberately narrow: feedback for in-flight navigations only. No
loader speedups, no caching changes, no redesign of the admin flow.

## Goals

- Show a global progress indicator during **any** pending navigation —
  including same-route folder switches in the add page, where component state
  (`picked` selections) must be preserved.
- Show layout-shaped skeletons on **first entry** to the slow data routes
  (`/`, `/admin/collection`, `/admin/collection/add`) instead of a blank gap.
- Use router properties (`defaultPendingMs`, `defaultPendingMinMs`,
  `pendingComponent`, `defaultPendingComponent`, `useRouterState`) — not
  ad-hoc loading flags threaded through components.

## Non-goals

- Speeding up the pCloud loaders or adding folder-listing caches.
- Preloading folder listings on hover (folder tiles are `<button>`s, not
  `<Link>`s; out of scope).
- Skeletons for `/login` (no slow loader) or the API routes.

## Key technical decisions & assumptions

> These gate the design. **Decision #1 must be verified against TanStack docs
> and a real browser before building Slices 2–4** (source-driven step in
> Phase 1/2). If it proves false, the fallback is recorded below.

1. **`pendingComponent` shows only on a route's *initial* match, not on
   background reloads of an already-active route.** When you switch folders in
   `/admin/collection/add`, only `loaderDeps.folderid` changes — the route stays
   matched, so TanStack does a stale-while-revalidate reload and keeps the
   component mounted (this is why `picked` survives folder navigation today).
   Therefore adding a `pendingComponent` to that route is safe: it appears on
   first entry only and will **not** remount the component (or drop `picked`)
   on folder switches.
   - **Verification:** confirm in TanStack Router docs that `pendingComponent`
     is not rendered for same-route loader reloads, then prove it manually
     (switch folders with items picked → selections persist, no skeleton
     flash). See Phase 2, Task 2a.
   - **Fallback if false:** do **not** add a `pendingComponent` to the add
     route. Rely on the global progress bar (Slice 1) for folder-switch
     feedback, and add an inline dimming overlay over the file grid keyed on
     `useRouterState` pending status (keeps the component mounted). The list
     and home skeletons (Slices 3–4) are unaffected — those routes don't carry
     state across reloads.

2. **`useRouterState({ select })` exposes navigation status.** Read pending via
   a `select` projection (e.g. `s.status === 'pending'` / `s.isLoading`) so the
   subscription only re-renders on that slice. Exact field name confirmed in
   Phase 1 against the installed `@tanstack/react-router` version.

3. **Chakra UI v3 already ships `Skeleton` / `SkeletonText`.** Use them for the
   skeleton building blocks rather than hand-rolling shimmer. Only the
   per-route *layout arrangement* of skeletons is bespoke. (No new dependency —
   honors SPEC §7 "Ask first" on deps.)

4. **Presentational split for testability.** Router-coupled components
   (`useRouterState`) are hard to unit-test. Each new piece is split into a
   thin router-reading wrapper + a pure presentational component. Browser tests
   target the pure part, matching the existing `*.browser.test.tsx` convention
   (props in, render asserted) — e.g. `AdminMediaDateFilter.browser.test.tsx`.

## Component / dependency graph

```
__root.tsx
  └─ <NavigationProgress/>            (Slice 1)  reads useRouterState
        └─ <ProgressBar active/>      pure, tested

src/router.tsx
  └─ defaultPendingMs / MinMs         (Slice 2)  shared config
  └─ defaultPendingComponent          (Slice 2)  global fallback skeleton

routes/admin/collection/add.tsx
  └─ pendingComponent: <AddSkeleton/> (Slice 2)  gated on Decision #1

routes/admin/collection.tsx (layout) + /index.tsx
  └─ pendingComponent: <CollectionListSkeleton/> (Slice 3)

routes/index.tsx (home)
  └─ pendingComponent: <HomeSkeleton/>           (Slice 4)
```

Dependency notes:
- Slice 1 is **fully independent** and the single highest-value change (it is
  the only thing that gives feedback on folder switches). Do it first.
- Slices 2–4 share the router pending-timing config (lands in Slice 2) and all
  depend on the Chakra `Skeleton` primitive being confirmed available (Phase 1).
- Slice 2 additionally depends on Decision #1's verification gate.
- Slices 3 and 4 are independent of each other.

## Phases

### Phase 1 — Foundations & verification (read/confirm only)
Confirm router API surface and skeleton primitives before writing UI.
- Confirm `useRouterState` pending field name and `defaultPending*` options in
  the installed router version (source-driven).
- Confirm Chakra v3 `Skeleton`/`SkeletonText` import path and props.
- **Checkpoint 1:** API surface confirmed; Decisions #2 and #3 resolved in
  writing (note findings inline in todo). Proceed.

### Phase 2 — Slice 1: global navigation progress bar
Deliver feedback for every navigation, including folder switches.
- Task 1a: `ProgressBar` pure component + browser test.
- Task 1b: `NavigationProgress` wrapper (`useRouterState`) mounted in
  `__root.tsx`.
- Task 2a: **Decision #1 verification** — confirm folder switches do not
  trigger `pendingComponent` / remount (docs + manual). Record result.
- **Checkpoint 2:** Manually verify the bar appears on: home→admin link,
  list→add, and folder→folder switches; `picked` selections survive a folder
  switch. If Decision #1 is false, switch Slice 2 to the fallback approach
  before continuing.

### Phase 3 — Slices 2–4: per-route entry skeletons
One vertical slice per slow route, each independently shippable.
- Slice 2: router `defaultPendingMs`/`MinMs` + `defaultPendingComponent` +
  `AddSkeleton` `pendingComponent` on `/admin/collection/add` (or fallback
  overlay per Decision #1).
- Slice 3: `CollectionListSkeleton` `pendingComponent` on `/admin/collection`.
- Slice 4: `HomeSkeleton` `pendingComponent` on `/`.
- **Checkpoint 3:** Full pass — `pnpm type-check`, `pnpm lint`, `pnpm test`,
  `pnpm build`. Manual smoke of all three routes' first-entry skeletons and the
  global bar. No regression to `picked` persistence or auth redirects.

## Risks

- **State loss on the add route (high impact)** — mitigated by Decision #1's
  verification gate and the documented fallback. This is the one thing that
  could turn a UX improvement into a regression; it is checked before shipping
  Slice 2.
- **Skeleton flash on fast loads** — mitigated by `defaultPendingMs` (skeletons
  only after a threshold) and `defaultPendingMinMs` (no sub-perceptual flash).
  Tune values during Checkpoint 3.
- **SSR/hydration** — the progress bar must render consistently on server and
  client. Keep it presentational and status-driven; verify no hydration
  warning in the console during Checkpoint 2.
- **Auth redirect interaction** — `beforeLoad` redirects (login / non-admin)
  must still fire; skeletons are loader-pending UI and should not mask a
  redirect. Verified in Checkpoint 3.

## Verification (global)

- `pnpm type-check`, `pnpm lint`, `pnpm test` (unit + browser) green.
- `pnpm build` succeeds; afterwards delete `dist` + Netlify cache (per SPEC).
- Manual: throttle network (or rely on real pCloud latency) and confirm each
  affordance described per slice.
- No new top-level dependency added (Chakra `Skeleton` is already present).
