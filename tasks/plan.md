# Recuerdea v8 — Switch pCloud auth from session token (`?auth=`) to OAuth2 access token (`?access_token=`)

## Overview

Recuerdea currently authenticates against pCloud with a **session token** taken from the `userinfo` response, sent as `?auth=…` on every API call. The SDK calls in `netlify/functions/refresh-memories.ts:34` and `src/routes/api/memory/$uuid.ts:15` pass `type: 'pcloud'` to opt into that mode.

The user has now provisioned an OAuth2 app in pCloud (client ID + client secret, redirect URI empty). This plan flips both server call sites to OAuth mode (`type: 'oauth'`, the SDK default — sends `?access_token=`) and replaces the value in `PCLOUD_TOKEN` with a real OAuth access token obtained via the authorization-code flow.

**v8 is a pre-requirement for v9 (browser-side pCloud calls).** OAuth is the format `pcloud-kit/oauth-browser` produces, and `?access_token=` is the credential shape the browser SDK uses. v8 picks the credential model that works on both sides; v9 will then design the browser distribution / sign-in flow on top of that foundation. **v8 itself does not introduce browser-side pCloud calls** — that is explicitly out of scope and will need a SPEC update (see "Forward to v9" below).

**Scope for this PR is minimal:** two one-line code changes, an env-var rotation, and a one-time token-provisioning chore. No browser-side change in v8, no architecture change. This is a credential-mode swap that unblocks v9.

Branch: `v8-oauth` (cut from `main`). PR target: `main`.

## Direct answers to the original questions

### Q1. Should I change it server-side and client-side, or just client-side?

**Server-side only — for v8.** Recuerdea has zero browser-side pCloud code today by deliberate design (SPEC §7: "Never sign pCloud URLs from the browser"). The pCloud SDK is invoked in exactly two server files:

- `netlify/functions/refresh-memories.ts:34` — `createClient({ token, type: 'pcloud' })`
- `src/routes/api/memory/$uuid.ts:15` — `createClient({ token, type: 'pcloud' })`

Both literally pass `type: 'pcloud'`, which is pcloud-kit's switch for session-token mode. Drop that property (default is `'oauth'`) and the SDK sends the same token as `?access_token=` instead of `?auth=`. That's the entire v8 code change.

> v9 (deferred): browser-side calls. The OAuth swap in v8 is what makes v9 possible — `pcloud-kit/oauth-browser` produces OAuth tokens; the browser SDK uses `?access_token=`. v8 picks the right format. v9 designs the distribution flow.

### Q2. Do I need to set the redirection URI?

**Yes, for the authorization-code flow you need to register one in pCloud's app settings.** Reasons:

- pcloud-kit's `buildAuthorizeUrl` asserts `redirectUri` is required (`oauth.js:5`).
- pCloud's authorize endpoint verifies the callback URL matches what is registered on the app.

For v8 (server-token provisioning), you only execute this flow **once** locally:

- Pick any URL you can read the `?code=…` query string back from. `http://localhost:8787/oauth/callback` works and avoids needing a public web server.
- Register that exact URL in the pCloud app config.
- After you have the access token, the redirect URI is never used again at runtime.

For v9 (browser per-session token), the redirect URI must be a **real, deployed page** in Recuerdea (e.g. `https://recuerdea.netlify.app/oauth/pcloud-callback`). That's a v9 decision; do not register that one yet — keep v8's localhost callback registered until v9 lands.

## Resolved decisions

