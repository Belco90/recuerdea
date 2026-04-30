# Recuerdea v5 — Task list (analog-album UI port, Chakra-native)

See `tasks/plan.md` for full context. Branch: `v5-ui-design` (already checked out). PR target: `main`. Smoke local at `http://localhost:8888` (`pnpm dev:netlify`).

## Pre-flight

- [ ] Confirm assumptions in `tasks/plan.md` "Assumptions" with the human (especially the open question on lazy vs forced cache backfill in Slice 2).

## Slice 1 — Chakra theme + self-hosted fonts + AppShell

- [ ] Self-host fonts:
  - [ ] Fetch Google Fonts CSS for Fraunces / Inter / Caveat / JetBrains Mono with a Chrome User-Agent (variable woff2). Save URLs in `public/fonts/README.md`.
  - [ ] Download each woff2 into `public/fonts/`. Prefer variable-axis files where available.
  - [ ] `public/fonts/README.md` records source URLs + OFL attribution per family.
- [ ] NEW `src/theme.ts`:
  - [ ] Import `createSystem`, `defaultConfig`, `defineConfig` from `@chakra-ui/react`.
  - [ ] `tokens.colors.accent.{50…950}` — values from plan §5.
  - [ ] `tokens.fonts.{body, heading, mono, handwriting}` — Inter / Fraunces / JetBrains Mono / Caveat with system fallbacks.
  - [ ] `tokens.shadows.{polaroid, polaroidLift}` — values from `styles-v5.css:13–14`.
  - [ ] `semanticTokens.colors.{bg, bg.muted, paper, ink, ink.muted, line}` with `_light` / `_dark` variants from `styles-v5.css` `:root` + `[data-theme="dark"]`.
  - [ ] `keyframes.{shimmer, pulse, fade, zoom}` with the prototype's steps + durations.
  - [ ] `breakpoints.md = "720px"`.
  - [ ] `globalCss`:
    - [ ] `* { box-sizing: border-box }`.
    - [ ] `body` paper-noise `bgImage` (the SVG data URI, with `_light` / `_dark` color variants via accent token references).
    - [ ] `@font-face` blocks for the four families, `font-display: swap`, pointing at `/fonts/<file>.woff2`.
  - [ ] Export `system = createSystem(defaultConfig, config)`.
- [ ] MODIFY `src/routes/__root.tsx`:
  - [ ] `<html lang>` → `"es"`.
  - [ ] Replace `defaultSystem` import with `system` from `#/theme`.
  - [ ] Add font preload links in `head.links` (Fraunces + Inter primary; Caveat + JBM via on-demand swap).
- [ ] DELETE `src/styles.css` (everything moves into `globalCss`).
- [ ] NEW `src/components/AppShell.tsx`: `<Box minH="100vh" color="ink">{children}</Box>`.
- [ ] MODIFY `src/routes/index.tsx`: wrap component body in `<AppShell>`.
- [ ] MODIFY `src/routes/login.tsx`: wrap component body in `<AppShell>`.
- [ ] Smoke `pnpm dev:netlify` at `http://localhost:8888`: paper bg, fonts loading, no console errors. OS dark-mode toggle flips theme.
- [ ] All gates green (`test`, `type-check`, `lint`, `format:check`, `build`).
- [ ] Commit: `v5(slice1): chakra theme + self-hosted fonts + AppShell`.

## Slice 2 — Aspect-ratio metadata in `CachedMedia` + cron extractors

- [ ] MODIFY `src/lib/media-cache.ts`: add `width: number | null`, `height: number | null` to `CachedMedia`.
- [ ] UPDATE `src/lib/media-cache.test.ts`: round-trip the new fields including `null`.
- [ ] MODIFY `src/lib/exif.ts`:
  - [ ] Refactor `extractCaptureDate` → `extractImageMeta(downloadUrl): Promise<{ captureDate: Date | null; width: number | null; height: number | null }>` (single fetch, single `exifr.parse` call requesting date + dimension tags).
  - [ ] Dimension fallback chain: `ExifImageWidth` / `ExifImageHeight` → `PixelXDimension` / `PixelYDimension` → `ImageWidth` / `ImageHeight` → `null`.
