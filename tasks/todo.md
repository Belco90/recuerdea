# v8 — pCloud auth: session token (`?auth=`) → OAuth2 access token (`?access_token=`) — todo

Slice-by-slice checklist mirroring `tasks/plan.md`. Tick boxes as work lands. Each phase ends with an explicit checkpoint.

Branch: `v8-oauth` (cut from `main` when ready). PR target: `main`.

> v8 is a pre-requirement for v9 (browser-side pCloud calls). v8 picks OAuth specifically because it's the format `pcloud-kit/oauth-browser` produces. v8 itself does **not** introduce browser-side pCloud calls — that needs a SPEC §7 update and is owned by v9. See `tasks/plan.md` "Forward to v9".

## Phase 1 — Provision the access token (one-off, local)

### Task 1 — Configure the pCloud OAuth app

- [ ] Set the redirect URI on the pCloud OAuth app (e.g. `http://localhost:8787/oauth/callback`).
- [ ] Export `PCLOUD_CLIENT_ID`, `PCLOUD_APP_SECRET`, `PCLOUD_REDIRECT_URI` in your shell. Do **not** commit.
- [ ] Sanity: visiting `https://my.pcloud.com/oauth2/authorize?client_id=<id>&redirect_uri=<encoded>&response_type=code` shows the consent screen for the right account (no "invalid redirect_uri" error).

### Task 2 — Add `scripts/oauth-provision.mjs` (kept long-term)

- [ ] Create the script. Reads env, prints authorize URL on stderr, reads `code` from stdin (bare code or callback URL), calls `getTokenFromCode` from `pcloud-kit/oauth`, prints `access_token=...` + `locationid=...` to stdout.
- [ ] Errors clearly on stderr when `PCLOUD_CLIENT_ID` / `PCLOUD_APP_SECRET` / `PCLOUD_REDIRECT_URI` is missing (exit 1).
- [ ] Does not write secrets to any file. Uses `stdout.write` for the token output and `stderr.write` for prompts/errors — no `console.log` / `console.error` calls anywhere in the script.
- [ ] Smoke: `node scripts/oauth-provision.mjs` with valid env + a fresh code prints a non-empty token + locationid.

### Task 3 — Mint the access token

- [ ] Run the provisioning flow end-to-end. Replace `PCLOUD_TOKEN` value in `.env.local` with the new OAuth access token.
- [ ] Confirm `locationid === 2` (EU). If `1` (US), pause — user expected EU; investigate before continuing.
- [ ] Verify (server-side): `curl -fsS "https://eapi.pcloud.com/userinfo?access_token=$PCLOUD_TOKEN" | jq '.result'` → `0`.
- [ ] Verify (sanity): same `curl` with the **old** session-token value → non-zero `result` (confirms you actually swapped).
- [ ] Old session token is **not** archived in any committed file.

### Task 3.5 — Browser-CORS smoke (v9 viability check)

- [ ] In any browser DevTools console: `await fetch('https://eapi.pcloud.com/userinfo?access_token=<TOKEN>').then(r => r.json())` returns `{ result: 0, email: '<expected>' }`.
- [ ] No CORS error in the console.
- [ ] Result captured in PR description for v9 reference. (If it fails, v8 still ships; document the failure for v9.)

### Checkpoint A — token works against pCloud (server + browser)

- [ ] `userinfo` over OAuth (server-side `curl`) returns the expected account.
- [ ] `userinfo` over OAuth (browser-side `fetch`) returns the expected account, no CORS error (or failure documented for v9).
- [ ] `locationid` recorded as `2` in PR notes.

## Phase 2 — Code change

### Task 4 — Drop `type: 'pcloud'` in both `createClient` calls