| #   | Decision                            | Outcome                                                                                                                                                                                                                                                                                          |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q1  | Server-side or client-side (in v8)? | **Server-side only.** Drop `type: 'pcloud'` in two SDK call sites. Browser-side wiring is v9.                                                                                                                                                                                                    |
| Q2  | Redirect URI?                       | **Register a localhost URL** for v8 (e.g. `http://localhost:8787/oauth/callback`). Used once locally; not at runtime. v9 will register a separate prod callback for the browser flow.                                                                                                            |
| Q3  | OAuth flow choice                   | **Authorization code flow** (`response_type=code` + `getTokenFromCode`). Simplest path with `pcloud-kit/oauth`, runs locally as a one-off Node script. Poll-token flow rejected — more code, no benefit for a single-owner provisioning step.                                                    |
| Q4  | Env var name                        | **Keep `PCLOUD_TOKEN`.** Renaming churns Netlify config + `.env.local` + `env.d.ts` + two source files for no functional gain. The variable's _meaning_ stays "the bearer credential the server sends to pCloud." Document the format change in the PR description.                              |
| Q5  | Provisioning script location        | **`scripts/oauth-provision.mjs`** — outside `src/` so it is not bundled. Plain Node, reads `PCLOUD_CLIENT_ID` + `PCLOUD_APP_SECRET` + `PCLOUD_REDIRECT_URI` from env, prints the token. **User confirmed: keep long-term.** Useful for future server-token rotation.                             |
| Q6  | Pre-existing tests                  | **No changes needed.** Tests in `src/lib/memories/*.test.ts` inject mock pcloud-kit clients; none of them constructs a real client or asserts on `type`. Verified: `grep -n "type: 'pcloud'\|createClient" src/lib/memories/*.test.ts` → 0 matches.                                              |
| Q7  | API server (EU vs US)               | **EU.** User confirmed account is on the EU data center → `locationid === 2` → use `eapi.pcloud.com` (the SDK default). No `apiServer` override needed in either `createClient` call.                                                                                                            |
| Q8  | Token rotation / refresh            | **No refresh-token flow needed.** pCloud OAuth2 access tokens are long-lived (single-token model — `getTokenFromCode` returns no `refresh_token`). If revoked or expired, run `scripts/oauth-provision.mjs` again and update Netlify env. Document this fallback in the PR.                      |
| Q9  | Old session token revocation timing | **After 1 week of stable runs.** Gives a rollback window. Track the deadline in the PR description; revoke via pCloud Console → Sessions / Active tokens.                                                                                                                                        |
| Q10 | Browser-side use (forward-looking)  | **v8 stays server-only.** OAuth is chosen specifically because it survives the v9 browser move. Token-distribution model (single shared token vs server + per-session browser tokens) is a v9 decision; v8 must not lock it in. Recommendation in v8 risks section: lean toward separate tokens. |

## Forward to v9 — browser-side pCloud calls (out of scope here, but constrains v8)

The user's stated direction: after v8 ships, v9 will make pCloud requests from the browser. v8 must not paint v9 into a corner. Captured here so v8 reviewers know what we are protecting.

### What v9 will need

1. **A SPEC §7 update.** The boundary list explicitly forbids:
   - "Sign pCloud URLs from the browser" (Never do)
   - "Embed `fileid` / `code` / `linkid` / token in HTML / JSON / loader cache" (Never do)
   - Sign IP-bound URLs server-side and pass to the browser (Never do)
     v9 must rewrite this list. Specifically: which endpoints are safe to call from the browser, and how the token reaches the browser. Without this rewrite, v9 violates the project's own contract.
2. **A token-distribution model.** Two coherent shapes; v9 must pick:
   - **(A) Same token everywhere.** Server stores it; browser fetches it from a Netlify-Identity-gated route. Simple, but: full account scope reaches JS execution context (XSS surface ⇒ full pCloud compromise); revocation breaks cron and browser together.
   - **(B) Separate tokens.** Server keeps the long-lived `PCLOUD_TOKEN` (cron + `/api/memory/...`). Browser mints its own per-session token via `pcloud-kit/oauth-browser` `initOauthToken` (popup) or `initOauthPollToken`. User signs into pCloud separately from Netlify Identity. **Recommended.** Compromise scope is isolated; matches pcloud-kit's documented browser flow; revoking the browser session never touches the cron.
