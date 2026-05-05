# Recuerdea

A personal **"on this day"** memory surfacer. The home page surfaces every photo and video taken on today's month/day in a past year, drawn from a pCloud folder owned by the user. Single-user app — the owner is the only authenticated visitor.

The full architecture, acceptance criteria, and boundary rules live in [`SPEC.md`](./SPEC.md).

## Stack

- **TanStack Start** (TanStack Router + Vite) hosted on **Netlify**.
- **Chakra UI v3** for components, custom theme in `src/theme.ts`, self-hosted variable fonts in `public/fonts/`.
- **pCloud** as the media store, accessed via `pcloud-kit` from server-only modules.
- **Netlify Blobs** as the metadata cache (`media/<uuid>`, `fileid-index/<fileid>`, `folder/v1`).
- **Netlify Scheduled Function** (`netlify/functions/refresh-memories.ts`) refreshes the cache daily.
- **Netlify Identity** for auth.
- **Geoapify** for reverse-geocoding GPS coordinates into Spanish place captions.
- **Vitest** with two projects: `unit` (Node) + `browser` (headless Chromium via Playwright).

## Prerequisites

- Node.js (matching the version pinned in CI).
- `pnpm@10.30.2` (declared in `packageManager`).
- A linked Netlify site for `pnpm dev:netlify` (Functions + Blobs require it).
- Server-only environment variables (set via `netlify env:set` for previews/prod, or in a local `.env` consumed by `netlify dev`):
  - `PCLOUD_TOKEN` — pCloud OAuth access token (provision via `node scripts/oauth-provision.mjs`).
  - `PCLOUD_MEMORIES_FOLDER_ID` — pCloud folder id to scan.
  - `GEOAPIFY_API_KEY` — for the cron's reverse-geocoding pass.
  - Optional: `RECUERDEA_GEOCODE_MAX_PER_RUN` (default 200).

## Getting started

```bash
pnpm install
pnpm netlify link            # one-time, links to the Netlify site
pnpm dev:netlify             # production-shaped local dev at http://localhost:8888
```

`pnpm dev` (port 3000) runs Vite alone — fine for UI work but lacks Netlify Functions and Blobs, so the home loader falls back to the empty state.

The cron is the **only writer** for the Blobs cache. Before the home page can render anything, trigger the scheduled function once:

```bash
pnpm invoke:refresh-memories     # local; Netlify dev must be running
# or trigger from the Netlify dashboard for a deploy preview / prod
```

## Scripts

| Command                        | Purpose                                                 |
| ------------------------------ | ------------------------------------------------------- |
| `pnpm dev`                     | Vite dev server on port 3000 (no Functions / Blobs).    |
| `pnpm dev:netlify`             | `netlify dev` on port 8888 — Functions + Blobs enabled. |
| `pnpm build`                   | Production build.                                       |
| `pnpm preview`                 | Preview the production build locally.                   |
| `pnpm test`                    | Run all Vitest projects.                                |
| `pnpm test:unit`               | Run only the Node unit project.                         |
| `pnpm test:browser`            | Run only the headless-Chromium browser project.         |
| `pnpm type-check`              | `tsc --noEmit`.                                         |
| `pnpm lint` / `pnpm lint:fix`  | oxlint.                                                 |
| `pnpm format` / `format:check` | oxfmt.                                                  |
| `pnpm invoke:refresh-memories` | Invoke the scheduled function on the local dev server.  |

CI (`.github/workflows/ci.yml`) runs type-check, test, lint, and format-check in parallel; all must pass.

## Project layout

Top-level orientation; the canonical map is in [`SPEC.md` §4](./SPEC.md#4-project-structure).

```
src/
  routes/            # TanStack Router file-based routes (incl. api/video/$uuid.ts proxy)
  components/        # Chakra-native presentational components
  lib/
    auth/            # Netlify Identity wrapper + server-only auth helpers
    cache/           # Netlify-Blobs-backed media-cache, fileid-index, folder-cache
    media-meta/      # EXIF, MP4/MOV walker, Geoapify reverse-geocoder
    memories/        # pCloud loader, refresh cron, video proxy, download helpers
    utils/           # Spanish months, polaroid rotation, navigation, years-ago
  theme.ts           # Chakra v3 system: palette, tokens, fonts, paper-noise bg
  fonts.css          # Self-hosted variable woff2 declarations
netlify/functions/   # Scheduled refresh-memories function
patches/             # @netlify/identity patch (cookie persistence)
scripts/             # oauth-provision.mjs (one-time pCloud token bootstrap)
```

## Conventions

- **Formatter**: oxfmt — tabs, single quotes, no semicolons.
- **Linter**: oxlint.
- **Pre-commit**: `simple-git-hooks` runs `oxlint --fix` + `oxfmt` on staged files. Don't bypass with `--no-verify`.
- **Imports**: prefer the `#/*` alias for cross-module imports inside `src/`.
- **Tests**: colocate `*.test.ts(x)` with source for `src/lib/`; component browser tests use `*.browser.test.tsx`.
- **Comments**: minimal — only when the *why* is non-obvious.

## Deployment

PRs target `main`. Netlify spins a deploy preview per PR. `main` is protected — no direct pushes. Smoke the deploy preview before merge: trigger the cron once via the Netlify dashboard, then load `/` against the preview URL.

For boundaries (what to never do — public-cache the home page, sign IP-bound URLs, ship pCloud tokens to the browser, etc.), see [`SPEC.md` §7](./SPEC.md#7-boundaries).