- [ ] UPDATE `src/lib/exif.test.ts`: extend with dimension cases (with-EXIF, without-EXIF).
- [ ] MODIFY `src/lib/video-meta.ts`:
  - [ ] Refactor `extractVideoCaptureDate` → `extractVideoMeta(downloadUrl): Promise<{ captureDate: Date | null; width: number | null; height: number | null }>`.
  - [ ] Walk `moov` → `trak` → `tkhd` and read the trailing 16.16 fixed-point width/height (last 8 bytes of `tkhd`). Returns `null` when not found.
  - [ ] Multi-track videos: pick the first video track (heuristic: `tkhd` flags & 0x000007 enabled, and dimensions > 0). If no track passes, `null`.
- [ ] UPDATE `src/lib/video-meta.test.ts`: add a fixture-based case asserting non-null `{ width, height }` for a known fixture.
- [ ] MODIFY `src/lib/refresh-memories.server.ts`:
  - [ ] Replace `extractCaptureDateForFile` with `extractFileMeta(client, file)` that calls the new image/video helpers based on `contenttype`.
  - [ ] `fileToCachedMedia` accepts `{ captureDate, width, height }` and writes them.
- [ ] UPDATE `src/lib/refresh-memories.server.test.ts`: assert `width`/`height` end up in the cached entry for new files; existing-hash files still skip the rewrite.
- [ ] MODIFY `src/lib/pcloud.server.ts`: extend `MemoryItem` (image + video variants) with `width: number | null`, `height: number | null`. `buildMemoryItem` passes them through.
- [ ] UPDATE `src/lib/pcloud.server.test.ts` for the new shape.
- [ ] TOUCH `src/components/MemoryView.tsx`: take the wider type cleanly (no logic change — soon-to-be deleted in Slice 6).
- [ ] All gates green.
- [ ] Manual smoke: trigger the cron locally (or via `pnpm invoke:refresh-memories`) and inspect a fresh `media/<uuid>` Blobs entry — confirm `width` and `height` are integers.
- [ ] Commit: `v5(slice2): width/height metadata extraction + cache schema bump`.

## Slice 3 — Wordmark + Topbar (Chakra-native)

- [ ] NEW `src/components/Wordmark.tsx`:
  - [ ] Props: `size?: 'sm' | 'md' | 'lg'` (default `'md'`); maps to `fontSize` `20px` / `22px` / `28px`.
  - [ ] Renders a Chakra `<Text>` (italic, `fontFamily="heading"`, `letterSpacing="-0.025em"`, `color="ink"`) wrapping a leading rotated R `<Box as="span">` in `accent.500` and a trailing accent dot `<Box as="span">`.
  - [ ] No CSS classes.
- [ ] NEW `src/components/Topbar.tsx`:
  - [ ] Sticky `<Box as="header" position="sticky" top={0} zIndex="docked" bg="bg/80" backdropFilter="blur(14px) saturate(160%)" borderBottomWidth="1px" borderColor="line">`.
  - [ ] Inner `<Container maxW="1080px"><HStack justify="space-between" align="center" gap={3} py={2.5} px={{ base: 4, md: 4.5 }}>…</HStack></Container>`.
  - [ ] Left: `<Box as="a" href="/" color="ink" textDecor="none"><Wordmark /></Box>`.
  - [ ] Right: `<HStack gap={2.5}>` with the user pill + logout button.
  - [ ] User pill: `<HStack borderWidth="1px" borderColor="line" borderRadius="full" pl="3px" pr={{ base: '3px', sm: 3 }} py="3px" gap={2}><Avatar.Root size="xs"><Avatar.Fallback name={user.email} /></Avatar.Root><Text display={{ base: 'none', sm: 'inline' }} fontSize="sm" fontWeight={500}>{user.email}</Text></HStack>`.
  - [ ] Logout: `<Button variant="ghost" size="sm" borderRadius="full" borderWidth="1px" borderColor="line" onClick={() => void logout()} aria-label="Cerrar sesión">` with `LogOut` lucide icon + text label (text hidden on `<sm`).
  - [ ] Source the user via `useIdentity()` plus `Route.useRouteContext().user` fallback.
- [ ] MODIFY `src/routes/index.tsx`: render `<Topbar />` at the top of the home component (above any existing content). Old "Welcome back" Chakra heading and "Sign out" button stay temporarily (replaced in Slice 5).
- [ ] Smoke at port 8888: avatar pill compresses on narrow viewports; logout works; no CSS classes used.
- [ ] All gates green.
- [ ] Commit: `v5(slice3): wordmark + topbar`.