3. **An endpoint allow-list.** pCloud rejects browser-origin calls on certain endpoints with code 7010 ("Invalid link referer") — `getfilelink`, `getthumblink`, `getvideolink` are known-bad. `userinfo`, `listfolder` (basic), `getpublinkdownload`, `getpubthumb` are likely OK but each must be smoke-tested before relying on it.
4. **Re-evaluation of `/api/memory/<uuid>`.** Today the route exists because the server has to byte-stream pCloud responses (browser couldn't). If v9 enables direct browser fetches against safe pCloud endpoints, parts of that route may become redundant — or stay as a fallback for the unsafe-endpoint set. v9 will decide; v8 keeps it untouched.

### What v8 deliberately does NOT do

- Does **not** rename `PCLOUD_TOKEN`. v9 may want to split into `PCLOUD_SERVER_TOKEN` + a separate browser flow; renaming twice is worse than once.
- Does **not** expose any token to the browser, even via authenticated routes.
- Does **not** add browser-side pCloud SDK code. Adding a `pcloud-kit/oauth-browser` import in v8 would also drag in browser bundle weight before any caller benefits from it.
- Does **not** modify SPEC §7. The "never do" list still applies; v9 owns that update.

### Cheap forward-leaning moves v8 DOES make

- Picks OAuth (not session token). Aligns the server credential format with what pcloud-kit's browser SDK produces, so v9 doesn't have to re-architect the cron.
- Keeps the provisioning script (`scripts/oauth-provision.mjs`) committed, so v9 can reuse it for any server-side token rotation independent of the browser flow.
- Adds a one-time CORS smoke during Task 3 (Phase 1) — fetch `userinfo` from a localhost browser console using the freshly-minted token — to confirm the OAuth token format authenticates a browser-origin request before we declare v8 done. Cheap viability check; saves a v9 surprise.

## Confirmed assumptions

1. The user has the pCloud OAuth app's `client_id` and `client_secret` to hand and can paste them into a local shell. They will not commit either to the repo.
2. The user can run the consent step in a browser they control (i.e. they are the pCloud account owner) — this is a single-owner app.
3. Netlify's Site → Environment variables UI lets us update `PCLOUD_TOKEN` for both Production and Deploy-preview scopes without redeploying through code.
4. Existing folder snapshot + media cache (`folder/v1`, `media/<uuid>`, `fileid-index/<fileid>`) survive the credential swap unchanged. The cache is keyed on `fileid` / `uuid` / `hash`, none of which depend on auth mode.
5. The cron's `getfilelink` / `getfilepublink` / `deletepublink` / `getpublinkdownload` calls all accept OAuth tokens (they are auth-required `auth: true` methods in the SDK's method registry — auth mode is irrelevant, only the value of the auth parameter changes).
6. SDK behaviour is identical between modes: same endpoints, same JSON shapes, same error classes. Only the query-string parameter name differs (`?access_token=…` vs `?auth=…`).
7. **EU data center.** User confirmed `locationid === 2`. SDK default (`eapi.pcloud.com`) is correct; no `apiServer` override needed.
8. **OAuth tokens authenticate browser-origin `userinfo` calls.** Verified via Task 3.5 smoke. (If this fails, we re-think v9 immediately — but v8 still ships, since the cron + route only hit pCloud server-side.)

## Architecture

### Code change (the entire diff for v8)

```diff
 // netlify/functions/refresh-memories.ts
-  const client = createClient({ token, type: 'pcloud' })
+  const client = createClient({ token })
```

```diff
 // src/routes/api/memory/$uuid.ts
-  const client = createClient({ token, type: 'pcloud' })
+  const client = createClient({ token })
```

That is the only v8 source change. Default `type` is `'oauth'` per `pcloud-kit` `CreateClientOptions`. EU server is the SDK default.

### Provisioning script (kept long-term per Q5)

`scripts/oauth-provision.mjs`:

- Read `PCLOUD_CLIENT_ID`, `PCLOUD_APP_SECRET`, `PCLOUD_REDIRECT_URI` from env.
- Print `buildAuthorizeUrl({ clientId, redirectUri, responseType: 'code' })`. User opens it in a browser, signs in, lands on the redirect URI with `?code=…`.
- User pastes the code back into the script (stdin or CLI arg).
- Script calls `getTokenFromCode(code, clientId, appSecret)` and prints `access_token` + `locationid` to stdout.
- User copies the access token into `.env.local` (for local) and Netlify env (for Production / Deploy-preview).

