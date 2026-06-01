# v16 — Loading screens via TanStack Router pending states

> Feedback for in-flight navigations. Global progress bar (covers folder
> switches, preserves state) + per-route entry skeletons for slow loaders.
> See `tasks/plan.md` for rationale, the dependency graph, and risks.
> **Gate:** Decision #1 (Task 2a) must pass before Slice 2 ships.

---

## Phase 1 — Foundations & verification

- [x] **T1.1 — Confirm router pending API.** ✅ `RouterState` (router-core
      1.168.15 `router.d.ts:390`) has `status: 'pending' | 'idle'`,
      `isLoading: boolean`, `isTransitioning: boolean`. Use
      `useRouterState({ select: (s) => s.status === 'pending' })` for the global
      bar. `createRouter` options: `defaultPendingMs` (default **1000**),
      `defaultPendingMinMs` (default **500**), `defaultPendingComponent`.
- [x] **T1.2 — Confirm Chakra `Skeleton`.** ✅ `@chakra-ui/react` v3.34 exports
      `Skeleton`, `SkeletonText`, `SkeletonCircle`. `SkeletonProps extends
    HTMLChakraProps<"div">` → standard `height`/`width`/`borderRadius`/
      `aspectRatio` style props. `SkeletonText` has `noOfLines`.
- [x] **CHECKPOINT 1:** ✅ API surface confirmed; Decisions #2, #3 resolved.
      Decision #1 also gets source support: `load-matches.js:470` — a
      previously-successful match reloads in the background returning the prior
      resolved match, so the component stays mounted (not replaced by
      `pendingComponent`) on same-route reloads. Still confirmed manually at
      Checkpoint 2.

---

## Phase 2 — Slice 1: global navigation progress bar

- [x] **T2.1 — `ProgressBar` (pure).** ✅ `src/components/ProgressBar.tsx`:
      fixed-top `role="progressbar"` bar (`aria-label="Cargando"`), accent
      indeterminate sweep (`progressSlide` keyframe added to `theme.ts`),
      returns `null` when inactive. Browser test
      `ProgressBar.browser.test.tsx` asserts both states — `pnpm test:browser`
      green (55 tests pass).
- [x] **T2.2 — `NavigationProgress` (wrapper).** ✅
      `src/components/NavigationProgress.tsx` reads
      `useRouterState({ select: (s) => s.status === 'pending' })`; mounted in
      `RootDocument` (`__root.tsx`) inside the providers, above `{children}`.
      Type-check + build green.
- [x] **T2.3 — Decision #1 verification (GATE).** ✅ **PASS** — verified by
      automated integration test
      `src/routes/pending-reload-behavior.browser.test.tsx`: a route with a
      `pendingComponent` + `pendingMs: 5` and a 40ms loader is NOT remounted on
      a same-route `loaderDeps` change (`mountCount === 1`, stable
      `data-instance`). The add skeleton is therefore safe — it appears on
      first entry only and folder switches keep the component (and `picked`)
      mounted. Add-skeleton approach confirmed; fallback overlay not needed.
- [x] **CHECKPOINT 2:** ✅ Global bar code shipped (Slice 1); state-preservation
      gate proven by automation. Live folder→folder + hydration smoke to be
      done on the PR deploy preview (SPEC requires preview smoke before merge —
      cannot exercise authenticated pCloud routes locally without Identity).

---

## Phase 3 — Slices 2–4: per-route entry skeletons

- [x] **T3.1 — Router pending config (Slice 2 base).** ✅ `src/router.tsx`:
      `defaultPendingMs: 200`, `defaultPendingMinMs: 300`,
      `defaultPendingComponent: RoutePendingFallback`.
- [x] **T3.2 — `AddSkeleton` + wire to add route (Slice 2).** ✅ Decision #1
      PASSed → skeleton approach. `AddSkeleton` (back-link + heading + date
      filter + `MediaGridSkeleton`) wired as `pendingComponent` on
      `/admin/collection/add`. Renders inside the already-present layout Outlet.
      Folder-switch `picked` preservation guaranteed by the T2.3 gate.
- [x] **T3.3 — `CollectionListSkeleton` + wire (Slice 3).** ✅ Full-page skeleton
      (header strip + heading + alert + `MediaGridSkeleton`) wired as
      `pendingComponent` on the `/admin/collection` **layout** route (its
      `getCollectionMedia` loader is what's slow; the `/index` child has no
      loader of its own).
- [x] **T3.4 — `HomeSkeleton` + wire (Slice 4).** ✅ Full-page skeleton (header
      strip + hero block + polaroid grid) wired as `pendingComponent` on `/`.
- [x] **CHECKPOINT 3 (ship gate):** ✅ `pnpm type-check` green; `pnpm test`
      green (unit 243, browser 61); `pnpm build` exit 0 (dist + Netlify cache
      deleted). Per-file `oxfmt --check` + `oxlint` clean (whole-repo
      `pnpm lint` OOMs pre-existing). **Remaining for the PR deploy preview:**
      live first-entry skeleton smoke on all three routes, global-bar visual,
      auth redirects, and `picked` survival on folder switch — none exercisable
      locally without Netlify Identity + pCloud.

---

## Notes / findings

- **Router state:** `useRouterState({ select: (s) => s.status === 'pending' })`.
  `defaultPendingMs` default 1000, `defaultPendingMinMs` default 500.
- **Chakra:** `Skeleton`/`SkeletonText`/`SkeletonCircle` from `@chakra-ui/react`;
  `SkeletonProps extends HTMLChakraProps<"div">`.
- **Decision #1:** PASS (automated). Source: `router-core` `load-matches.js:470`
  returns the prior successful match on background reload; integration test
  confirms no remount.
- **Env limit:** authenticated routes (`/`, `/admin/*`) need Netlify Identity +
  pCloud, so live visual smoke happens on the deploy preview, not locally.
- **Pre-existing:** full-repo `pnpm lint` OOMs in this env (oxlint over whole
  tree); per-file oxlint is clean. Not introduced by v16.
