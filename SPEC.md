# Recuerdea — Specification

## 1. Objective

Recuerdea is a personal **"on this day" memory surfacer**. Each visit to the home page surfaces a single image taken on today's month/day in a past year, drawn from a pCloud folder owned by the user. The product goal is rediscovery: turn a static cloud photo archive into a daily ritual that resurfaces forgotten moments.

**Target user**: a single authenticated user (the owner). Multi-tenant / shared-album use cases are explicitly out of scope.

**Non-goals (v1)**:

- Uploading, editing, or deleting images.
- Tagging, captioning, or otherwise mutating image metadata.
- Browsing arbitrary images in a gallery view.
- Search or filtering.

## 2. v1 Acceptance Criteria

- `GET /` (authenticated): server picks an image whose EXIF capture date matches today's month/day (any year) and renders it with the original capture date visible.
- If multiple images match, one is chosen (deterministic-per-day or random — implementer's choice, document in code).
- If no image matches, render a friendly empty state ("No memories on this day") with a button that surfaces a random image instead.
- Unauthenticated visits redirect to `/login` via `beforeLoad` (existing behavior).
- The pCloud SDK access pattern stays server-only via `createServerFn`.

## 3. Commands

| Command          | Purpose                                         |
| ---------------- | ----------------------------------------------- |
| `pnpm install`   | Install deps (pnpm 10.30.2).                    |
| `pnpm dev`       | Start the Vite dev server.                      |
| `pnpm build`     | Production build.                               |
| `pnpm test`      | Run Vitest in browser mode (headless Chromium). |
| `pnpm lint`      | Run oxlint.                                     |
| `pnpm format`    | Run oxfmt.                                      |
| `pnpm typecheck` | Run `tsc --noEmit`.                             |

CI (`.github/workflows/ci.yml`) runs type-check, test, lint, and format-check in parallel; all must pass.

## 4. Project Structure

```
src/
  routes/           # TanStack Router file-based routes
    __root.tsx
    index.tsx       # Today's memory view (v1 home)
    login.tsx       # Netlify Identity login + invite/recovery callbacks
  lib/              # Pure logic + server functions; tests colocated as *.test.ts(x)
    auth.ts         # getServerUser() — server-only auth
    pcloud.ts       # createServerFn wrappers for pCloud
    pcloud.server.ts# pCloud SDK init (process.env secrets)
    identity-context.tsx
    navigation.ts   # hardNavigate (post-logout cookie refresh)
  router.tsx        # getRouter() factory
  routeTree.gen.ts  # auto-generated, never edit by hand
test/
  setup.ts          # Vitest browser-mode setup, mocks @netlify/identity
  stubs/            # Stubs for @tanstack/react-start in browser mode
__mocks__/
  @netlify/identity.ts
```

Path alias `#/*` → `./src/*` (declared in `package.json` `imports`).

## 5. Code Style

- **Formatter**: oxfmt (config: `oxfmt.config.ts`). Tabs for indentation, single quotes, no semicolons.
- **Linter**: oxlint (config: `oxlint.config.ts`).
- **Pre-commit**: `simple-git-hooks` + `nano-staged` runs `oxlint --fix` and `oxfmt` on staged files. Never bypass with `--no-verify`.
- **Comments**: minimal — only when _why_ is non-obvious. No "what" comments for self-documenting code.
- **Imports**: prefer the `#/*` alias for cross-module imports inside `src/`.

## 6. Testing Strategy

- **Required**: Vitest browser-mode tests for any new logic added to `src/lib/`. Tests colocate with source as `*.test.ts(x)`.
- **Optional**: Route-level / UI tests are nice-to-have for v1 but not blocking.
- **Setup**: `test/setup.ts` mocks `@netlify/identity` and shims `globalThis.process`. New tests should reuse this setup, not re-mock from scratch.
- **CI gate**: `pnpm test` must pass on every PR (matrix in `.github/workflows/ci.yml`).
- **Server functions**: test the pure helpers they wrap, not the `createServerFn` wrapper itself (which is framework code).

## 7. Boundaries

### Always do

- Use TanStack Router `beforeLoad` + router context for route auth guards (existing pattern: `src/routes/index.tsx:8`, `src/routes/login.tsx:8`).
- Keep server-only secrets (pCloud credentials, future tokens) behind `createServerFn` (`src/lib/pcloud.ts:5`, `src/lib/pcloud.server.ts`). Read from `process.env` only inside server-only modules.
- Colocate tests with source under `src/lib/` for any new pure logic.
- Use the existing path alias `#/*` for `src/` imports.

### Ask first

- **Adding any new top-level dependency** — including the EXIF parser needed for v1. List candidates and tradeoffs; wait for approval.
- Changes to `oxlint.config.ts` / `oxfmt.config.ts` / `tsconfig.json` / `vite.config.ts`.
- Changes to `.github/workflows/ci.yml`.
- Introducing a new top-level route or restructuring `src/lib/`.

### Never do

- Disable per-route SSR as a shortcut for auth issues (use `beforeLoad` instead).
- Import server-only modules (`*.server.ts`, anything reading `process.env`) from client-rendered code.
- Edit `src/routeTree.gen.ts` — it is auto-generated.
- Bypass `simple-git-hooks` with `--no-verify`.
- Swap the stack: no React Native, no Next.js, no replacing Chakra UI v3, no replacing Vitest. Stack is locked for v1.
- Build a tagging / upload / metadata UI in v1 — out of scope.

## 8. Open Questions (resolve before implementation)

1. **EXIF library choice** — `exifr` vs `exif-parser` vs other. Needs approval per the "ask first" boundary.
2. **Pick determinism** — when multiple images match today's month/day, pick deterministically (e.g. seeded by date) or randomly per request? Decide at implementation time and document the choice in code.
3. **Future metadata store** — Netlify Blobs is the agreed direction when v2 introduces tagging, but no schema or implementation work is in v1 scope.