This stays out of the deployed app entirely. It is a developer chore, not runtime code. The script itself doesn't import anything that would pull pCloud-kit into the production bundle.

### Boundaries unchanged in v8

- `PCLOUD_TOKEN` stays server-only (read in `*.server.ts` + the netlify function only). Per SPEC §7.
- The token still never leaves the server: `/api/memory/<uuid>` continues to byte-stream and the public-link `code` continues to live in Blobs.
- Cache invalidation, public-link lifecycle, cron schedule, and auth gate are untouched.

> v9 will revisit these boundaries. v8 leaves them intact.

## Task list

### Phase 1 — Provision the access token (one-off chore)

#### Task 1: Configure the pCloud OAuth app and register a redirect URI

**Description:** Set the redirect URI on the pCloud app to `http://localhost:8787/oauth/callback` (or any localhost URL). pCloud Console setting, not a code change.

**Acceptance criteria:**

- [ ] pCloud app shows a redirect URI registered, exactly matching what the script will use.
- [ ] `PCLOUD_CLIENT_ID`, `PCLOUD_APP_SECRET`, and `PCLOUD_REDIRECT_URI` are exported in the user's local shell (or in a non-committed `.env.oauth` file). None of them is committed.

**Verification:**

- [ ] Visiting `https://my.pcloud.com/oauth2/authorize?client_id=<id>&redirect_uri=<encoded>&response_type=code` shows the consent screen for the right account (no "invalid redirect_uri" error).

**Dependencies:** None.

**Files likely touched:** none (pCloud Console + local shell).

**Estimated scope:** XS.

---

#### Task 2: Add `scripts/oauth-provision.mjs` to mint the access token

**Description:** Tiny Node script wrapping `pcloud-kit/oauth`. (a) Prints the authorize URL, (b) reads the `code` from stdin, (c) calls `getTokenFromCode`, (d) prints `access_token` + `locationid`. No new deps. Committed long-term per Q5 — useful for future server-token rotation.

**Acceptance criteria:**

- [ ] `scripts/oauth-provision.mjs` exists and is executable (`node scripts/oauth-provision.mjs`).
- [ ] Reads `PCLOUD_CLIENT_ID`, `PCLOUD_APP_SECRET`, `PCLOUD_REDIRECT_URI` from `process.env`. Errors clearly if any is missing.
- [ ] Prints the authorize URL and the input prompt on stderr (keeps stdout clean for redirection).
- [ ] Reads the code from stdin (one line, trimmed). Accepts either a bare code or the full callback URL.
- [ ] Prints the access token and `locationid` to stdout, nothing else (`access_token=...\nlocationid=...\n`).
- [ ] Does not write the token to any file; the user copies it manually.
- [ ] Does not log secrets to anywhere other than stdout (no `console.error`-with-secret on failure).

**Verification:**

- [ ] `node scripts/oauth-provision.mjs` with valid env + a fresh code prints a non-empty access token and a `locationid`.
- [ ] Running it without `PCLOUD_CLIENT_ID` exits non-zero with a clear message.
- [ ] `grep -E "console\.(log|error)" scripts/oauth-provision.mjs` shows the script only emits secrets via stdout, never error or log channels that could trip CI capture.

**Dependencies:** Task 1.

**Files likely touched:**

- `scripts/oauth-provision.mjs` (new).

**Estimated scope:** XS.

---

#### Task 3: Mint the access token and confirm it works server-side

**Description:** Run the script end-to-end. Save the access token in `.env.local` (replacing the current `PCLOUD_TOKEN` value).

**Acceptance criteria:**

- [ ] `.env.local` `PCLOUD_TOKEN` value is now an OAuth access token (different shape from the old session token).
- [ ] Script's reported `locationid` is `2` (EU). If it returns `1` (US), pause and revisit Q7 — assumption was EU.
- [ ] The previous session token is **not** archived in any committed file.