- [ ] `netlify/functions/refresh-memories.ts:34` → `createClient({ token })`.
- [ ] `src/routes/api/memory/$uuid.ts:15` → `createClient({ token })`.
- [ ] No `apiServer` override added (EU is the SDK default; user confirmed `locationid === 2`).
- [ ] `grep -rn "type: 'pcloud'" src netlify` → 0 matches.
- [ ] `pnpm type-check`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `pnpm build`, then delete `dist/` + `.netlify/` cache (per SPEC §7).
- [ ] Local smoke (`pnpm dev`):
  - [ ] Home `/` renders memories.
  - [ ] `/api/memory/<uuid>?variant=thumb` → 200.
  - [ ] `/api/memory/<uuid>?variant=stream` → 206 with `Range`.
  - [ ] `/api/memory/<uuid>?variant=download` → 200 with `Content-Disposition: attachment`.

### Checkpoint B — local works end-to-end

- [ ] No `PcloudApiError` in dev console for any of the three variant paths.
- [ ] `git diff main` shows only the two `createClient` lines and the new `scripts/oauth-provision.mjs`. No incidental edits.

## Phase 3 — Deploy + cron under OAuth

### Task 5 — Update Netlify env vars (do this BEFORE pushing the branch)

- [ ] Netlify Site → Environment variables → `PCLOUD_TOKEN` updated for **Deploy-preview** scope to the OAuth access token.
- [ ] Same for **Production** scope.
- [ ] Other env vars (`PCLOUD_MEMORIES_FOLDER_ID`, `GEOAPIFY_API_KEY`, `RECUERDEA_GEOCODE_MAX_PER_RUN`) untouched.
- [ ] Last-modified timestamp on the env entry is fresh; value length matches what the script printed.

### Task 6 — Push branch, smoke preview, run cron once

- [ ] Push `v8-oauth`. Open PR → `main`.
- [ ] Manually trigger the scheduled function via the Netlify Functions panel.
  - [ ] `statusCode: 200`.
  - [ ] Cron summary log: `scanned=N alive=N removed=…`. No `result=2000` / `result=1000`.
- [ ] Deploy-preview smoke (logged in via Identity):
  - [ ] Home `/` renders memories.
  - [ ] `?variant=thumb` → 200.
  - [ ] `?variant=stream` → 206.
  - [ ] `?variant=download` → 200 + attachment.
- [ ] `curl -I https://<preview>.netlify.app/` → `Cache-Control: private` (sanity, no expected change).

### Task 7 — Merge + production cutover

- [ ] CI green (type-check / test / lint / format-check).
- [ ] Merge to `main`. Production deploy completes.
- [ ] Manually trigger the production scheduled function once.
  - [ ] `statusCode: 200`, normal summary line, no auth errors.
- [ ] Repeat the three-variant smoke against prod.
- [ ] Set a calendar reminder for 1 week to revoke the old session token (Task 8).

### Task 8 — Revoke the old session token (≥ 1 week after Task 7)

- [ ] Wait ≥ 7 days after Task 7 merge.
- [ ] Confirm cron has run successfully on at least 5 of those days (Netlify Functions log).
- [ ] No `result=2000` / `result=1000` errors in the function logs in that window.
- [ ] pCloud Console → Sessions / Active tokens → revoke the previous session token.
- [ ] Verify: `curl -fsS "https://eapi.pcloud.com/userinfo?auth=<old-session-token>"` returns non-zero `result` (old token dead).
- [ ] Verify: home page + cron continue to work under the OAuth token.

## Forward-looking — v9 prep (do NOT do in v8)

These belong in a v9 plan, not here. Listed so we don't accidentally bake decisions into v8 that v9 will need to undo.

- [ ] Decide token-distribution model (A: shared token, B: separate per-session browser token via `pcloud-kit/oauth-browser`). Recommendation: **B**.
- [ ] SPEC §7 update — rewrite the "never do" entries that currently forbid browser-side pCloud activity.
- [ ] Smoke each pCloud endpoint v9 needs from a browser origin; build the allow-list.
- [ ] Decide a real deployed callback URL for the browser flow (e.g. `/oauth/pcloud-callback`) and register it on the pCloud app.
- [ ] UX for the per-session pCloud sign-in (separate button vs chained after Identity login). Affects `src/routes/login.tsx`.
- [ ] Re-evaluate `/api/memory/<uuid>` — keep, deprecate, or partial.