## Slice 4 — Login redesign (Chakra-native)

- [ ] REPLACE the body of `LoginPage` in `src/routes/login.tsx`:
  - [ ] Outer `<AppShell>` wraps `<VStack minH="100vh" justify="center" align="center" gap={7} px={6} py={10} position="relative" overflow="hidden">`.
  - [ ] Decorative polaroids container `<Box position="absolute" inset={0} pointerEvents="none" display="flex" justifyContent="center" alignItems="center">` with three rotated `<Box>` children sized 140×165, `bg="paper"`, `boxShadow="polaroidLift"`, opacity 0.6, with `_before` for the diagonal stripes (`bgImage="repeating-linear-gradient(38deg, var(--colors-bg-muted) 0 8px, var(--colors-accent-100) 8px 16px)"`). Third polaroid hidden on `<sm`.
  - [ ] Card: `<Box maxW="400px" w="full" bg="paper" borderWidth="1px" borderColor="line" borderRadius="4px" p={{ base: 8, md: 9 }} boxShadow="polaroidLift" position="relative" zIndex={1}>`.
  - [ ] Card content:
    - [ ] `<Wordmark size="lg" />`.
    - [ ] `<Heading fontFamily="heading" fontWeight={400} fontStyle="italic" fontSize="30px" lineHeight="1.1" letterSpacing="-0.02em" color="ink" mt={6}>Hoy te espera<br/>algo del pasado.</Heading>`.
    - [ ] `<Text mt={2.5} mb={5.5} color="ink.muted" fontSize="14px" lineHeight="1.55">Entra para ver lo que pasó un {today.day} de {today.month} en años anteriores.</Text>` — compute `today` (Spanish month) inline.
    - [ ] `<form onSubmit={handleSubmit}><VStack gap={3.5} align="stretch">…</VStack></form>` with two `<Field.Root>` blocks styled per the prototype (mono uppercase labels in `ink.muted`, 11px, `letterSpacing="0.1em"`).
    - [ ] Email field hidden in invite/recovery modes.
    - [ ] Password field label flips between `Contraseña` (login) and `Elige una contraseña` (invite/recovery).
    - [ ] Error: `<Text color="red.600" _dark={{ color: 'orange.300' }} fontSize="13px">{error}</Text>` (replaces `.rd-err`).
    - [ ] Submit: `<Button type="submit" loading={loading} h="44px" borderRadius="4px" bg="ink" color="paper" _hover={{ bg: 'ink/90' }} _active={{ transform: 'scale(0.99)' }}>Entrar</Button>` (mode-specific text: `Aceptar invitación` / `Establecer contraseña`).
    - [ ] Forgot link: `<Box as="a" href="#" textAlign="center" mt={1} color="ink.muted" fontSize="13px" _hover={{ color: 'accent.500' }}>¿Olvidaste tu contraseña?</Box>` (placeholder href; existing app has no recovery init).
  - [ ] Tagline (outside card): `<Text fontFamily="heading" fontStyle="italic" fontSize="14px" color="ink.muted" textAlign="center">Un pequeño ritual diario para tu familia.</Text>`.
  - [ ] Mode-specific titles: `Aceptar invitación` (invite) / `Establecer contraseña` (recovery) / `Entrar` (login).
- [ ] Manual smoke: log in successfully → redirect to `/`. Trigger an invite hash in the URL → mode flips to invite. Trigger recovery hash → mode flips to recovery.
- [ ] All gates green.
- [ ] Commit: `v5(slice4): analog-album login redesign`.

## Slice 5 — Year-grouping helper + Hero + EmptyState

- [ ] NEW `src/lib/spanish-months.ts`: `export const SPANISH_MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'] as const`.
- [ ] NEW `src/lib/memory-grouping.ts`:
  - [ ] `export type YearGroup = { readonly year: number; readonly yearsAgo: number; readonly items: readonly MemoryItem[] }`.
  - [ ] `export function groupMemoriesByYear(items: readonly MemoryItem[], today: { year: number; month: number; day: number }): readonly YearGroup[]`.
  - [ ] Pure: build a `Map<year, MemoryItem[]>`, then map to the output shape preserving input order. `yearsAgo = today.year - year`.