**Verification:**

- [ ] `curl -fsS "https://eapi.pcloud.com/userinfo?access_token=$PCLOUD_TOKEN" | jq -e '.result == 0'` returns success — token authenticates server-side.
- [ ] Same `curl` with the **old** session-token value returns a non-zero `result` (sanity: confirms you actually swapped).

**Dependencies:** Task 2.

**Files likely touched:** `.env.local` (uncommitted).

**Estimated scope:** XS.

---

#### Task 3.5: Browser-CORS smoke (v9 viability check)

**Description:** One-time browser-origin sanity check. From any HTTPS page's DevTools console (or a `localhost:5173` dev page), `fetch` `userinfo` with the new OAuth token. Confirms the credential format authenticates a browser-origin request — without this, v9 is dead on arrival under option (A) AND option (B) of the token-distribution model.

**Acceptance criteria:**

- [ ] `fetch('https://eapi.pcloud.com/userinfo?access_token=<TOKEN>').then(r => r.json())` from a browser console returns `{ result: 0, ... }` with the expected account `email`.
- [ ] No CORS error in the browser console (`Access-Control-Allow-Origin` is set on the response, or the request is treated as simple/CORS-safelisted).

**Verification:**

- [ ] DevTools → Network: the `userinfo` request shows status 200 and JSON body.
- [ ] Result captured in the PR description for v9 reference. (One-line note is enough; we are not gating v8 on v9 viability.)

**Notes:**

- If this fails (CORS blocked), v8 still ships — the server uses node-side `fetch`, which doesn't care about CORS. But it changes v9's design space materially. Document the failure in the PR and open a v9 question.
- This is a smoke, not a comprehensive endpoint sweep. v9 will systematically test the endpoints it actually needs.

**Dependencies:** Task 3.

**Files likely touched:** none.

**Estimated scope:** XS.

---

### Checkpoint A — Token works against pCloud (server + browser smoke)

- [ ] `userinfo` over OAuth (server-side `curl`) returns the expected account.
- [ ] `userinfo` over OAuth (browser-side `fetch`) returns the expected account, no CORS error.
- [ ] `locationid` recorded as `2` in PR notes.

---

### Phase 2 — Code change

#### Task 4: Drop `type: 'pcloud'` in both `createClient` calls

**Description:** Two-line edit: remove the `type: 'pcloud'` property from both `createClient` calls so the SDK uses its OAuth + EU default.

**Acceptance criteria:**

- [ ] `netlify/functions/refresh-memories.ts:34` calls `createClient({ token })`.
- [ ] `src/routes/api/memory/$uuid.ts:15` calls `createClient({ token })`.
- [ ] No other source file references `type: 'pcloud'` (`grep -rn "type: 'pcloud'" src netlify` → 0 matches).
- [ ] `env.d.ts` `PCLOUD_TOKEN` typing is unchanged (still `string`).
- [ ] No `apiServer` override is added (EU is the SDK default; user confirmed `locationid === 2`).

**Verification:**

- [ ] `pnpm type-check` — passes.
- [ ] `pnpm lint` — passes.
- [ ] `pnpm test` — passes. (Tests inject mock clients; no test asserts on `type`. Pre-verified.)
- [ ] `pnpm build`, then delete `dist/` + `.netlify/` cache (per SPEC §7 boundary).
- [ ] Local smoke (`pnpm dev`):
  - [ ] Visit `/`, log in via Identity, see a memory row render. Network panel: `/api/memory/<uuid>?variant=thumb` returns 200 with image bytes.
  - [ ] Click a video: `?variant=stream` returns 206 with playable bytes.
  - [ ] Click download: `?variant=download` returns 200 with `Content-Disposition: attachment`.

**Dependencies:** Task 3.

**Files likely touched:**

- `netlify/functions/refresh-memories.ts`
- `src/routes/api/memory/$uuid.ts`

**Estimated scope:** XS (≈ 2 lines diff).

---

### Checkpoint B — Local works end-to-end

