# Recuerdea v5 — Task list (analog-album UI port, Chakra-native)

See `tasks/plan.md` for full context. Branch: `v5-ui-design` (already checked out). PR target: `main`. Smoke local at `http://localhost:8888` (`pnpm dev:netlify`).

## Pre-flight

- [x] Confirm assumptions in `tasks/plan.md` "Assumptions" with the human (especially the open question on lazy vs forced cache backfill in Slice 2).

## Slice 1 — Chakra theme + self-hosted fonts + AppShell — `5ff622d`

- [x] Self-host fonts:
  - [x] Fetch Google Fonts CSS for Fraunces / Inter / Caveat / JetBrains Mono with a Chrome User-Agent (variable woff2). Save URLs in `public/fonts/README.md`.
  - [x] Download each woff2 into `public/fonts/`. Prefer variable-axis files where available.
  - [x] `public/fonts/README.md` records source URLs + OFL attribution per family.
- [x] NEW `src/theme.ts`:
  - [x] Import `createSystem`, `defaultConfig`, `defineConfig` from `@chakra-ui/react`.
  - [x] `tokens.colors.accent.{50…950}` — values from plan §5.
  - [x] `tokens.fonts.{body, heading, mono, handwriting}` — Inter / Fraunces / JetBrains Mono / Caveat with system fallbacks.
  - [x] `tokens.shadows.{polaroid, polaroidLift}` — values from `styles-v5.css:13–14`.
  - [x] `semanticTokens.colors.{bg, bg.muted, paper, ink, ink.muted, line}` with `_light` / `_dark` variants from `styles-v5.css` `:root` + `[data-theme="dark"]`.
  - [x] `keyframes.{shimmer, pulse, fade, zoom}` with the prototype's steps + durations.
  - [x] `breakpoints.md = "720px"`.
  - [x] `globalCss`:
    - [x] `* { box-sizing: border-box }`.
    - [x] `body` paper-noise `bgImage` (the SVG data URI, with `_light` / `_dark` color variants via accent token references).
    - [x] `@font-face` blocks for the four families, `font-display: swap`, pointing at `/fonts/<file>.woff2`. (Moved to `src/fonts.css` because Chakra v3's `globalCss` typing rejects `@font-face` arrays — same effect via head stylesheet link.)
  - [x] Export `system = createSystem(defaultConfig, config)`.
- [x] MODIFY `src/routes/__root.tsx`:
  - [x] `<html lang>` → `"es"`.
  - [x] Replace `defaultSystem` import with `system` from `#/theme`.
  - [x] Add font preload links in `head.links` (Fraunces + Inter primary; Caveat + JBM via on-demand swap).
- [x] DELETE `src/styles.css` (everything moves into `globalCss`).
- [x] NEW `src/components/AppShell.tsx`: `<Box minH="100vh" color="ink">{children}</Box>`.
- [x] MODIFY `src/routes/index.tsx`: wrap component body in `<AppShell>`.
- [x] MODIFY `src/routes/login.tsx`: wrap component body in `<AppShell>`.
- [ ] Smoke `pnpm dev:netlify` at `http://localhost:8888`: paper bg, fonts loading, no console errors. OS dark-mode toggle flips theme. _(awaiting your manual smoke)_
- [x] All gates green (`test`, `type-check`, `lint`, `format:check`, `build`).
- [x] Commit: `v5(slice1): chakra theme + self-hosted fonts + AppShell`.

## Slice 2 — Aspect-ratio metadata in `CachedMedia` + cron extractors — `1299246`

- [x] MODIFY `src/lib/media-cache.ts`: add `width: number | null`, `height: number | null` to `CachedMedia`.
- [x] UPDATE `src/lib/media-cache.test.ts`: round-trip the new fields including `null`.
- [x] MODIFY `src/lib/exif.ts`:
  - [x] Refactor `extractCaptureDate` → `extractImageMeta(downloadUrl): Promise<{ captureDate: Date | null; width: number | null; height: number | null }>` (single fetch, single `exifr.parse` call requesting date + dimension tags).
  - [x] Dimension fallback chain: `ExifImageWidth` / `ExifImageHeight` → `PixelXDimension` / `PixelYDimension` → `ImageWidth` / `ImageHeight` → `null`.
- [x] UPDATE `src/lib/exif.test.ts`: extend with dimension cases (with-EXIF, without-EXIF).
- [x] MODIFY `src/lib/video-meta.ts`:
  - [x] Refactor `extractVideoCaptureDate` → `extractVideoMeta(downloadUrl): Promise<{ captureDate: Date | null; width: number | null; height: number | null }>`.
  - [x] Walk `moov` → `trak` → `tkhd` and read the trailing 16.16 fixed-point width/height (last 8 bytes of `tkhd`). Returns `null` when not found.
  - [x] Multi-track videos: pick the first `trak` whose `tkhd` reports non-zero dimensions (audio tracks have zero dims and are skipped).
- [x] UPDATE `src/lib/video-meta.test.ts`: add a fixture-based case asserting non-null `{ width, height }` for a known fixture.
- [x] MODIFY `src/lib/refresh-memories.server.ts`:
  - [x] Replace `extractCaptureDateForFile` with `extractFileMeta(client, file)` that calls the new image/video helpers based on `contenttype`.
  - [x] `fileToCachedMedia` accepts `{ captureDate, width, height }` and writes them.
- [x] UPDATE `src/lib/refresh-memories.server.test.ts`: assert `width`/`height` end up in the cached entry for new files; existing-hash files still skip the rewrite.
- [x] MODIFY `src/lib/pcloud.server.ts`: extend `MemoryItem` (image + video variants) with `width: number | null`, `height: number | null`. `buildMemoryItem` passes them through.
- [x] UPDATE `src/lib/pcloud.server.test.ts` for the new shape.
- [x] TOUCH `src/components/MemoryView.tsx`: takes the wider type cleanly (was deleted in Slice 6 — no logic change needed).
- [x] All gates green.
- [ ] Manual smoke: trigger the cron locally (or via `pnpm invoke:refresh-memories`) and inspect a fresh `media/<uuid>` Blobs entry — confirm `width` and `height` are integers. _(you said you'll wipe the cache manually to force regen — verifies as part of your smoke)_
- [x] Commit: `v5(slice2): width/height metadata extraction + cache schema bump`.

## Slice 3 — Wordmark + Topbar (Chakra-native) — `b9e0052`

- [x] NEW `src/components/Wordmark.tsx`:
  - [x] Props: `size?: 'sm' | 'md' | 'lg'` (default `'md'`); maps to `fontSize` `20px` / `22px` / `28px`.
  - [x] Renders a Chakra `<Box as="span">` (italic, `fontFamily="heading"`, `letterSpacing="-0.025em"`, `color="ink"`) wrapping a leading rotated R `<Box as="span">` in `accent.500` and a trailing accent dot `<Box as="span">`.
  - [x] No CSS classes.
- [x] NEW `src/components/Topbar.tsx`:
  - [x] Sticky `<Box as="header" position="sticky" top={0} zIndex="docked" bg="bg/80" backdropFilter="blur(14px) saturate(160%)" borderBottomWidth="1px" borderColor="line">`.
  - [x] Inner `<Container maxW="1080px"><HStack justify="space-between" align="center" gap={3} py={2.5} px={{ base: 4, md: 4.5 }}>…</HStack></Container>`.
  - [x] Left: TanStack Router `<Link to="/" style={{ color: 'inherit', textDecoration: 'none' }}><Wordmark /></Link>` (Chakra `<Box as="a">` typing rejected `href`; Link is the natural SPA-aware swap).
  - [x] Right: `<HStack gap={2.5}>` with the user pill + logout button.
  - [x] User pill: `<HStack borderWidth="1px" borderColor="line" borderRadius="full" pl="3px" pr={{ base: '3px', sm: 3 }} py="3px" gap={2}><Avatar.Root size="xs"><Avatar.Fallback name={user.email} /></Avatar.Root><Text display={{ base: 'none', sm: 'inline' }} fontSize="sm" fontWeight={500}>{user.email}</Text></HStack>`.
  - [x] Logout: outline `Button` with `LogOut` lucide icon + text label (text hidden on `<sm`).
  - [x] Source the user via `useIdentity()` plus `Route.useRouteContext().user` fallback.
- [x] MODIFY `src/routes/index.tsx`: render `<Topbar />` at the top of the home component (above any existing content). Old "Welcome back" Chakra heading and "Sign out" button stay temporarily (replaced in Slice 5).
- [ ] Smoke at port 8888: avatar pill compresses on narrow viewports; logout works; no CSS classes used. _(awaiting your manual smoke)_
- [x] All gates green.
- [x] Commit: `v5(slice3): wordmark + topbar`.

## Slice 4 — Login redesign (Chakra-native) — `6389ba3`

- [x] REPLACE the body of `LoginPage` in `src/routes/login.tsx`:
  - [x] Outer `<AppShell>` wraps `<VStack minH="100vh" justify="center" align="center" gap={7} px={6} py={10} position="relative" overflow="hidden">`.
  - [x] Decorative polaroids container `<Box position="absolute" inset={0} pointerEvents="none" display="flex" justifyContent="center" alignItems="center">` with three rotated `<Box>` children sized 140×165, `bg="paper"`, `boxShadow="rdShadowLift"`, opacity 0.6, with `_before` for the diagonal stripes. Third polaroid hidden on `<sm`.
  - [x] Card: `<Box maxW="400px" w="full" bg="paper" borderWidth="1px" borderColor="line" borderRadius="4px" p={{ base: 8, md: 9 }} boxShadow="rdShadowLift" position="relative" zIndex={1}>`.
  - [x] Card content:
    - [x] `<Wordmark size="lg" />`.
    - [x] `<Heading whiteSpace="pre-line">Hoy te espera\nalgo del pasado.</Heading>` styled per the prototype.
    - [x] `<Text>Entra para ver lo que pasó un {today.day} de {today.month} en años anteriores.</Text>` — computes `today` (Spanish month) inline.
    - [x] `<form onSubmit={handleSubmit}><Stack gap={3.5}>…</Stack></form>` with two `<Field.Root>` blocks styled per the prototype (mono uppercase labels in `ink.muted`).
    - [x] Email field hidden in invite/recovery modes.
    - [x] Password field label flips between `Contraseña` (login) and `Elige una contraseña` (invite/recovery).
    - [x] Error: `<Text color="red.600" _dark={{ color: 'orange.300' }} fontSize="13px">{error}</Text>`.
    - [x] Submit: `<Button bg="ink" color="paper" _hover={{ bg: 'accent.700' }}>Entrar</Button>` (mode-specific text via `TITLES` map).
    - [x] Forgot link: `<Link href="#" textAlign="center" color="ink.muted" fontSize="13px" _hover={{ color: 'accent.500' }}>¿Olvidaste tu contraseña?</Link>`.
  - [x] Tagline (outside card): `<Text fontFamily="heading" fontStyle="italic" fontSize="14px" color="ink.muted">Un pequeño ritual diario para tu familia.</Text>`.
  - [x] Mode-specific titles, headings, and sublines via `TITLES` / `HEADINGS` / `PASSWORD_LABELS` maps for `login` / `invite` / `recovery`.
- [ ] Manual smoke: log in successfully → redirect to `/`. Trigger an invite hash in the URL → mode flips to invite. Trigger recovery hash → mode flips to recovery. _(awaiting your manual smoke)_
- [x] All gates green.
- [x] Commit: `v5(slice4): analog-album login redesign`.

## Slice 5 — Year-grouping helper + Hero + EmptyState — `2980974`

- [x] NEW `src/lib/spanish-months.ts`: `SPANISH_MONTHS` const + `spanishMonth(idx)` helper.
- [x] NEW `src/lib/memory-grouping.ts`:
  - [x] `export type YearGroup = { readonly year: number; readonly yearsAgo: number; readonly items: readonly MemoryItem[] }`.
  - [x] `export function groupMemoriesByYear(items: readonly MemoryItem[], today: { year: number; month: number; day: number }): readonly YearGroup[]`.
  - [x] Pure: build a `Map<year, MemoryItem[]>`, then map to the output shape preserving input order. `yearsAgo = today.year - year`.
- [x] NEW `src/lib/memory-grouping.test.ts`: 7 cases — empty, single, multi-year ordering, same-year preservation, caller-order across years, bad captureDate skipped, current-year zero.
- [x] NEW `src/components/Hero.tsx`:
  - [x] Props: `today: { day: number; month: string; year: number }`, `totalItems: number`, `groupCount: number`.
  - [x] Renders the big day + italic-accent month + meta line per the prototype using Chakra primitives. Count text: `{N} recuerdos · {M} año/años` if `totalItems > 0`; `Hoy en tus recuerdos` if 0.
- [x] NEW `src/components/EmptyState.tsx`:
  - [x] Props: `today: { day: number; month: string }`.
  - [x] Three decorative striped polaroids in a `<Box position="relative" h="130px" w="220px">`, each `<Box position="absolute" …>` with rotation + `_before` stripes.
  - [x] Heading + paragraph copy verbatim from `app.jsx`.
- [x] MODIFY `src/routes/index.tsx`:
  - [x] Compute `today` from the `activeDate` search param (parse YYYY-MM-DD) or `new Date()`. Convert to `{ day, month, year }` plus a Spanish-month `todayDisplay` for the UI.
  - [x] Compute `groups = groupMemoriesByYear(memories, today)`.
  - [x] Layout: `<AppShell><Topbar /><AdminDateOverride … /><Container as="main" maxW="1080px" …><Hero … />{groups.length === 0 ? <EmptyState … /> : /* placeholder list — Slice 6 replaces */ }</Container></AppShell>`.
  - [x] DROP the old "Welcome back" heading and inline "Sign out" button.
- [ ] Smoke: empty day → `<EmptyState>`; rich day → placeholder rows with the new hero up top. _(awaiting your manual smoke)_
- [x] All gates green.
- [x] Commit: `v5(slice5): year grouping helper + Hero + EmptyState`.

## Slice 6 — Polaroid + YearSection + masonry + timeline (Chakra-native) — `34c39f4`

- [x] NEW `src/lib/rotation.ts`: pure `rotForKey(key: string): number` returning a deterministic angle in `[-2.4, 2.4]` (uses absolute value to keep range symmetric — prototype's raw hash skewed negative).
- [x] NEW `src/lib/rotation.test.ts`: determinism, range bounds (200 samples), distinctness across 50 keys, empty-string handling.
- [x] NEW `src/components/Polaroid.tsx`:
  - [x] Props: `item: MemoryItem`, `keyId: string`, `onClick: () => void`.
  - [x] Outer `<Box as="button">` with stable rotation transform, hover/active variants, `breakInside: avoid`.
  - [x] Inner frame `<Box bg="paper" pl={2} pr={2} pt={2} pb={7} borderRadius="2px" boxShadow="rdShadow">`.
  - [x] Photo box `<Box position="relative" bg="bg.muted" overflow="hidden" w="full" aspectRatio={…}>` with `<Image>` (cover, lazy, slight saturation/contrast filter). Video kind uses `?variant=poster` plus a play badge.
  - [x] Play badge with `Play` lucide icon + "VÍDEO" mono label.
  - [x] Caption derived from `item.name` (strip extension, replace `_-` with spaces). Renders only if non-empty.
- [x] NEW `src/components/YearSection.tsx`:
  - [x] Props: `group: YearGroup`, `onOpen: (year: number, idx: number) => void`.
  - [x] Outer `<Box as="section" position="relative" pl={{ base: 12, md: '130px' }} mb={14}>`.
  - [x] Year marker block (absolute) with the dot + year-num for `md+`.
  - [x] Title: italic Fraunces "Hace N año(s)" with mobile-only "· {year}" suffix.
  - [x] Helper `yearsAgoLabel(n)`: `'Hoy mismo'` for 0, `'Hace un año'` for 1, `\`Hace ${n} años\`` otherwise.
  - [x] Meta: `{N} recuerdo(s)` mono caps line.
  - [x] Masonry: `<Box columnCount={{ base: 2, md: 3, lg: 4 }} columnGap={{ base: 3.5, md: 4.5 }}>` with `<Polaroid>` per item, `keyId={\`${group.year}-${idx}\`}`.
- [x] NEW `src/components/Timeline.tsx`: wrapper `<Box position="relative">` with the timeline gradient line + bottom end dot + Spanish footer.
- [x] MODIFY `src/routes/index.tsx`: replace placeholder list with `<Timeline>{groups.map(YearSection)}</Timeline>`. `noopOpen` stub (Slice 7 wires the lightbox).
- [x] DELETE `src/components/MemoryView.tsx`. Verify `rg -n MemoryView src/` returns 0 matches.
- [ ] Smoke: home renders with full polaroid masonry; rotation stable on re-render; layout looks correct on iPhone-width (`base`), tablet (`md`), desktop (`lg`). _(awaiting your manual smoke)_
- [x] All gates green.
- [x] Commit: `v5(slice6): polaroid masonry + timeline ornament`.

## Slice 7 — Lightbox using Chakra `Dialog` — `6a18424`

- [x] NEW `src/components/Lightbox.tsx`:
  - [x] Props: `group: YearGroup`, `startIndex: number`, `open: boolean`, `onClose: () => void`.
  - [x] Internal `idx` state (initialised from `startIndex`); reset when `startIndex` changes.
  - [x] `<Dialog.Root open={open} onOpenChange={({ open }) => !open && onClose()} size="full">`.
  - [x] `<Dialog.Backdrop bg="rgba(12,9,6,0.94)" backdropFilter="blur(16px)" />`.
  - [x] `<Dialog.Content bg="transparent" boxShadow="none" display="flex" flexDirection="column">`.
  - [x] Top bar (HStack with year + lowercase "hace n años" + counter + download icon + close trigger).
  - [x] Stage (Box flex=1, image or native `<video controls autoPlay key={uuid}>`, prev/next IconButtons hidden on `<md`).
  - [x] Caption (handwriting font + dots indicator using `accent.500` for active dot).
  - [x] Keyboard: `useEffect` adding ArrowLeft / ArrowRight; clamp to range. Escape closed by Chakra `Dialog`.
  - [x] Touch: 50px-threshold swipe.
  - [x] `<video key={item.uuid}>` so unmount-on-navigate stops playback cleanly.
- [x] MODIFY `src/routes/index.tsx`:
  - [x] State: `const [lightbox, setLightbox] = useState<{ yearIndex: number; idx: number } | null>(null)`.
  - [x] Pass `onOpen={(year, idx) => …}` to year sections.
  - [x] Render `<Lightbox open={true} group={…} startIndex={…} onClose={() => setLightbox(null)} />` only when state is non-null.
- [ ] Smoke: open lightbox on a year with 3+ items, navigate via arrow keys + swipe + dots + prev/next; close via Esc + scrim click + close button. Video autoplays on entry, stops on next/prev. Download link opens in a new tab. _(awaiting your manual smoke)_
- [x] All gates green.
- [x] Commit: `v5(slice7): per-year swipe lightbox via chakra dialog`.

## Slice 8 — Admin date-override banner restyle — `9a13221`

- [x] REPLACE `src/components/AdminDateOverride.tsx`:
  - [x] Outer `<Box position="relative" bgImage="repeating-linear-gradient(-45deg, color-mix(in srgb, var(--chakra-colors-accent-500) 10%, var(--chakra-colors-bg)) 0 14px, color-mix(in srgb, var(--chakra-colors-accent-500) 4%, var(--chakra-colors-bg)) 14px 28px)" borderBottomWidth="1px" borderBottomStyle="dashed" borderBottomColor="accent.300">`.
  - [x] Tape: absolute `<Box>` with dashed left/right borders, `bg="accent.100"`, rotated `-1deg`.
  - [x] Inner `<HStack maxW="1080px" mx="auto" px={4.5} py={3.5} justify="space-between" gap={4.5} flexWrap="wrap">`.
  - [x] Label region: badge (HStack with `Star` lucide + "Solo admin"), title ("Sobreescribir fecha de hoy", italic Fraunces), help (italic, hidden on `<md`).
  - [x] Controls region: Chakra `<DatePicker>` (existing component, restyled with compact mono input + accent focus ring). `Restablecer` outline button when overridden. State pill HStack with the dot animated via `rdPulse` keyframe when overridden.
  - [x] Wire the date `onValueChange` to `navigate({ search: { date } })`; reset to `navigate({ search: {} })`.
  - [x] Use `spanishMonth` from `#/lib/spanish-months` for the state pill label.
- [ ] Smoke: as admin, change date → URL param updates, loader re-runs. "Restablecer" returns to today. Pulse anim plays only when overridden. Banner not rendered when `isAdmin === false`. _(awaiting your manual smoke)_
- [x] All gates green.
- [x] Commit: `v5(slice8): admin date-override banner restyle`.

## Slice 9 — Spanish copy sweep, cleanup, deploy preview — `3ce81b4`

- [x] `rg -n '\b(Welcome|Sign|Choose|Memories?|Today|Yesterday|Reset|Email|Password|Loading)\b' src/` — 0 hits in non-test source.
- [x] `rg -n MemoryView src/` returns 0 matches.
- [x] `pnpm test` green (121/121); `pnpm type-check` clean; `pnpm lint` clean; `pnpm format:check` clean; `pnpm build` clean. After build, `rm -rf dist .netlify` (per SPEC §7).
- [x] SPEC.md §4 refreshed to document the v5 component + lib layout.
- [ ] Manual visual smoke against each prototype state at `localhost:8888`:
  - Logged-out, logged-in non-admin, logged-in admin, override-set rich day, override-set empty day, lightbox on a multi-item year, OS dark-mode toggle. _(your turn — feel free to tweak components manually first)_
- [ ] Push the v5-ui-design branch. _(awaiting your "go")_
- [ ] Open PR `[v5] Analog-album UI port` → `main`. _(awaiting your "go")_
- [ ] Deploy preview smoke:
  - [ ] Each prototype state matches the design.
  - [ ] Network tab: media still flows through `/api/memory/<uuid>` only.
  - [ ] `curl -I https://<deploy-preview>/` → `cache-control: private` (or `no-store` / absent).
  - [ ] No console errors / 401s.
- [ ] (Optional) Trigger the cron once on the deploy preview (or wipe the Blobs cache) so existing entries refresh and pick up `width`/`height` proactively.
- [ ] Pre-merge: human review on the deploy preview.
- [ ] Merge `v5-ui-design → main`. Post-merge prod smoke (same checks on prod URL).

## Deferred / out of scope

- [ ] User-facing theme toggle (system preference only in v5).
- [ ] User-facing accent color picker.
- [ ] Pending-component for date-picker transitions (only if jank is observable).
- [ ] Captions richer than filename-derived.
- [ ] Real avatar image wiring (currently `Avatar.Fallback` only).
- [ ] Forced cache backfill for legacy entries lacking `width`/`height` — only if lazy refresh feels too slow.
