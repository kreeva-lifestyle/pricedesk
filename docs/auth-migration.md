# Supabase Auth Migration Plan

**Goal:** close issue #1 from the May 2026 security audit — the RLS policies on every table currently allow anyone with the anon key to read and write everything. After this migration, every meaningful query goes through an authenticated user and RLS enforces row-level permissions.

**Estimated effort:** 1-2 days of careful work.
**Risk level:** High if rushed. The wrong RLS policy locks the user out of their own data.

This document is meant to be picked up by a future session (or future maintainer) with full context.

---

## Current state (May 2026)

- The client (`index.html`) talks to Supabase using a single hard-coded **anon JWT** baked into the source.
- Every public table has an `allow_all_*` RLS policy, e.g.:
  ```sql
  CREATE POLICY "allow_all_skus" ON pd_skus_v2 FOR ALL USING (true) WITH CHECK (true);
  ```
- Authentication happens in the `login` Edge Function (service-role) but produces no real session token — it just returns a "safe user" object that the client stores in `sessionStorage` under `pricedesk_session`.
- The `validateSessionToken()` function in `index.html` returns `true` unconditionally.

This means anyone who reads the page source gets the anon key and can `curl` the database directly, bypassing the `login` flow entirely.

---

## Target state

- The `login` Edge Function returns a **real Supabase Auth JWT** (or our own signed JWT) that the client stores and uses as the `Authorization` header for every subsequent Supabase call.
- Every public table has RLS policies keyed on `auth.uid()`:
  - `pd_skus_v2`, `pd_brands`, `pd_categories`, `pd_commissions`, `pd_thresholds`, `pd_audit_log`, `pd_sku_history`, `app_data` — `SELECT` requires an authenticated user.
  - Most write operations (`INSERT`/`UPDATE`/`DELETE`) require an authenticated user AND a `role` check (admin vs viewer).
- The anon key keeps minimal capability: it's only used by the `login` and `reset-password` Edge Functions to discover the user's stored hash before issuing a JWT.

---

## Migration strategy

The key constraint: **users must not get locked out of their own data at any step**. The migration runs in stages, each with a safe rollback.

### Stage 0 — Decide the auth model

Two paths exist:

**Path A: Use Supabase Auth (recommended).**
- Pros: built-in, ironclad, integrates with Supabase Realtime, supports MFA later.
- Cons: requires creating real Supabase Auth users (`auth.users` table) for everyone in `pd_users`. The existing custom `users` array (in `app_data.value.pd_users`) needs to be linked by email.

**Path B: Custom JWT signed by the Edge Function.**
- Pros: less moving parts, keeps existing user model.
- Cons: we'd have to implement token rotation, expiry, and signing-key rotation ourselves. RLS policies need a custom JWT verification function. More code to maintain.

**Recommend Path A.** It's what Supabase is designed for.

### Stage 1 — Create Supabase Auth users for everyone in `pd_users`

Write a one-off migration Edge Function that:

1. Reads `app_data` row with `key='pd_users'`.
2. For each user (admin@…, manager@…, etc.):
   - Calls `supabase.auth.admin.createUser({ email, password: <random>, email_confirm: true })` using the service-role key.
   - Sends them a password-reset email via the existing `reset-password` flow so they set a fresh password.
   - Updates the matching row in the `pd_users` array with the new `auth_user_id` returned.
3. Saves the updated `pd_users` back.

**Rollback:** if this fails partway, the `pd_users` blob is still authoritative; no data lost. Just delete the partially-created `auth.users` rows.

### Stage 2 — Update the `login` Edge Function to return a JWT

- The function still verifies the password against the stored hash (same logic as today).
- On success it now also calls `supabase.auth.admin.generateLink({ type: 'magiclink', email })` or `supabase.auth.admin.createUser({...})` to mint a fresh access token, and returns it to the client alongside the `safeUser` object.
- The client stores both in `sessionStorage`.

The custom user object remains the source of truth for `role` and `revoked`. The Supabase Auth user is purely for JWT issuance.

### Stage 3 — Update the client to send the JWT