- [ ] Home route renders memories from cache as before.
- [ ] No console errors / no `PcloudApiError` from any of the three variant paths.
- [ ] `git diff main` shows ONLY the two `createClient` lines + the new `scripts/oauth-provision.mjs`. No incidental edits.

---

### Phase 3 — Deploy + cron under OAuth

#### Task 5: Update Netlify env vars (Deploy-preview + Production)

**Description:** Replace `PCLOUD_TOKEN` in **both** Netlify env scopes with the new OAuth access token. Do this _before_ pushing the branch so the deploy preview picks up the new value.

**Acceptance criteria:**

- [ ] Netlify Site → Environment variables → `PCLOUD_TOKEN` updated for **Deploy-preview** context to the OAuth access token.
- [ ] Same for **Production** context.
- [ ] All other env vars (`PCLOUD_MEMORIES_FOLDER_ID`, `GEOAPIFY_API_KEY`, `RECUERDEA_GEOCODE_MAX_PER_RUN` if set) untouched.

**Verification:**

- [ ] Netlify env panel shows two distinct scopes set, last-modified timestamp is fresh.
- [ ] No copy-paste error: the value length matches what the script printed (eyeball test).

**Dependencies:** Task 3.

**Files likely touched:** none (Netlify dashboard only).

**Estimated scope:** XS.

---

#### Task 6: Push `v8-oauth` branch, smoke the deploy preview, manually trigger the cron once

**Description:** Open a PR from `v8-oauth` to `main`. Netlify spins a deploy preview using the new env. Trigger the scheduled function once via the dashboard so the cron exercises OAuth against `listfolder` / `getfilepublink` / `getfilelink`. Verify the cron summary log looks normal.

**Acceptance criteria:**

- [ ] PR open from `v8-oauth` → `main`.
- [ ] Manual cron invocation via Netlify Functions panel completes with `statusCode: 200`.
- [ ] Cron summary log shows `scanned=N alive=N removed=…` — i.e. `listfolder` succeeded and `processFile` got through every file.
- [ ] No `PcloudApiError result=2000` ("invalid token") or `result=1000` ("log in required") in the function logs.
- [ ] Deploy preview `/` renders memories under the new token.
- [ ] `curl -I https://<preview>.netlify.app/` still returns `Cache-Control: private` (per SPEC §7 — sanity check, no expected change).

**Verification:**

- [ ] All four boundary checks above.
- [ ] `/api/memory/<uuid>?variant=thumb` returns 200 on the preview (logged in).
- [ ] `/api/memory/<uuid>?variant=stream` returns 206 on the preview (logged in, `Range` header set).
- [ ] `/api/memory/<uuid>?variant=download` returns 200 with attachment disposition.

**Dependencies:** Tasks 4, 5.

**Files likely touched:** none (process step).

**Estimated scope:** XS.

---

#### Task 7: Merge + production cutover

**Description:** Merge to `main` → Netlify deploys production. Trigger the production cron once via the dashboard and smoke the production home page.

**Acceptance criteria:**

- [ ] CI green (`type-check`, `test`, `lint`, `format-check`).
- [ ] `main` deploy succeeds.
- [ ] Manual cron run on production logs `statusCode: 200` and a normal summary line.
- [ ] Production `/` renders memories under the OAuth token.

**Verification:**

- [ ] Repeat the three-variant URL check from Task 6 against production.
- [ ] Set a calendar reminder for 1 week from merge to revoke the old session token (Task 8).

**Dependencies:** Task 6.

**Files likely touched:** none (process step).

**Estimated scope:** XS.

---

#### Task 8: Revoke the old session token (≥ 1 week after Task 7)

**Description:** After 1 week of stable cron runs and home-page hits under the OAuth token, revoke the previous session token via pCloud Console → Sessions / Active tokens.

**Acceptance criteria:**

- [ ] At least 7 days have passed since Task 7.
- [ ] Cron has run successfully on at least 5 of those days (Netlify Functions log).
- [ ] No `result=2000` / `result=1000` errors in the function logs in that window.
- [ ] Old session token is revoked in pCloud Console.

