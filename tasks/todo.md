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

- [ ] **T3.1 — Router pending config (Slice 2 base).** In `src/router.tsx` add
      `defaultPendingMs` (~150–200ms) and `defaultPendingMinMs` (~300–500ms),
      plus a minimal `defaultPendingComponent` (generic centered skeleton) as a
      global fallback.
      - *Verify:* `pnpm type-check` green; fast nav shows no skeleton flash.
- [ ] **T3.2 — `AddSkeleton` + wire to add route (Slice 2).** Build a skeleton
      shaped like `AdminFolderNavigator` (breadcrumb line + grid of skeleton
      tiles). Set it as `pendingComponent` on `/admin/collection/add`
      (createFileRoute), **only if T2.3 PASSed**; otherwise implement the inline
      file-grid dimming overlay instead.
      - *Acceptance:* first entry to add shows the skeleton, not a blank gap;
        folder switches still preserve `picked` (regression guard).
      - *Verify:* `AddSkeleton.browser.test.tsx` renders the expected tile
        count; manual first-entry + folder-switch smoke.
- [ ] **T3.3 — `CollectionListSkeleton` + wire (Slice 3).** Skeleton shaped like
      the curation list (heading + `CollectionItemsGrid` tiles). Set as
      `pendingComponent` on `/admin/collection` (and/or its `/index` route).
      - *Acceptance:* first entry to the curation list shows the skeleton.
      - *Verify:* browser test for tile count; manual smoke.
- [ ] **T3.4 — `HomeSkeleton` + wire (Slice 4).** Skeleton shaped like the home
      timeline (hero block + a year section of polaroid skeletons). Set as
      `pendingComponent` on `/`.
      - *Acceptance:* slow home load shows the skeleton, not a blank gap;
        empty-state and populated timeline still render after load.
      - *Verify:* browser test; manual smoke with date override.
- [ ] **CHECKPOINT 3 (ship gate):** `pnpm type-check`, `pnpm lint`,
      `pnpm test`, `pnpm build` all green; delete `dist` + Netlify cache after
      build. Manual: all three routes' first-entry skeletons + global bar; auth
      redirects (login / non-admin) still fire; no `picked` regression.

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