- Replace every `Authorization: Bearer ${SUPABASE_ANON}` in `index.html` with the user's JWT from `sessionStorage`.
- The Supabase JS client supports this via `supabase.auth.setSession({ access_token, refresh_token })` so all `db.from(...)` calls automatically use the JWT.

**Verification before moving on:** the client still reads/writes everything successfully. The RLS policies are STILL `allow_all_*` at this point, so this stage shouldn't break anything visible — it's just plumbing the JWT through.

### Stage 4 — Tighten RLS, table by table

For each table, write a migration that adds a properly-scoped policy and drops `allow_all_*`. Do this **one table at a time**, with the client and Edge Functions verified between each table.

Suggested order (lowest risk first):

1. **`pd_audit_log`** — already partially locked down. Add `auth.uid() IS NOT NULL` to `SELECT` so only authenticated users can read.
2. **`pd_sku_history`** — same as audit log.
3. **`pd_brands`, `pd_categories`, `pd_thresholds`** — small tables. SELECT requires `auth.uid() IS NOT NULL`; UPDATE/DELETE require admin role (stored in user object, check via JWT claim).
4. **`pd_commissions`** — same.
5. **`pd_skus_v2`** — biggest table. Same pattern.
6. **`app_data`** — last and trickiest. Some keys (`pd_users`, `pd_reset_tokens`, `pd_login_attempts`) should ONLY be readable/writable by the service role. Others (`pd_logistics`, `pd_wireframe`, etc.) can be authenticated-user-only. Add a per-key allowlist via a `CHECK` clause in the policy.

Each migration also needs to update `pd_users` to include a `role` field that's exposed in the JWT (`user_metadata`).

### Stage 5 — Remove the anon-key fallback

- The client currently has fallback code paths (`if(_useServerAuth) ... else { /* client-side auth */ }`). After Stage 4, the client-side path is dead — remove it.
- Update `tests/` to mock JWT setup.
- Update the deploy workflow: the anon key is still in the bundle (Supabase needs it to talk to the `login` function), but it has been demoted to a strictly limited capability.

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Wrong policy locks user out of their own data | Use a Supabase development branch to test each migration before applying to prod. |
| `pd_users` blob and `auth.users` table go out of sync | Make the `login` function the only writer for both, in a single transaction. |
| Realtime subscriptions break because they're using the wrong key | Pass the new JWT to `createClient` and verify `pd_skus_v2` Realtime events still fire. |
| Service-role key gets exposed | It's only in Edge Function secrets — never in the bundle. Verify by `curl`-ing the deployed bundle and grepping for the service key prefix. |
| Existing automated processes (backup workflow, etc.) break | The backup workflow uses the anon key. After Stage 4, it needs the service-role key in GitHub secrets — already exists as `SECRET_KEYS`. |

---

## Concrete first steps for the next session

1. Create a Supabase dev branch (~$0.32/day) via the MCP tool.
2. Apply Stage 1 + Stage 2 to the branch.
3. Manually test login on the branch.
4. Run Stage 4 migrations one at a time on the branch, verifying after each that the client (pointed at the branch) still functions.
5. Once verified, replay the same sequence on production:
   - Stage 1 (create auth users)
   - Stage 2 (update login Edge Function)
   - Stage 3 (deploy new client)
   - Stage 4 migrations one-by-one
   - Stage 5 cleanup
6. Delete the Supabase dev branch when finished.

Total time: estimate 1 focused day if everything goes smoothly, 2 days with realistic debugging.

---

## What's deliberately NOT in scope

- Multi-factor authentication (MFA) — can be added once Supabase Auth is in place.
- Session expiry / refresh tokens — Supabase Auth provides these automatically with the new JWT setup, but the UX (re-prompt on expiry) is a follow-up.
- Migrating away from `app_data` blobs for `pd_users` — leave this as is; the migration above just adds the `auth_user_id` field.
- Replacing `runWFEngine`'s `new Function()` with a real expression parser — that's audit issue #4, separate workstream.

---

_Document written during the May 2026 security session. If you're picking this up, read `CLAUDE.md` first for the current architecture, then the audit notes for the full list of issues._