- [ ] NEW `src/lib/memory-grouping.test.ts`: empty input, single item with `yearsAgo === 1`, multi-year (mixed) preserving order, items with bad `captureDate` → filtered or thrown? — pick filter; document the choice.
- [ ] NEW `src/components/Hero.tsx`:
  - [ ] Props: `today: { day: number; month: string; year: number }`, `totalItems: number`, `groupCount: number`.
  - [ ] Renders the big day + italic-accent month + meta line per the prototype using Chakra primitives. Count text: `{N} recuerdos · {M} año/años` if `totalItems > 0`; `Hoy en tus recuerdos` if 0.
- [ ] NEW `src/components/EmptyState.tsx`:
  - [ ] Props: `today: { day: number; month: string }`.
  - [ ] Three decorative striped polaroids in a `<Box position="relative" h="130px" w="220px">`, each `<Box position="absolute" …>` with rotation + `_before` stripes.
  - [ ] Heading + paragraph copy verbatim from `app.jsx`.
- [ ] MODIFY `src/routes/index.tsx`:
  - [ ] Compute `today` from the `activeDate` search param (parse YYYY-MM-DD) or `new Date()`. Convert to `{ day, month: SPANISH_MONTHS[m-1], year }`.
  - [ ] Compute `groups = groupMemoriesByYear(memories, { year, month: monthIndex, day })`. Note: `month` for grouping is the numeric month, but Hero's prop is the Spanish string — keep two locals (`monthIndex` for logic, `monthLabel` for UI).
  - [ ] Layout: `<AppShell><Topbar /><AdminDateOverride … /><Box as="main" maxW="1080px" mx="auto" pt={8} pb={20} px={{ base: 4, md: 4.5 }}><Hero today={…} totalItems={…} groupCount={…} />{groups.length === 0 ? <EmptyState today={…} /> : /* placeholder list — Slice 6 replaces */ }</Box></AppShell>`.
  - [ ] DROP the old "Welcome back" heading and inline "Sign out" button.
- [ ] Smoke: empty day → `<EmptyState>`; rich day → placeholder rows with the new hero up top.
- [ ] All gates green.
- [ ] Commit: `v5(slice5): hero + empty state + year grouping`.

## Slice 6 — Polaroid + YearSection + masonry + timeline (Chakra-native)

- [ ] NEW `src/lib/rotation.ts`: pure `rotForKey(key: string): number` returning a deterministic angle in `[-2.4, 2.4]`. Reuse the prototype's hash exactly.
- [ ] NEW `src/lib/rotation.test.ts`: deterministic for the same key, distribution sample stays within range.
- [ ] NEW `src/components/Polaroid.tsx`:
  - [ ] Props: `item: MemoryItem`, `keyId: string`, `onClick: () => void`.
  - [ ] Outer `<Box as="button" w="full" p={0} bg="transparent" border={0} display="block" mb={4} sx={{ breakInside: 'avoid' }} transform={\`rotate(${rotForKey(keyId)}deg)\`} \_hover={{ transform: 'rotate(0deg) translateY(-3px)' }} \_active={{ transform: 'rotate(0deg) translateY(-1px) scale(0.99)' }} transition="transform 0.25s cubic-bezier(.2,.7,.3,1)" onClick={onClick} aria-label={caption || 'Recuerdo'}>`.
  - [ ] Inner frame `<Box bg="paper" pl={2} pr={2} pt={2} pb={7} borderRadius="2px" boxShadow="polaroid" position="relative" _hover={{ boxShadow: 'polaroidLift' }}>`.
  - [ ] Photo box `<Box position="relative" bg="bg.muted" overflow="hidden" w="full" aspectRatio={item.width && item.height ? item.width / item.height : undefined}>` containing `<Image src="/api/memory/${item.uuid}?variant=image" alt="" loading="lazy" w="full" h="full" objectFit="cover" filter="saturate(0.92) contrast(1.02)" />` (image kind), or for video kind `<Image src="/api/memory/${item.uuid}?variant=poster" />` plus a play badge overlay.
  - [ ] Play badge: `<HStack position="absolute" bottom="7px" left="7px" bg="blackAlpha.600" color="white" px={2} py={0.5} borderRadius="full" fontSize="10.5px" fontFamily="mono" gap={1.25}><Play size={10} fill="currentColor" /></HStack>`.
  - [ ] Caption (if non-empty after stripping extension + replacing `_-` with spaces): `<Text mt={2} fontFamily="handwriting" fontSize="17px" fontWeight={500} textAlign="center" color="ink" lineHeight="1.1" px={1}>{caption}</Text>`.
