# Recuerdea v5 — Analog-album UI port (Chakra-native)

## Overview

Port the **analog-album / polaroid** visual design (Claude Design bundle, primary file `index.html`, rendered by `app.jsx` + `styles-v5.css`) onto the existing app. Branch: `v5-ui-design` (already checked out). PR target: `main`.

The implementation lives in **Chakra UI v3 first**: the design system identity (colors as `accent.50…950` palette steps, semantic tokens for `bg` / `paper` / `ink` / `line` that auto-switch between light and dark, `body` / `heading` / `mono` font tokens, polaroid shadow tokens, named keyframes) all live in `src/theme.ts` via `createSystem(defaultConfig, config)`. UI components are built from Chakra primitives + style props + recipes; the only plain CSS that survives is a `globalCss` block for `@font-face` and the SVG paper-noise `background-image` (no Chakra equivalent for inline SVG `data:` URIs in tokens). Native HTML elements from the prototype (`<input type="date">`, custom modal) are replaced with their Chakra equivalents (`DatePicker`, `Dialog`).

The result, top to bottom, on `/`, **mobile-first** (the prototype's `min-width: 720px` rules become Chakra's `md+` responsive variants):

- Sticky **topbar** with Recuerdea wordmark on the left; user pill (`Avatar.Fallback`) + "Cerrar sesión" button on the right.
- **Admin date-override banner** (admins only): striped diagonal background, paper "tape" decoration, "SOLO ADMIN" badge, Chakra `DatePicker`, "Restablecer" button when overridden, pulsing state indicator.
- **Hero** with day number ("27") huge in the heading font, "de abril" italic in accent color, year + count in mono caps below.
- **Vertical timeline** (line + year-marker dots) and per-year sections labelled "Hace 1 año" / "Hace N años" + count.
- **Masonry of polaroid tiles** (`columnCount={{ base: 2, md: 3, lg: 4 }}`): paper-framed, slight stable rotation, handwritten Caveat caption, video tiles get a play-icon badge.
- **Empty state** with three striped polaroids and a friendly Spanish message when no memories match.
- **Lightbox** per year section: Chakra `Dialog` (size `full`, dark overlay), image or `<video controls autoPlay>`, swipe + arrow keys + dots + counter + download link.

On `/login`: centered cream paper card on a textured background, three decorative striped polaroids floating behind, wordmark + "Hoy te espera algo del pasado." + email/password form.

## Architecture decisions

1. **Chakra-native everything.** No CSS classes, no custom CSS variables, no parallel design-token system. Color palette + font + shadow + keyframe tokens live in `src/theme.ts` via `createSystem`. Layout uses Chakra primitives (`Box`, `Stack`, `HStack`, `VStack`, `Container`, `SimpleGrid`, `Avatar`, `Image`, `Heading`, `Text`, `Button`, `IconButton`, `Field`, `Input`, `Dialog`, `DatePicker`). Pseudo-element decorations (the prototype's `::before` paper / stripes) become real `Box` children or `_before` style props. `data:` SVG paper-noise textures hide behind a `globalCss` block on the `system`. The only file with raw CSS is `globalCss` inside `theme.ts`; `src/styles.css` shrinks to `@font-face` declarations only.
2. **`accent` palette in the theme.** Define `colors.accent.{50,100,200,300,400,500,600,700,800,900,950}` from a hand-tuned ramp around the design's `#B8552E` (mid). Components consume `accent.500` / `accent.700` / etc. through tokens, never hex. The accent dot in the wordmark, hover states, the admin banner stripes, and the lightbox-dot indicator all reference the same palette.
3. **Light/dark via system preference.** Chakra v3's `defaultSystem` already follows `prefers-color-scheme` via `data-theme` toggling. We use `semanticTokens` with `_light` / `_dark` variants for `bg`, `bg.muted`, `paper`, `ink`, `ink.muted`, `line`, plus shadows. No user-facing toggle in v5; deferred. Source values come straight from `styles-v5.css` `:root` and `[data-theme="dark"]` blocks.
4. **Mobile-first via Chakra responsive props.** All spacing, typography, and column-count props use `{ base: …, md: … }`. The prototype's `@media (min-width: 720px)` rules become `md` (Chakra's `md` breakpoint defaults to 768px — close enough; we override to 720px in the system config to match).
5. **`accent.500` is the prototype's `#B8552E`.** Generated palette steps (hand-tuned):
   ```
   50  #FBF1EA   100 #F6DDCB   200 #EDB89A   300 #E29368   400 #D17542
   500 #B8552E   600 #9C4424   700 #7C361E   800 #5C2818   900 #3D1B11   950 #1F0E08
   ```
6. **Self-hosted fonts.** Download `.woff2` files for **Fraunces** (variable, with italic), **Inter** (variable), **Caveat** (variable), **JetBrains Mono** (variable) from Google Fonts via the CSS API. Place under `public/fonts/`. Declare `@font-face` in `globalCss` (font-display: swap). Add `<link rel="preload" as="font" type="font/woff2" crossorigin="anonymous" href="/fonts/...">` for Fraunces (display) and Inter (body) via `links` in `createRootRoute`. The other two load on-demand.
7. **Aspect-ratio metadata extracted in the cron** (Slice 2, before any masonry work). Extend `CachedMedia` with `width: number | null` / `height: number | null`. For images, `exifr` already parses the same byte range we use for capture date; we just request `ExifImageWidth` / `ExifImageHeight` (or `ImageWidth` / `ImageHeight` / `PixelXDimension` / `PixelYDimension` with an explicit fallback chain). For videos, extend the existing `tkhd` walk in `video-meta.ts` to read the trailing 16.16 fixed-point `width` / `height`. Both extractors stay best-effort: `null` when extraction fails. The polaroid tile sets `aspectRatio={width / height}` only when both are known; otherwise the image flows naturally — no jank.
8. **Lightbox is `Dialog.Root` size full.** Chakra's `Dialog` provides scroll-lock, `Esc`-to-close, focus trap, and scrim — we don't reimplement any of that. Custom chrome (top bar, swipe stage, dots) is composed with Chakra primitives inside `Dialog.Content`. Swipe + arrow-key handlers stay (manual `useEffect` + `onTouchStart`/`onTouchEnd`).
9. **Admin date input is Chakra `DatePicker`.** The current `AdminDateOverride.tsx` already uses Chakra `DatePicker` — we keep it and restyle the surrounding banner using Chakra style props (striped `bgGradient`, `_before` paper-tape decoration, `Badge`-styled "SOLO ADMIN" pill, animated state indicator).
10. **Year grouping is a pure function** in `src/lib/memory-grouping.ts` (with colocated tests). Plus a small `src/lib/spanish-months.ts` (or just an exported constant) for the lowercase Spanish month names used in the hero, login subline, and admin banner state pill.
11. **Branch is already `v5-ui-design`.** No `git checkout -b` step. Single PR `[v5] Analog-album UI port` → `main` at the end.