**Verification:**

- [ ] Re-running `curl -fsS "https://eapi.pcloud.com/userinfo?auth=<old-session-token>"` returns a non-zero `result`, confirming the old token is dead.
- [ ] OAuth `PCLOUD_TOKEN` (now the only credential) continues to work.

**Dependencies:** Task 7 + a 7-day soak.

**Files likely touched:** none (pCloud Console).

**Estimated scope:** XS.

---

## Risks and mitigations

| Risk                                                                                                                                  | Impact       | Mitigation                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forgetting to update Netlify env before pushing → deploy preview hits pCloud with a stale session token AND new code (mode mismatch). | Med          | Task 5 runs **before** Task 6's push. If the order slips, the cron + route logs `result=2000` immediately; revert by re-pasting the previous session token into Netlify env and re-running the cron.                                |
| Provisioning script accidentally checks the secret into git.                                                                          | High         | `.env.local` is already in `.gitignore`; new env vars (`PCLOUD_CLIENT_ID`, `PCLOUD_APP_SECRET`) are exported in the shell only. The script reads from `process.env` and never writes a file. Verify with `git status` after Task 2. |
| Token rotation causes a cron run to fail mid-rollout.                                                                                 | Low          | Cron is idempotent and runs daily. A single failed run leaves the cache untouched (the cron is the sole writer; missing snapshot ⇒ home renders empty + warn). Just re-run after env is fixed. No data loss possible.               |
| Browser-CORS smoke (Task 3.5) fails — pCloud doesn't allow browser-origin `userinfo` calls.                                           | Med          | v8 still ships (server-side fetches don't go through CORS). v9's design space narrows to "server proxies the call" — i.e. token still never leaves the server. Document in PR; defer architecture rewrite to v9.                    |
| **v9 reuses `PCLOUD_TOKEN` naively and ships it to the browser.** Same token compromised via XSS = full pCloud account takeover.      | High (in v9) | Plan v9 around **separate tokens** (option B in "Forward to v9"): server keeps `PCLOUD_TOKEN`; browser mints its own per-session token via `pcloud-kit/oauth-browser`. Block v9's PR if it bundles the cron token into HTML.        |
| `Authorization` header behaviour differs between modes and breaks something subtle.                                                   | Low          | pcloud-kit puts both `auth=` and `access_token=` in the **query string**, not the `Authorization` header. The HTTP shape across the wire is identical except for that one parameter name. Low surprise risk.                        |
| OAuth access token is shorter-lived than the user expects and silently expires mid-quarter.                                           | Low          | pCloud access tokens are long-lived (no refresh token issued); revocation is the only invalidation vector. Mitigation: re-running `scripts/oauth-provision.mjs` regenerates a fresh token in <1 minute.                             |

## Open questions

**v8 has none open** — all decisions resolved, see "Resolved decisions" table.

### Open questions for v9 (deferred — DO NOT resolve in v8)

1. **Token-distribution model** — same OAuth token reused on the browser (option A) or separate per-session browser token (option B)? Recommendation: B. Needs a security review before the v9 PR opens.
2. **Browser endpoint allow-list** — which pCloud endpoints will v9 actually call from the browser, and does each return successfully under CORS? Smoke each one before committing to a design.
3. **SPEC §7 update** — v9 must rewrite the "never do" entries that currently forbid browser-side pCloud activity. Identify the exact wording change in the v9 plan-mode review, before any code lands.
4. **`/api/memory/<uuid>` future** — keep as fallback, deprecate, or expand? Depends on how many endpoints v9 can call directly from the browser.
5. **Per-session browser token UX** — if option B: where does the user click "Sign in to pCloud"? Is it a separate button next to the Identity login, or chained automatically after Identity login? Affects login.tsx layout.
6. **Browser pCloud sign-in callback URL** — needs a real deployed page (not localhost). Decide on the path (e.g. `/oauth/pcloud-callback`) and register it on the pCloud app alongside the existing localhost URL.