- [ ] NEW `src/components/YearSection.tsx`:
  - [ ] Props: `group: YearGroup`, `onOpen: (year: number, idx: number) => void`.
  - [ ] Outer `<Box as="section" position="relative" pl={{ base: 12, md: '130px' }} mb={14}>`.
  - [ ] Year marker block (absolute, with the dot + year-num for `md+`).
  - [ ] Title: `<Heading as="h2" fontFamily="heading" fontStyle="italic" fontWeight={400} fontSize={{ base: 'clamp(22px, 4.6vw, 32px)' }} letterSpacing="-0.015em" color="ink" m={0}>{yearsAgoLabel(group.yearsAgo)}<Text as="span" display={{ base: 'inline', md: 'none' }}> · {group.year}</Text></Heading>`.
  - [ ] Helper `yearsAgoLabel(n)`: `'Hace un año'` if `n === 1`; `\`Hace ${n} años\`` otherwise.
  - [ ] Meta: `<Text fontFamily="mono" fontSize="11px" letterSpacing="0.08em" textTransform="uppercase" color="ink.muted" mt={1} mb={4.5}>{n} {n === 1 ? 'recuerdo' : 'recuerdos'}</Text>`.
  - [ ] Masonry: `<Box columnCount={{ base: 2, md: 3, lg: 4 }} columnGap={{ base: 3.5, md: 4.5 }}>` with `<Polaroid>` per item, `keyId={\`${group.year}-${idx}\`}`.
- [ ] NEW (or inline) `src/components/Timeline.tsx`: a wrapper `<Box position="relative" pl={0}>` with the timeline line + end dot + footer.
- [ ] MODIFY `src/routes/index.tsx`: replace placeholder list with `<Timeline>` + year sections; thread `onOpen={(year, idx) => setLightbox({ yearIndex, idx })}` (state stub for Slice 7).
- [ ] DELETE `src/components/MemoryView.tsx`. Verify `rg -n MemoryView src/` returns 0 matches.
- [ ] Smoke: home renders with full polaroid masonry; rotation stable on re-render; layout looks correct on iPhone-width (`base`), tablet (`md`), desktop (`lg`).
- [ ] All gates green.
- [ ] Commit: `v5(slice6): polaroid masonry + timeline ornament`.

## Slice 7 — Lightbox using Chakra `Dialog`

- [ ] NEW `src/components/Lightbox.tsx`:
  - [ ] Props: `group: YearGroup`, `startIndex: number`, `open: boolean`, `onClose: () => void`.
  - [ ] Internal `idx` state (initialised from `startIndex`); reset when `startIndex` changes.
  - [ ] `<Dialog.Root open={open} onOpenChange={({ open }) => !open && onClose()} size="full" placement="center">`.
  - [ ] `<Dialog.Backdrop bg="rgba(12,9,6,0.94)" backdropFilter="blur(16px)" />`.
  - [ ] `<Dialog.Content bg="transparent" boxShadow="none" display="flex" flexDir="column">`.
  - [ ] Top bar (HStack with year + counter + download icon + close trigger).
  - [ ] Stage (Box flex=1, image or `<chakra.video controls autoPlay>`, prev/next IconButtons hidden on `<md`).
  - [ ] Caption (handwriting font + dots indicator using `accent.500` for active dot).
  - [ ] Keyboard: `useEffect` adding ArrowLeft / ArrowRight; clamp to range.
  - [ ] Touch: 50px-threshold swipe.
  - [ ] `<video key={item.uuid}>` so unmount-on-navigate stops playback cleanly.
- [ ] MODIFY `src/routes/index.tsx`:
  - [ ] State: `const [lightbox, setLightbox] = useState<{ yearIndex: number; idx: number } | null>(null)`.
  - [ ] Pass `onOpen={(year, idx) => setLightbox({ yearIndex: groups.findIndex(g => g.year === year), idx })}` to year sections.
  - [ ] Render `<Lightbox open={lightbox !== null} group={lightbox && groups[lightbox.yearIndex]} startIndex={lightbox?.idx ?? 0} onClose={() => setLightbox(null)} />`.