## Open question (need your call before Slice 2)

**Existing cached entries won't have width/height when the cron upgrade lands.** Two options:

- **(a) Lazy backfill**: cron only writes `width`/`height` for new or hash-changed entries. Existing entries stay `null` until their hash changes. UI handles `null` gracefully (no aspect-ratio reservation; image flows). Effectively, dimensions trickle in over time. **Simpler.**
- **(b) Forced backfill**: cron detects `width === undefined` (legacy schema) and re-extracts dimensions even when the hash hasn't changed. Single cron run after deploy → all entries have dimensions. Costs one extra range-fetch per cached file (we already do the fetch when capture-date is missing; here we'd fetch again purely to learn dimensions). **One-shot effort, higher first-run cost.**

I'll plan for (a) by default — UI degrades cleanly without dimensions, and entries refresh naturally as files change. Confirm or override.

## Assumptions (correct me before I start)

1. **Visual fidelity**: pixel-close to the prototype, with Chakra primitives carrying every layout/visual concern. Mobile takes priority over desktop. ✓ confirmed
2. **Spanish copy throughout.** ✓ confirmed
3. **Theme follows system preference**, no toggle in v5. ✓ confirmed
4. **`accent` palette generated from `#B8552E` as the mid step (500).** ✓ confirmed; palette steps above for review
5. **Fonts self-hosted** under `public/fonts/`, preloaded via `links` in `createRootRoute`. ✓ confirmed
6. **Aspect ratio added to `CachedMedia` + `MemoryItem` and extracted in the cron** before the masonry slice. ✓ confirmed
7. **No client-side fake-loading state** unless transitions feel janky in manual smoke. ✓ confirmed
8. **Avatar uses `Avatar.Fallback`** (no real picture wiring). ✓ confirmed; pill is non-clickable, no menu
9. **Admin date input stays as Chakra `DatePicker`**, restyled. ✓ confirmed
10. **Local dev smoke at `http://localhost:8888`** (`pnpm dev:netlify`), not `:3000`. ✓ confirmed
11. **No new top-level npm dependencies.** ✓ confirmed (fonts are static assets, not packages)

→ Reply with corrections or "go" to start Slice 1.

## Dependency graph

```
Slice 1: Chakra theme + fonts + globalCss + AppShell
          │
          ├──→ Slice 2: width/height in CachedMedia + MemoryItem + cron extractors
          │             │
          │             └──→ (Slice 6 needs this for AspectRatio sizing)
          │
          ├──→ Slice 3: Wordmark + Topbar
          │             │
          │             └──→ Slice 5: Hero + EmptyState + year-grouping
          │                            │
          │                            └──→ Slice 6: Polaroid + YearSection + masonry + timeline
          │                                          │
          │                                          └──→ Slice 7: Lightbox (Chakra Dialog)
          │
          ├──→ Slice 4: Login redesign (uses Wordmark)
          │
          └──→ Slice 8: Admin date-override banner restyle (Chakra DatePicker stays)

Slice 9: Spanish copy sweep, cleanup, deploy preview, merge.
```

Implementation order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9. Slices 2 and 3/4 are independent; 4 is independent of 3/5/6/7. Linear sequencing keeps reviewability simple.

## Slices

Each slice ends in a state where `pnpm test`, `pnpm type-check`, `pnpm lint`, `pnpm format:check`, `pnpm build` all pass and `pnpm dev:netlify` (port 8888) renders correctly. Commit per slice; one PR for the whole set.

---

### Slice 1 — Chakra theme + self-hosted fonts + AppShell

**Description.** Replace `defaultSystem` with a project-specific `system` built via `createSystem(defaultConfig, config)`. Adds the `accent` color palette, semantic tokens for `bg` / `paper` / `ink` / `line` (light + dark), font tokens, shadow tokens, named keyframes (`shimmer`, `pulse`, `fade`, `zoom`), a `globalCss` block (paper-noise `bgImage` on `body` for `_light` / `_dark`, `@font-face` declarations, `* { box-sizing: border-box }`). Self-hosts the four font families under `public/fonts/`. Adds a tiny `<AppShell>` Chakra wrapper that exists mainly to set the page-level paper background — most of the work lives in tokens.

**Acceptance criteria**

- [ ] `src/theme.ts` exports a `system` built via `createSystem(defaultConfig, defineConfig({...}))`.
- [ ] `theme.tokens.colors.accent.{50…950}` defined (the eleven steps listed in §5 of decisions).
- [ ] `theme.tokens.fonts.body / heading / mono` and a custom token (e.g. `theme.tokens.fonts.handwriting` for Caveat) defined.
- [ ] `theme.tokens.shadows.polaroid` and `polaroidLift` defined.
- [ ] `theme.semanticTokens.colors.{bg, bg.muted, paper, ink, ink.muted, line}` defined with `_light` / `_dark` variants. Source values from `styles-v5.css` `:root` + `[data-theme="dark"]`.
- [ ] `theme.keyframes.{shimmer, pulse, fade, zoom}` defined matching prototype durations + steps.
- [ ] `theme.breakpoints.md = "720px"` overrides the default to keep parity with the prototype's media queries.
- [ ] `globalCss` includes:
  - `* { box-sizing: border-box }`.
  - `body` gets the paper-noise `bgImage` (the SVG data URI from `styles-v5.css:48` adapted into `_light` / `_dark` color stops via accent token references).
  - `@font-face` blocks for Fraunces (4 weights including italic), Inter (3 weights), Caveat (3 weights), JetBrains Mono (3 weights), `font-display: swap`. Reference `/fonts/<name>.woff2`.
- [ ] Fonts downloaded to `public/fonts/` (woff2 variable when available; otherwise per-weight files). Sourced from Google Fonts CSS API via `curl` with a Chrome user agent; cited URLs preserved in a comment header at the top of `public/fonts/README.md` (or as a small `tasks/fetch-fonts.md` if we want to keep fonts dir clean).
- [ ] `__root.tsx`:
  - `<html lang="es">` (currently `"en"`).
  - `head.links` adds `{ rel: 'preload', as: 'font', type: 'font/woff2', crossOrigin: 'anonymous', href: '/fonts/Fraunces-VariableFont.woff2' }` and the analogous Inter preload.
  - `<ChakraProvider value={system}>` swapped from `defaultSystem`.
- [ ] `src/styles.css` reduced to `@font-face` declarations only, OR removed entirely if everything moves into `globalCss` (prefer the latter).
- [ ] `src/components/AppShell.tsx`: `<Box minH="100vh" color="ink">{children}</Box>` (the paper bgImage lives on `body` via `globalCss`, so `AppShell` is mostly a semantic wrapper).
- [ ] `src/routes/index.tsx` and `src/routes/login.tsx` wrap their component bodies in `<AppShell>`.

**Verification**

- [ ] `pnpm dev:netlify` (port 8888): home + login pages render on the cream paper background with the right body font; OS dark-mode toggle flips the page (background + text colors swap); no console errors; Network tab shows woff2 files served from `/fonts/...` (200 OK).
- [ ] `pnpm test`, `pnpm type-check`, `pnpm lint`, `pnpm format:check`, `pnpm build` all green.
- [ ] `curl -I http://localhost:8888/ | grep -i cache-control` still shows `private` / `no-store` (regression guard from SPEC §7).

**Files**

- `src/theme.ts` — NEW.
- `src/components/AppShell.tsx` — NEW.
- `src/routes/__root.tsx` — MODIFY (`<html lang>`, font preloads, `<ChakraProvider value={system}>`).
- `src/routes/index.tsx` — MODIFY (wrap in `<AppShell>`).
- `src/routes/login.tsx` — MODIFY (wrap in `<AppShell>`).
- `src/styles.css` — DELETE (or shrink to just `@font-face` if we don't put them in `globalCss`).
- `public/fonts/*.woff2` — NEW (multiple font binaries).
- `public/fonts/README.md` — NEW (one-liner: source + license attribution for the OFL fonts).

**Estimated scope**: M (≈8 files; the woff2 downloads count as a single batch).

---

### Slice 2 — Aspect-ratio metadata in `CachedMedia` + cron extractors

**Description.** Extend the v4 cache schema with `width` / `height`, plumb them through the loader to `MemoryItem`, and teach the cron's image and video extractors to harvest them from the same byte range we already fetch for the capture date. Lazy backfill (option (a) above): only new or hash-changed entries get dimensions written in this slice; existing entries stay `null` until they refresh naturally on file change. UI side stays untouched in this slice — it ignores the new fields. Slice 6 wires them into the `<Polaroid>`'s `aspectRatio`.

**Acceptance criteria**

- [ ] `src/lib/media-cache.ts`: `CachedMedia` gains `width: number | null` and `height: number | null`. `media-cache.test.ts` updated for the new fields (`null` round-trips unchanged).
- [ ] `src/lib/exif.ts`: existing `extractCaptureDate(downloadUrl)` continues to work. New sibling `extractImageMeta(downloadUrl): Promise<{ captureDate: Date | null; width: number | null; height: number | null }>` (or rename the existing one and return the wider record — pick the simpler API). Reads the same byte range; requests both date tags and dimension tags from `exifr.parse`. Falls back to `null` for missing tags.
- [ ] `src/lib/exif.test.ts` updated: round-trips a fixture EXIF that includes dimensions; round-trips a fixture without dimensions → `null`.
- [ ] `src/lib/video-meta.ts`: existing `extractVideoCaptureDate` continues to work. New sibling `extractVideoMeta(downloadUrl): Promise<{ captureDate: Date | null; width: number | null; height: number | null }>` that walks the `moov` → `trak` → `tkhd` path to read the 16.16 fixed-point width/height from the trailing bytes of the `tkhd` atom (per ISO BMFF spec). Falls back to `null` when `tkhd` not found.
- [ ] `src/lib/video-meta.test.ts`: extends the existing fixture-based tests with a case asserting non-null `{ width, height }` for a known fixture.
- [ ] `src/lib/refresh-memories.server.ts`:
  - `extractCaptureDateForFile` becomes `extractFileMeta(client, file): Promise<{ captureDate, width, height }>` (single helper, single byte fetch). Existing call site in `processFile` updated.
  - `fileToCachedMedia` accepts the wider record and writes `width` / `height` alongside `captureDate`.
- [ ] `src/lib/refresh-memories.server.test.ts` updated: asserts `width` / `height` end up in the cached entry for new files; assertion for hash-unchanged files remains "no fetch / no rewrite".
- [ ] `src/lib/pcloud.server.ts`: `MemoryItem`'s image and video variants gain `width: number | null` and `height: number | null`. `buildMemoryItem` passes them through.
- [ ] `src/lib/pcloud.server.test.ts` updated for the new shape.
- [ ] `MemoryItem` consumers (`MemoryView`, soon-to-be `Polaroid`) tolerate `null` (Slice 6 decides what to render).

**Verification**

- [ ] `pnpm test` includes the updated EXIF + video + cron tests; all pass.
- [ ] `pnpm type-check` clean.
- [ ] Manual cron smoke under `pnpm dev:netlify` (or via `pnpm invoke:refresh-memories` if it works locally): trigger the cron, inspect a fresh `media/<uuid>` Blobs entry, confirm `width` and `height` are integers (not `null`) for at least one image and one video. (For the local Blobs fallback, just trace through the test fixtures.)
- [ ] No regression on the loader path: `getTodayMemories` still returns expected items, now with the new fields.

**Files**

- `src/lib/media-cache.ts` — MODIFY.
- `src/lib/media-cache.test.ts` — MODIFY.
- `src/lib/exif.ts` — MODIFY (extend or sibling-add).
- `src/lib/exif.test.ts` — MODIFY.
- `src/lib/video-meta.ts` — MODIFY (extend `tkhd` walk).
- `src/lib/video-meta.test.ts` — MODIFY.
- `src/lib/refresh-memories.server.ts` — MODIFY.
- `src/lib/refresh-memories.server.test.ts` — MODIFY.
- `src/lib/pcloud.server.ts` — MODIFY (`MemoryItem` shape).
- `src/lib/pcloud.server.test.ts` — MODIFY.
- `src/components/MemoryView.tsx` — TOUCH (no logic change; just take the wider type cleanly).

**Estimated scope**: M (≈11 files, most are small typed extensions; the EXIF + video parsers are the only logic-heavy bits).

---

### Slice 3 — Wordmark + Topbar (Chakra-native)

**Description.** Reusable wordmark for topbar + login. The topbar itself: Chakra `<Box position="sticky" top={0} zIndex="docked" backdropFilter="blur(14px) saturate(160%)" bg="bg/80" borderBottomWidth="1px" borderColor="line">`, max-width 1080px container, mobile-first paddings.

**Acceptance criteria**

- [ ] `<Wordmark size?="sm" | "md" | "lg" />` renders the prototype's wordmark using Chakra primitives:
  - `<Text fontFamily="heading" fontStyle="italic" fontWeight={500} letterSpacing="-0.025em" color="ink">` wrapping a leading `<Box as="span" color="accent.500" transform="rotate(-4deg) translateY(-1px)" fontWeight={600}>R</Box>` + `ecuerdea` + a trailing `<Box as="span" color="accent.500" fontWeight={700}>.</Box>`.
  - `size` prop maps to `fontSize` token: `sm: '20px'`, `md: '22px'`, `lg: '28px'`.
  - No CSS classes.
- [ ] `<Topbar />`:
  - Outer Chakra `<Box as="header" position="sticky" …>` with the blur + border per design.
  - Inner `<Container maxW="1080px"><HStack justify="space-between" align="center" gap={3} py={2.5} px={{ base: 4, md: 4.5 }}>…</HStack></Container>`.
  - Left: `<Link href="/" color="ink" textDecor="none"><Wordmark size="md" /></Link>`.
  - Right: `<HStack gap={2.5}>` with the user pill + logout button.
  - User pill: `<HStack borderWidth="1px" borderColor="line" borderRadius="full" pl="3px" pr={{ base: '3px', sm: 3 }} py="3px" gap={2}><Avatar.Root size="xs"><Avatar.Fallback name={user.email} /></Avatar.Root><Text display={{ base: 'none', sm: 'inline' }} fontSize="sm" fontWeight={500}>{user.name}</Text></HStack>`.
  - Logout: `<Button variant="ghost" size="sm" borderRadius="full" borderWidth="1px" borderColor="line" colorPalette="gray" onClick={() => void logout()}><LogOut size={14} aria-hidden /><Text display={{ base: 'none', sm: 'inline' }}>Cerrar sesión</Text></Button>`. `aria-label="Cerrar sesión"` always set.
- [ ] Source the user via `useIdentity()` plus `Route.useRouteContext().user` fallback (existing `serverUser` pattern).
- [ ] No CSS classes anywhere; no `style` prop with raw CSS.

**Verification**

- [ ] Manual smoke at port 8888: topbar renders sticky, blurred; user pill compresses to icon-only on `<sm`; logout button collapses to icon on `<sm`.
- [ ] Click "Cerrar sesión" → user is logged out, redirected to `/login`.
- [ ] All gates green.

**Files**

- `src/components/Wordmark.tsx` — NEW.
- `src/components/Topbar.tsx` — NEW.
- `src/routes/index.tsx` — MODIFY (render `<Topbar />`).

**Estimated scope**: M (3 files).

---

### Slice 4 — Login redesign (Chakra-native)

**Description.** Replace the bare-bones centered login with the prototype's analog-album layout: three decorative striped polaroids floating absolute (real `Box` elements with rotation transforms and `_before` for the diagonal stripes), centered cream paper card, wordmark, "Hoy te espera<br/>algo del pasado." headline, "Entra para ver lo que pasó un {day} de {month} en años anteriores." subline, email/password form (Chakra `Field` + `Input`), primary "Entrar" button, "¿Olvidaste tu contraseña?" link, "Un pequeño ritual diario para tu familia." tagline.

**Acceptance criteria**

- [ ] Spanish copy throughout; no English strings remain on `/login`.
- [ ] All structural elements are Chakra components (`Stack` / `VStack` / `Box` / `Field` / `Input` / `Button` / `Heading` / `Text` / `Link`). No CSS classes.
- [ ] Decorative polaroids: three `<Box position="absolute" w="140px" h="165px" bg="paper" borderRadius="2px" boxShadow="polaroidLift" opacity={0.6} _before={{ content: '""', position: 'absolute', inset: '7px 7px 28px 7px', bgImage: 'repeating-linear-gradient(38deg, var(--bg-muted) 0 8px, var(--accent-soft) 8px 16px)', opacity: 0.8 }} />` with rotation + position variants per the prototype. Hidden on `<sm` for the third one.
- [ ] Card: `<Box maxW="400px" w="full" bg="paper" borderWidth="1px" borderColor="line" borderRadius="4px" p={{ base: 8, md: 9 }} boxShadow="polaroidLift" position="relative">`.
- [ ] Form submission still wires `login(email, password)` / `acceptInvite` / `updateUser` from `@netlify/identity` (existing flows preserved).
- [ ] Field labels: `<Field.Label fontFamily="mono" fontSize="11px" fontWeight={600} letterSpacing="0.1em" textTransform="uppercase" color="ink.muted">`.
- [ ] Submit button: `<Button colorPalette="ink" bg="ink" color="paper" w="full" h="44px" borderRadius="4px">Entrar</Button>` (use the new Chakra ink token); loading state via `loading` prop preserved.
- [ ] Mode-specific titles: `Aceptar invitación` (invite mode) / `Establecer contraseña` (recovery mode); email field hidden in invite/recovery modes (existing behaviour).

**Verification**

- [ ] Visual smoke: render `/login`, compare against the prototype rendering.
- [ ] Functional: log in with a real Netlify Identity user → redirect to `/` works.
- [ ] Invite + recovery hash flows still trigger the right `mode`.
- [ ] All gates green.

**Files**

- `src/routes/login.tsx` — REPLACE the component body; keep the existing `Route` config (`beforeLoad` + `handleAuthCallback` + the three form modes).

**Estimated scope**: M (1 file, heavy).

---

### Slice 5 — Year-grouping helper + Hero + EmptyState

**Description.** Pure year-grouping helper, plus Hero (big day + month + year + count meta) and EmptyState (three striped polaroids + Spanish empty copy).

**Acceptance criteria**

- [ ] `src/lib/spanish-months.ts` exports `SPANISH_MONTHS = ['enero', …, 'diciembre'] as const` (lowercase). Used by Hero, login subline, admin banner.
- [ ] `src/lib/memory-grouping.ts`:
  - `export type YearGroup = { readonly year: number; readonly yearsAgo: number; readonly items: readonly MemoryItem[] }`.
  - `export function groupMemoriesByYear(items: readonly MemoryItem[], today: { year: number; month: number; day: number }): readonly YearGroup[]`.
  - Pure: build a `Map<year, MemoryItem[]>`, then map to the output shape preserving input order; `yearsAgo = today.year - year`.
- [ ] `src/lib/memory-grouping.test.ts` covers: empty input → empty output; single item → one group with `yearsAgo: 1`; mixed years → grouped + ordered correctly; same-year items stay in input order.
- [ ] `<Hero today={{ day, month, year }} totalItems={N} groupCount={M} />` (`month` is a Spanish lowercase string passed in; `day` is a number):
  - `<Box as="section" pb={{ base: 8, md: 9 }} pt={{ base: 4, md: 5 }}>` with hero styling.
  - Day: `<Heading as="span" fontFamily="heading" fontWeight={400} letterSpacing="-0.04em" lineHeight="0.9" fontSize={{ base: 'clamp(64px, 16vw, 140px)', md: 'clamp(64px, 16vw, 140px)' }} color="ink">{day}</Heading>` (clamp keeps responsive sizing).
  - Month: `<Heading as="span" fontFamily="heading" fontStyle="italic" fontWeight={400} letterSpacing="-0.02em" fontSize={{ base: 'clamp(28px, 6vw, 52px)' }} color="accent.500">de {month}</Heading>`.
  - Meta line: `<HStack mt={4} fontFamily="mono" fontSize="12px" letterSpacing="0.06em" textTransform="uppercase" color="ink.muted" gap={3} flexWrap="wrap">` containing year + separator + count text. Count: `{N} recuerdos · {M} año/años` (singular/plural) or `Hoy en tus recuerdos` when zero.
- [ ] `<EmptyState today={{ day, month }} />`:
  - `<VStack maxW="540px" mx="auto" textAlign="center" px={5} pt={10} pb={15} gap={6} color="ink.muted">`.
  - Three decorative striped polaroids in a `<Box position="relative" h="130px" w="220px">`, each `<Box position="absolute" …>` with rotation + `_before` stripe pattern.
  - `<Heading fontFamily="heading" fontWeight={400} fontStyle="italic" fontSize="30px" letterSpacing="-0.02em" color="ink">Hoy, nada de nada.</Heading>`.
  - `<Text>Parece que ningún {day} de {month} ha pasado a la historia familiar todavía.<br/>Buena oportunidad para sacar la cámara hoy, ¿no?</Text>`.

**Verification**

- [ ] `pnpm test` includes the new `memory-grouping.test.ts` (4+ cases passing).
- [ ] Manual smoke: today (or admin override) hits `<EmptyState>` correctly; with items, hero count meta matches the items count.
- [ ] All gates green.

**Files**

- `src/lib/spanish-months.ts` — NEW.
- `src/lib/memory-grouping.ts` — NEW.
- `src/lib/memory-grouping.test.ts` — NEW.
- `src/components/Hero.tsx` — NEW.
- `src/components/EmptyState.tsx` — NEW.
- `src/routes/index.tsx` — MODIFY (compute `today`, group memories, render `<Hero>` + (groups, list-placeholder, or `<EmptyState>`)).

**Estimated scope**: M (6 files).

---

### Slice 6 — Polaroid + YearSection + masonry + timeline (Chakra-native)

**Description.** The core visual identity: `<Polaroid>` is a Chakra `<Box as="button">` with a stable rotation transform, paper bg, padding, and rounded corners; `<YearSection>` renders the year marker dot + label + count + masonry; the timeline line is a Chakra `<Box>` with absolute positioning. Masonry uses `columnCount={{ base: 2, md: 3, lg: 4 }}` directly on a `<Box>` — no plugin needed. Aspect ratios from Slice 2 reserve space cleanly.

**Acceptance criteria**

- [ ] `src/lib/rotation.ts`: pure `rotForKey(key: string): number` returning a deterministic angle in `[-2.4, 2.4]` (prototype's hash). Colocated test (`rotation.test.ts`) covers determinism + range.
- [ ] `src/components/Polaroid.tsx`:
  - Props: `item: MemoryItem`, `keyId: string`, `onClick: () => void`.
  - Renders a Chakra `<Box as="button" w="full" p={0} bg="transparent" border={0} display="block" mb={4} transform={\`rotate(${rotForKey(keyId)}deg)\`} \_hover={{ transform: 'rotate(0deg) translateY(-3px)' }} \_active={{ transform: 'rotate(0deg) translateY(-1px) scale(0.99)' }} transition="transform 0.25s cubic-bezier(.2,.7,.3,1)" onClick={onClick} aria-label={caption || 'Recuerdo'} sx={{ breakInside: 'avoid' }}>`.
  - Inner frame: `<Box bg="paper" pl={2} pr={2} pt={2} pb={7} borderRadius="2px" boxShadow="polaroid" _groupHover={{ boxShadow: 'polaroidLift' }} position="relative">`.
  - Photo box: `<Box position="relative" bg="bg.muted" overflow="hidden" w="full" aspectRatio={item.width && item.height ? item.width / item.height : undefined}>`.
  - `<Image src="/api/memory/${item.uuid}?variant=image" alt="" loading="lazy" w="full" h="full" objectFit="cover" filter="saturate(0.92) contrast(1.02)" />` (for video kind, uses `?variant=poster` and renders a `<Box position="absolute" bottom="7px" left="7px">` play badge with a small `Play` lucide icon, no duration label since we don't have duration server-side).
  - Caption (if non-empty after stripping extension + replacing `_-` with spaces): `<Text mt={2} fontFamily="handwriting" fontSize="17px" fontWeight={500} textAlign="center" color="ink" lineHeight="1.1" px={1}>{caption}</Text>`.
- [ ] `<YearSection group={YearGroup} onOpen={(year, idx) => void} />`:
  - `<Box as="section" position="relative" pl={{ base: 12, md: '130px' }} mb={14}>`.
  - Year marker: `<Box position="absolute" left={0} top={1}>` containing the dot (`<Box w="11px" h="11px" borderRadius="full" bg="accent.500" boxShadow="0 0 0 4px var(--bg), 0 0 0 5px var(--line)" position="absolute" left={{ base: '14px', md: '86px' }} top="11px" />`) and the year number on `md+` (`<Text display={{ base: 'none', md: 'block' }} fontFamily="mono" fontSize="13px" fontWeight={600} color="ink" letterSpacing="0.06em" textAlign="right" w="64px" pt={1}>{group.year}</Text>`).
  - Title: `<Heading as="h2" fontFamily="heading" fontStyle="italic" fontWeight={400} fontSize={{ base: 'clamp(22px, 4.6vw, 32px)' }} letterSpacing="-0.015em" color="ink">{yearsAgoLabel(group.yearsAgo)}{breakpoint < md ? \` · ${group.year}\` : ''}</Heading>`(the`· {year}`appears only on`<md` to keep the year visible when the marker is hidden).
  - Meta: `<Text fontFamily="mono" fontSize="11px" letterSpacing="0.08em" textTransform="uppercase" color="ink.muted" mt={1} mb={4.5}>{n} {n === 1 ? 'recuerdo' : 'recuerdos'}</Text>`.
  - Masonry: `<Box columnCount={{ base: 2, md: 3, lg: 4 }} columnGap={{ base: 3.5, md: 4.5 }}>` with `<Polaroid>` per item, `keyId={\`${group.year}-${idx}\`}`.
  - `yearsAgoLabel(n)`: `'Hace un año'` if `n === 1`; `\`Hace ${n} años\`` otherwise.
- [ ] Timeline line: `<Box position="absolute" left={{ base: '18px', md: '90px' }} top={2} bottom="60px" w="1px" bgGradient="to-b" gradientFrom="line" gradientTo="transparent" />`.
- [ ] Timeline end: `<Box position="absolute" left={{ base: '14px', md: '86px' }} bottom="50px" w="9px" h="9px" borderRadius="full" bg="bg" borderWidth="1px" borderColor="line" />`.
- [ ] Footer: `<Text mt={7} textAlign="center" color="ink.muted" fontFamily="heading" fontStyle="italic" fontSize="16px">Vuelve mañana — habrá nuevos recuerdos.</Text>`.
- [ ] DELETE `src/components/MemoryView.tsx` (replaced).

**Verification**

- [ ] Manual smoke at port 8888: 2-col masonry on iPhone-width, 3 on tablet (`md`), 4 on desktop (`lg`). Polaroids carry stable rotation across re-renders. Aspect ratios reserve space (no layout shift on image load when width/height are present).
- [ ] All images use `loading="lazy"`; no console errors.
- [ ] Click on a polaroid is a no-op for now; Slice 7 wires the lightbox.
- [ ] All gates green.

**Files**

- `src/lib/rotation.ts` — NEW.
- `src/lib/rotation.test.ts` — NEW.
- `src/components/Polaroid.tsx` — NEW.
- `src/components/YearSection.tsx` — NEW.
- `src/components/Timeline.tsx` — NEW (or inline; trivial).
- `src/components/MemoryView.tsx` — DELETE.
- `src/routes/index.tsx` — MODIFY (replace placeholder list with timeline + year sections).

**Estimated scope**: M (6 files net, 1 deleted).

---

### Slice 7 — Lightbox using Chakra `Dialog`

**Description.** Click a polaroid → fullscreen Chakra `Dialog` limited to that year's items. Image or `<video controls autoPlay>`, swipe horizontally between siblings on mobile, ←/→/Esc on desktop, dots indicator, counter, download link.

**Acceptance criteria**

- [ ] `<Lightbox group={YearGroup} startIndex={number} open={boolean} onClose={() => void} />` uses Chakra `<Dialog.Root open={open} onOpenChange={({ open }) => !open && onClose()} size="full">`.
- [ ] `<Dialog.Backdrop bg="rgba(12,9,6,0.94)" backdropFilter="blur(16px)">`.
- [ ] `<Dialog.Content bg="transparent" boxShadow="none" display="flex" flexDirection="column">` with three children: top bar, stage, caption.
- [ ] Top bar (`<HStack justify="space-between" px={4.5} py={3.5} color="whiteAlpha.85">`):
  - Left: year + "·" + lowercase "hace n años".
  - Right: counter `{i+1} / {N}` + download `IconButton` (`<a as="a" href="/api/memory/${uuid}?variant=image" target="_blank" rel="noopener" download>` with `Download` lucide icon) + close `IconButton` using `<Dialog.CloseTrigger>` (renders an `X` lucide icon).
- [ ] Stage (`<Box flex={1} position="relative" display="flex" alignItems="center" justifyContent="center" px={3} overflow="hidden" onTouchStart={…} onTouchEnd={…}>`):
  - Image: `<Image src="/api/memory/${uuid}?variant=image" alt="" maxW="full" maxH="full" objectFit="contain" borderRadius="2px" bg="black" />`.
  - Video: `<chakra.video src="/api/memory/${uuid}?variant=stream" controls autoPlay poster="/api/memory/${uuid}?variant=poster" maxW="full" maxH="full" objectFit="contain" borderRadius="2px" bg="black" />` (via `chakra('video')` factory or plain `<video>` styled).
  - Prev/next: `<IconButton position="absolute" left|right top="50%" transform="translateY(-50%)" w="44px" h="44px" borderRadius="full" bg="whiteAlpha.10" color="white" display={{ base: 'none', md: 'inline-flex' }} onClick={prev|next}>` showing `ChevronLeft|Right` lucide icons. Hidden when at edge.
- [ ] Caption (`<VStack align="center" gap={2.5} px={4.5} py={5} color="whiteAlpha.85" textAlign="center">`):
  - Caption text: `<Text fontFamily="handwriting" fontSize="22px" fontWeight={500}>{caption}</Text>` when present.
  - Dots: `<HStack gap={1.5}>` of `<Box w="6px" h="6px" borderRadius="full" bg={i === idx ? 'accent.500' : 'whiteAlpha.25'} transform={i === idx ? 'scale(1.3)' : undefined} />`.
- [ ] Keyboard: `useEffect` adding `keydown` listener for `ArrowLeft` / `ArrowRight`; clamp to `[0, items.length - 1]`. `Escape` is handled by Chakra `Dialog`.
- [ ] Touch: 50px-threshold swipe (prototype's logic).
- [ ] `aria-label` set on prev/next/close/download buttons.

**Verification**

- [ ] Manual smoke: open lightbox on a year with 3+ items, navigate via arrow keys + swipe + dots + prev/next; close via Esc + scrim click + close button. Video autoplays on entry, stops on next/prev (assert: pre-render `key={item.uuid}` so React unmounts between items). Download link opens in a new tab.
- [ ] No keyboard traps; tab cycles within the dialog.
- [ ] All gates green.

**Files**

- `src/components/Lightbox.tsx` — NEW.
- `src/routes/index.tsx` — MODIFY (own `lightbox` state, pass `onOpen` to `<YearSection>`, render `<Lightbox>` when state is non-null).

**Estimated scope**: M (2 files).

---

### Slice 8 — Admin date-override banner restyle (Chakra-native)

**Description.** Replace the bare-bones admin component with the prototype's analog-album banner, while keeping Chakra `DatePicker` for the input. Styled with Chakra style props (striped `bgImage`, `_before` paper-tape decoration, `Badge`-styled "SOLO ADMIN" pill, animated state indicator using the `pulse` keyframe defined in Slice 1).

**Acceptance criteria**

- [ ] Spanish copy throughout; matches prototype verbatim.
- [ ] Chakra `DatePicker` (the existing component) restyled via slot recipe overrides or inline style props to match the prototype's `<input type="date">` look (small mono input, accent focus ring, paper bg).
- [ ] Outer banner: `<Box position="relative" bgImage="repeating-linear-gradient(-45deg, color-mix(in srgb, var(--accent-500) 10%, var(--bg)) 0 14px, color-mix(in srgb, var(--accent-500) 4%, var(--bg)) 14px 28px)" borderBottomWidth="1px" borderBottomStyle="dashed" borderBottomColor="accent.300">`. (Color-mix usage references CSS variables exposed by Chakra tokens — confirm at impl time; if not exposed, use a less-saturated semantic-token fallback.)
- [ ] Tape decoration: `<Box position="absolute" left="50%" top="-7px" w="110px" h="16px" bg="accent.100" transform="translateX(-50%) rotate(-1deg)" opacity={0.85} boxShadow="sm" />` with dashed left/right borders.
- [ ] Inner row: `<HStack justify="space-between" gap={4.5} flexWrap="wrap" maxW="1080px" mx="auto" px={4.5} py={3.5}>`.
- [ ] Label region: `<HStack gap={2.5} flexWrap="wrap" flex={1}>` with the badge, title, help.
  - Badge: `<HStack bg="accent.500" color="paper" borderRadius="3px" px={2.25} py={1} fontFamily="mono" fontSize="10.5px" fontWeight={700} letterSpacing="0.12em" textTransform="uppercase" gap={1.25}><Star size={10} aria-hidden /> Solo admin</HStack>`.
  - Title: `<Text fontFamily="heading" fontStyle="italic" fontSize="16px" fontWeight={500} color="ink">Sobreescribir fecha de hoy</Text>`.
  - Help: `<Text display={{ base: 'none', md: 'inline' }} fontSize="12.5px" color="ink.muted" fontStyle="italic">Para pruebas — cambia qué día se considera «hoy».</Text>`.
- [ ] Controls: `<HStack gap={2.5} flexWrap="wrap">` containing `DatePicker`, `Restablecer` button (when overridden), state pill.
- [ ] State pill: `<HStack fontFamily="mono" fontSize="11px" letterSpacing="0.08em" textTransform="uppercase" color={isOverridden ? 'accent.500' : 'ink.muted'} gap={1.5}><Box w="7px" h="7px" borderRadius="full" bg="currentColor" boxShadow={isOverridden ? '0 0 0 3px color-mix(in srgb, var(--accent-500) 25%, transparent)' : undefined} animation={isOverridden ? \`${pulse} 1.6s ease-in-out infinite\` : undefined} />{isOverridden ? \`Simulando ${day} de ${month}\` : 'Fecha real'}</HStack>`.

**Verification**

- [ ] Manual smoke: as admin, change date → URL updates → loader re-runs → memories filter by the new day. "Restablecer" returns to today and clears the param. State pill animates when overridden.
- [ ] As non-admin: banner not rendered (existing wiring).
- [ ] All gates green.

**Files**

- `src/components/AdminDateOverride.tsx` — REPLACE.

**Estimated scope**: M (1 file, ~150 lines).

---

### Slice 9 — Spanish copy sweep, cleanup, deploy preview

**Description.** Catch remaining English strings, prune dead code, run all gates, push and smoke the deploy preview, merge.

**Acceptance criteria**

- [ ] `rg -n '\b(Welcome|Sign|Choose|Memories?|Today|Yesterday|Reset|Email|Password|Loading)\b' src/` — only allowed hits remain (manually inspect).
- [ ] `rg -n MemoryView src/` returns 0 matches.
- [ ] `pnpm test` green; `pnpm type-check` clean; `pnpm lint` clean; `pnpm format:check` clean; `pnpm build` clean. After build, `rm -rf dist .netlify` (per SPEC §7).
- [ ] Manual visual smoke against each prototype state at `localhost:8888`:
  - Logged-out → `/login` matches the analog-album login.
  - Logged-in (non-admin) → topbar + hero + (memories or empty).
  - Logged-in admin → topbar + admin banner + hero + (memories or empty).
  - With override set to a "rich" past date → year sections + masonry + lightbox.
  - With override set to today (or any empty day) → empty state.
  - OS dark-mode toggle → page flips theme.
- [ ] Push the v5-ui-design branch.
- [ ] Open PR `[v5] Analog-album UI port` → `main`.
- [ ] Deploy preview smoke:
  - All five states render correctly.
  - Network tab: media still flows through `/api/memory/<uuid>` (no upstream pCloud URL leaks).
  - `curl -I https://<deploy-preview>/` → `cache-control: private` (or `no-store` / absent).
  - No console errors / 401s / broken images.
- [ ] Pre-prod manual cron trigger if the prod cache schema bumped (Slice 2 added fields; existing entries stay null, so the cron just refreshes naturally over time — no urgent re-trigger required, but a manual run after deploy is cheap insurance).
- [ ] Pre-merge: human review on the deploy preview.
- [ ] Merge `v5-ui-design → main`. Post-merge prod smoke.

**Files**

- `src/routes/index.tsx`, `src/routes/login.tsx`, `src/routes/__root.tsx` — final copy/lang sweep.
- (potential deletes if any orphaned files emerge — confirm before removing).

**Estimated scope**: S.

---

## Checkpoints

### Checkpoint A — After Slice 4 (Foundation + auth + login)

- All gates green. `/login` matches the prototype. `/` renders dressed in the analog-album theme with topbar, but body is still a placeholder list.
- Human review before continuing into Slice 5.

### Checkpoint B — After Slice 6 (Static home is feature-complete)

- All prototype-static states render pixel-close to the prototype.
- Aspect ratios from Slice 2 reserve space cleanly.
- No interactivity beyond logout + admin date picker. Lightbox lands in Slice 7.
- Human review before continuing into Slice 7.

### Checkpoint C — After Slice 8 (Full feature parity)

- Lightbox + admin banner both interactive.
- Spot-check on iPhone-width emulator + tablet + desktop.
- Human review before Slice 9.

### Checkpoint D — Final / merge

- PR opened, deploy preview smoked, ready to merge into `main`.

---

## Risks & mitigations

| Risk                                                                                                              | Impact                                                                         | Mitigation                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chakra v3's `_before` / pseudo-element styling can't reproduce the SVG paper-noise texture cleanly.               | Low — only one place (the page bg).                                            | Keep the noise SVG `bgImage` in `globalCss` as a single string (not a token); reference accent tokens via CSS custom-property pass-through. If it gets unwieldy, accept a small `body { background-image: url(data:image/svg+xml…) }` line in `styles.css` and document it. |
| `colorPalette="ink"` doesn't work because `ink` isn't a registered Chakra color palette (semantic, not numbered). | Medium — affects login button + topbar hover states.                           | Define `ink` as a registered palette with mid-step `500` matching the semantic token; or fall back to inline `bg="ink"` + manual hover handlers. Validate at end of Slice 1.                                                                                                |
| `breakpoints.md = "720px"` override breaks Chakra defaults that other devs rely on.                               | Low — sole consumer of the system is this app.                                 | Override is intentional and matches the prototype. Documented in `theme.ts`.                                                                                                                                                                                                |
| `exifr` doesn't return dimensions for some image formats (HEIC, RAW, certain mobile-camera JPEGs).                | Medium — masonry falls back to "no aspect ratio reserved" → image-load reflow. | Polaroid degrades cleanly: when both width/height null, omit `aspectRatio`. Acceptable. If it's a frequent regression, add a JPEG-SOF marker fallback parser (no extra fetch needed).                                                                                       |
| `tkhd` walk fails on some video containers (e.g. unusual codec, MOV variants).                                    | Low — videos are rare.                                                         | Same null-tolerance as above.                                                                                                                                                                                                                                               |
| Chakra `DatePicker` slot recipes are hard to override to match the prototype's compact mono input.                | Medium                                                                         | Use `Input` styling props on `DatePicker.Input asChild`; if recipes still resist, accept a slightly less-tight visual.                                                                                                                                                      |
| Self-hosted variable fonts add weight; Fraunces variable is ~150KB.                                               | Low — preloaded above-the-fold.                                                | Preload only Fraunces + Inter in `links`; let Caveat + JBM load on demand.                                                                                                                                                                                                  |
| OS dark-mode preference change causes a flash before Chakra applies the theme.                                    | Low                                                                            | Chakra v3 handles the SSR/CSR handoff with `data-theme`; verify no flash in manual smoke.                                                                                                                                                                                   |
| Existing v4 cache entries lack `width`/`height`.                                                                  | Medium — masonry partially without aspect ratios for a while.                  | Lazy backfill (option (a)). Document it; UI tolerates `null`. If it bothers you, run a forced backfill via cron flag (one extra commit).                                                                                                                                    |

## Out of scope (explicit)

- User-facing theme toggle (deferred — system preference only in v5).
- User-facing accent color picker (hardcoded palette).
- Tweaks panel (prototype-only debugging surface).
- Pending-component for date-picker transitions (TanStack Router) — add only if manual smoke shows jank.
- Caching / offline support; HTML stays `Cache-Control: private`.
- Tests for UI components (per SPEC §6, only `lib/` logic is required to be tested; new UI components are visually verified via `pnpm dev:netlify`).
- Avatar real-image wiring; `Avatar.Fallback` only.

## File touch list

| File                                      | Slice         | Action                                                                   |
| ----------------------------------------- | ------------- | ------------------------------------------------------------------------ |
| `src/theme.ts`                            | 1             | NEW                                                                      |
| `src/components/AppShell.tsx`             | 1             | NEW                                                                      |
| `src/routes/__root.tsx`                   | 1             | MODIFY (`<html lang>`, font preloads, `<ChakraProvider value={system}>`) |
| `src/styles.css`                          | 1             | DELETE (or shrink)                                                       |
| `public/fonts/*.woff2`                    | 1             | NEW (font binaries)                                                      |
| `public/fonts/README.md`                  | 1             | NEW (attribution)                                                        |
| `src/lib/media-cache.ts`                  | 2             | MODIFY (`width`/`height` fields)                                         |
| `src/lib/media-cache.test.ts`             | 2             | MODIFY                                                                   |
| `src/lib/exif.ts`                         | 2             | MODIFY (extract dimensions)                                              |
| `src/lib/exif.test.ts`                    | 2             | MODIFY                                                                   |
| `src/lib/video-meta.ts`                   | 2             | MODIFY (`tkhd` walk)                                                     |
| `src/lib/video-meta.test.ts`              | 2             | MODIFY                                                                   |
| `src/lib/refresh-memories.server.ts`      | 2             | MODIFY                                                                   |
| `src/lib/refresh-memories.server.test.ts` | 2             | MODIFY                                                                   |
| `src/lib/pcloud.server.ts`                | 2             | MODIFY (`MemoryItem` shape)                                              |
| `src/lib/pcloud.server.test.ts`           | 2             | MODIFY                                                                   |
| `src/components/Wordmark.tsx`             | 3             | NEW                                                                      |
| `src/components/Topbar.tsx`               | 3             | NEW                                                                      |
| `src/routes/index.tsx`                    | 1, 3, 5, 6, 7 | MODIFY (incremental)                                                     |
| `src/routes/login.tsx`                    | 1, 4          | MODIFY                                                                   |
| `src/lib/spanish-months.ts`               | 5             | NEW                                                                      |
| `src/lib/memory-grouping.ts`              | 5             | NEW                                                                      |
| `src/lib/memory-grouping.test.ts`         | 5             | NEW                                                                      |
| `src/components/Hero.tsx`                 | 5             | NEW                                                                      |
| `src/components/EmptyState.tsx`           | 5             | NEW                                                                      |
| `src/lib/rotation.ts`                     | 6             | NEW                                                                      |
| `src/lib/rotation.test.ts`                | 6             | NEW                                                                      |
| `src/components/Polaroid.tsx`             | 6             | NEW                                                                      |
| `src/components/YearSection.tsx`          | 6             | NEW                                                                      |
| `src/components/Timeline.tsx`             | 6             | NEW (or inline)                                                          |
| `src/components/MemoryView.tsx`           | 6             | DELETE                                                                   |
| `src/components/Lightbox.tsx`             | 7             | NEW                                                                      |
| `src/components/AdminDateOverride.tsx`    | 8             | REPLACE                                                                  |

---

## Post-implementation manual adjustments (post-Slice 9)

After Slice 9 landed (commit `3ce81b4`), the user pushed four follow-up commits trimming ornaments and adjusting components to taste. Branch `v5-ui-design` is now pushed to `origin` at `45b244c`.

| Commit    | Title                      | What changed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `956229b` | Update todos               | Refreshed `tasks/todo.md` to record commit shas + manual smoke status. Documentation only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `7193a81` | Simplify AdminDateOverride | Big trim (-194 / +45). Removed paper-tape decoration, "Sobreescribir fecha de hoy" title, italic help text, hand-built `Restablecer` button, animated state pill. Replaced hand-built badge `HStack` with the Chakra `Badge` primitive (`<Star size={10} fill="currentColor" /> Solo admin`). Switched `<DatePicker>` from controlled `value` to uncontrolled `defaultValue`. Added `DatePicker.IndicatorGroup` with built-in `ClearTrigger` (replaces the manual reset). Renamed prop `activeDate` → `initialActiveDate`. `src/routes/index.tsx` updated to match the renamed prop. |
| `45e48d0` | Use IconButton for logout  | Replaced the `Button` (icon + text label) with an icon-only `IconButton` in `Topbar`. Drops the "Cerrar sesión" text label entirely; icon + `aria-label` carry the affordance.                                                                                                                                                                                                                                                                                                                                                                                                       |
| `45b244c` | Remove custom mono font    | Deleted `public/fonts/jetbrainsmono-latin.woff2` (~31 KB). Removed `mono` font token from `theme.ts` and JetBrains Mono `@font-face` from `src/fonts.css`. Mono now resolves through Chakra's default mono stack — design fidelity is acceptable.                                                                                                                                                                                                                                                                                                                                    |

### What now diverges from the original Slice 8 spec

The simplified `AdminDateOverride` no longer matches Slice 8's acceptance criteria. **Kept**: striped `bgImage` background, dashed accent border-bottom, `Badge` with `Star` icon, Chakra `DatePicker` with mono input + accent focus ring. **Removed (intentionally)**: paper-tape `_before` decoration, banner title, italic help, animated state pill, hand-built `Restablecer` button. The functional behavior is unchanged — admin can override and clear the date — just with less chrome. Slice 8 task list in `todo.md` reflects this.

### Bug fixed during this update

`src/components/AdminDateOverride.tsx` — `onValueChange` was missing a `return` after the empty-search navigate, so clearing the date would crash with `Cannot read property 'toString' of undefined`. Added the `return` (one-line fix). TypeScript didn't catch it because `noUncheckedIndexedAccess` is off, so `picked[0]` types as `DateValue` instead of `DateValue | undefined`.

### Remaining work

- [x] Manual smoke at `localhost:8888` — _user is responsible_
- [x] Push branch — _done (`origin/v5-ui-design` at `45b244c`)_
- [ ] Open PR `[v5] Analog-album UI port` → `main` — _awaiting user "go" (PR creation is a shared-state action)_
- [ ] Deploy preview smoke — _after PR opens_
- [ ] Pre-merge review on the deploy preview
- [ ] Merge `v5-ui-design → main`
- [ ] (Optional) Manually trigger cron / wipe Blobs cache so existing entries pick up `width`/`height`