- [ ] Smoke: open lightbox on a year with 3+ items, navigate via arrow keys + swipe + dots + prev/next; close via Esc + scrim click + close button. Video autoplays on entry, stops on next/prev. Download link opens in a new tab.
- [ ] All gates green.
- [ ] Commit: `v5(slice7): per-year swipe lightbox via chakra dialog`.

## Slice 8 — Admin date-override banner restyle

- [ ] REPLACE `src/components/AdminDateOverride.tsx`:
  - [ ] Outer `<Box position="relative" bgImage="repeating-linear-gradient(-45deg, ...)" borderBottomWidth="1px" borderBottomStyle="dashed" borderBottomColor="accent.300">` with the striped diagonal background (use accent-token color stops; verify Chakra surfaces tokens as CSS vars usable in `color-mix` — if not, hand-mix the three stops).
  - [ ] Tape: `<Box position="absolute" left="50%" top="-7px" w="110px" h="16px" transform="translateX(-50%) rotate(-1deg)" bg="accent.100" opacity={0.85} boxShadow="sm" borderLeft="1px dashed" borderRight="1px dashed" borderColor="blackAlpha.100" />`.
  - [ ] Inner `<HStack maxW="1080px" mx="auto" px={4.5} py={3.5} justify="space-between" gap={4.5} flexWrap="wrap">`.
  - [ ] Label region: badge (HStack with `Star` lucide + `Solo admin`), title (`Sobreescribir fecha de hoy`, italic Fraunces), help (italic, hidden on `<md`).
  - [ ] Controls region: Chakra `<DatePicker>` (existing component, restyled with `_input` slot props or `Input` `asChild` overrides to be compact + mono). `Restablecer` ghost button when overridden. State pill HStack with the dot animated via `pulse` keyframe when overridden.
  - [ ] Wire the date `onValueChange` to `navigate({ search: { date } })` (existing pattern); reset to `navigate({ search: {} })`.
  - [ ] Use `SPANISH_MONTHS` from Slice 5 for the state pill label.
- [ ] Smoke: as admin, change date → URL param updates, loader re-runs. "Restablecer" returns to today. Pulse anim plays only when overridden. Banner not rendered when `isAdmin === false`.
- [ ] All gates green.
- [ ] Commit: `v5(slice8): admin date-override banner restyle`.

## Slice 9 — Spanish copy sweep, cleanup, deploy preview

- [ ] `rg -n '\b(Welcome|Sign|Choose|Memories?|Today|Yesterday|Reset|Email|Password|Loading)\b' src/` — confirm only allowed hits remain (manually inspect).
- [ ] `rg -n MemoryView src/` returns 0 matches.
- [ ] `pnpm test` green; `pnpm type-check` clean; `pnpm lint` clean; `pnpm format:check` clean; `pnpm build` clean. After build, `rm -rf dist .netlify` (per SPEC §7).
- [ ] Manual visual smoke against each prototype state at `localhost:8888`:
  - Logged-out, logged-in non-admin, logged-in admin, override-set rich day, override-set empty day, lightbox on a multi-item year, OS dark-mode toggle.
- [ ] Push the v5-ui-design branch.
- [ ] Open PR `[v5] Analog-album UI port` → `main`.
- [ ] Deploy preview smoke:
  - [ ] Each prototype state matches the design.
  - [ ] Network tab: media still flows through `/api/memory/<uuid>` only.
  - [ ] `curl -I https://<deploy-preview>/` → `cache-control: private` (or `no-store` / absent).
  - [ ] No console errors / 401s.
- [ ] (Optional) Trigger the cron once on the deploy preview so existing entries refresh and pick up `width`/`height` proactively.
- [ ] Pre-merge: human review on the deploy preview.
- [ ] Merge `v5-ui-design → main`. Post-merge prod smoke (same checks on prod URL).

## Deferred / out of scope

- [ ] User-facing theme toggle (system preference only in v5).
- [ ] User-facing accent color picker.
- [ ] Pending-component for date-picker transitions (only if jank is observable).
- [ ] Captions richer than filename-derived.
- [ ] Real avatar image wiring (currently `Avatar.Fallback` only).
- [ ] Forced cache backfill for legacy entries lacking `width`/`height` — only if lazy refresh feels too slow.
