# Production Operations Contract

## A. Purpose and scope

This document is the production operational contract for the current IELTS synonym practice application. It records the behavior enforced by the repository and separates that behavior from configuration and procedures owned by the Supabase Dashboard, deployment environment, and production operator.

Documenting a checklist item does not mean it has been completed. Evidence for every deployment-owned item must be recorded before a public production release. This contract does not add account deletion, administration, backups, monitoring, analytics, billing, or deployment infrastructure to the application.

## B. Persistent data inventory

### Application-owned device data

| Location | Owner and purpose | Logout behavior | Cleanup/deletion | Data classification |
|---|---|---|---|---|
| `ielts_synonym_trainer_state` | Application-owned Guest Learning state: learning records, Practice state, active question, review queue, rounds, and save timestamp | Preserved; restored only after a real Guest Auth transition | Replaced by later Guest saves. No account action deletes it; removing browser site data is a separate device action | User learning content; no Auth secret |
| `ielts_synonym_trainer_vocabulary` | Application-owned full Guest vocabulary cache, including device-local custom vocabulary and details | Preserved; Account vocabulary is activated in memory and does not overwrite this cache | Updated by Guest vocabulary operations, imports, and compatible cache maintenance. No account action deletes it | User vocabulary content; no Auth secret |
| `ielts_synonym_trainer_custom_vocabulary_identity` | Stable UUID mapping used to preserve Guest custom-category identity when creating a migration snapshot | Preserved across login/logout | Created, normalized, or cleaned as the Guest migration boundary is read. Removing browser site data is a separate device action | Local category identity metadata; not an account identifier or Auth secret |
| `ielts_pending_signup_email` | Pending signup email used for confirmation/resend and login prefill | May survive an ordinary logout | Cleared after successful signup-confirmation completion; may be replaced by a later pending signup | Email identity/PII only; no password or token |

The application does not use app-owned `sessionStorage`, IndexedDB, or cookies.

### Supabase-managed browser session data

Supabase Auth manages a key with the form `sb-<project-ref>-auth-token`. It contains Auth session material and normally survives reload until the SDK signs out or otherwise expires the session. Application code checks only whether this key exists when deciding whether initial ownership must be held; it does not read, copy, log, or persist the token contents itself.

### Cloud data

| Location | Owner and purpose | Logout behavior | Cleanup/deletion | Data classification |
|---|---|---|---|---|
| `auth.users` | Supabase Auth account identity and credential/session metadata | Account remains registered after logout | Managed by Supabase Auth and authorized administrators | Account identity and Auth-sensitive data |
| `public.user_learning_states` | One Learning snapshot, revision, and update timestamp per Auth user | Preserved in Cloud | Browser has no DELETE capability. Authorized deletion of the referenced Auth user cascades this row | Account Learning content |
| `public.user_custom_vocabularies` | One canonical custom-only vocabulary snapshot, revision, and update timestamp per Auth user | Preserved in Cloud | Browser has no DELETE capability. Authorized deletion of the referenced Auth user cascades this row | Account Custom Vocabulary content |

No other application Cloud table or Supabase Storage location is used by the current repository.

## C. Guest and Account ownership lifecycle

Ownership initialization must retain this order:

```text
Auth identity
→ Custom Vocabulary ownership
→ Official + Custom composition
→ vocabulary index
→ Learning ownership
→ normalization/render
```

- Guest Learning and Guest Custom Vocabulary remain device-local.
- Login does not delete or overwrite either Guest snapshot.
- When an Account Cloud row exists, that row wins for the corresponding Account ownership domain. Guest data is not merged into an existing Account row automatically.
- A missing Account row plus meaningful Guest data enters pending migration and requires an explicit Save Guest or Start Fresh/Start Empty decision.
- An empty Guest boundary may initialize a fresh empty Account row automatically under the existing runtime contract.
- Save Guest creates an Account row from the preserved private Guest migration source. Start Fresh/Start Empty creates the Account default. Neither action deletes the Guest snapshot.
- Logout restores Guest vocabulary and Guest Learning only after Auth publishes a real Guest/signed-out state.
- An authenticated Cloud load, setup, save, or conflict failure never redirects persistence to Guest storage.
- Account switching and late asynchronous results are guarded by operation generation and expected user identity. Results for an old user cannot activate or write the new user's state.

## D. Cloud table contract

Both `public.user_learning_states` and `public.user_custom_vocabularies` use `user_id` as their primary/ownership key. It references `auth.users(id)` with `ON DELETE CASCADE`. Each table has a positive `revision` used for optimistic concurrency control (OCC), plus an `updated_at` timestamp maintained by the database trigger.

Row Level Security is enabled. Authenticated policies permit a user to SELECT, INSERT, and UPDATE only the row where `auth.uid() = user_id`. No DELETE policy exists.

The browser contract is:

- allowed: SELECT, INSERT, UPDATE;
- forbidden: DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN, and broad ALL privileges;
- no caller-provided identity may redirect an operation to another user;
- no browser repository uses DELETE or upsert.

Required production ACL matrix:

| Role | SELECT | INSERT | UPDATE | DELETE | TRUNCATE | REFERENCES | TRIGGER | MAINTAIN |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| PUBLIC | No | No | No | No | No | No | No | No |
| anon | No | No | No | No | No | No | No | No |
| authenticated | Yes | Yes | Yes | No | No | No | No | No |

This matrix is a required deployment contract and must be verified against the deployed project; the migration files alone are not proof of remote state.

OCC updates match both `user_id` and the expected revision, then increment revision exactly once. A zero-row update is diagnosed by reloading the current row:

- different revision: conflict; no overwrite, and the user must explicitly reload remote state;
- missing row: return to the approved pending-migration/setup state;
- different current identity: stale/identity-changed result with no redirected write;
- transport or unexpected failure: structured save failure, with no Guest fallback.

On an initial missing row, meaningful Guest data requires the migration decision described above. An empty Guest boundary may create the Account default. Load failures remain blocked/unavailable and never expose Guest state as Account state.

## E. Migration application matrix

| Migration | Purpose | Type | Ordering and re-run contract |
|---|---|---|---|
| `001_user_learning_states.sql` | Creates the Learning table, Auth FK/cascade, update timestamp function and trigger, RLS policies, and initial ACL | Schema and security | Must precede 002. It also creates the timestamp function reused by 003. Largely repeatable against the expected schema, but `CREATE TABLE IF NOT EXISTS` is not a general schema-reconciliation mechanism |
| `002_user_learning_state_revision.sql` | Adds the Learning revision column, default, and positive constraint | Schema; existing rows receive the revision default | Requires 001. Not idempotent: it must be applied once and must not be blindly rerun |
| `003_user_custom_vocabularies.sql` | Creates the Custom Vocabulary table, revision, Auth FK/cascade, trigger, RLS policies, and least-privilege ACL | Schema and security | Requires the timestamp function from 001. Largely repeatable against the expected schema, with the same `IF NOT EXISTS` caveat |
| `004_user_learning_states_acl.sql` | Resets Learning table privileges and grants SELECT, INSERT, and UPDATE only | Privilege-only | Requires the Learning table. Transactional and idempotent for the stated ACL reset |

Existing project evidence records that migration 004 was manually applied and remotely verified during Stage 10.9C. Current Cloud operation demonstrates that the schema capabilities required by 001–003 exist. The repository does not contain authoritative remote migration-history evidence; the production deployment record must independently record and verify the applied migration state.

## F. Production Auth configuration

### Repository-enforced behavior

- The browser loads the fully pinned Supabase JavaScript dependency.
- Browser configuration accepts a publishable key and rejects secret/service-role key formats.
- Signup confirmation and password-recovery redirect helpers derive their origin and path from the current page.
- Password-recovery authorization requires Supabase SDK runtime evidence; URL text alone cannot authorize a password update.
- Recovery and confirmation completion require explicit safe signout under their existing contracts.
- Callback token/code material is not copied to app-owned storage and is removed from the visible URL after classification establishes the appropriate UI state.

### Dashboard and deployment checklist

The production operator must verify and record:

- the production Site URL;
- exact production Redirect URLs matching the deployed origin/path;
- whether localhost Redirect URLs remain allowed for development;
- the intended email-confirmation setting;
- the signup-confirmation template;
- the password-recovery template;
- preservation of the request-specific `RedirectTo` in both templates;
- custom SMTP configuration;
- the production sender address and sending domain;
- SPF, DKIM, DMARC, or equivalent deliverability configuration as applicable;
- Auth email/request rate limits;
- one publishable browser key only;
- absence of secret/service-role keys from browser code, repository files, and public deployment output.

Supabase's default/testing email delivery is not the intended public production delivery configuration. Custom SMTP and delivery smoke tests are required before release.

## G. Environment and configuration contract

The application currently targets a designated Supabase project through `js/config/supabase-config.js`. Its project URL and publishable browser key are public browser configuration; RLS and table ACLs are the data-security boundary. A secret or service-role key must never be placed in this file.

Auth callback URLs derive from the current browser origin and pathname rather than from hard-coded localhost. Production deployment must verify that:

- browser configuration points to the intended production Supabase project;
- the deployed origin/path matches the Supabase Site URL and Redirect URL configuration;
- development and preview origins are allowed only when operationally intended.

Automated multi-environment configuration, build-time substitution, and deployment infrastructure are outside Stage 10.9F.

## H. Account and data deletion

Current application truth:

- there is no self-service account-deletion UI;
- the browser cannot DELETE either Cloud row;
- neither Cloud repository exposes a DELETE method;
- the repository contains no administrator account-deletion workflow;
- an authorized administrative deletion of the Supabase Auth user cascades both application rows through their `ON DELETE CASCADE` foreign keys;
- remote Account deletion does not delete unrelated Guest data stored locally on a device;
- removing local Guest/site data is a separate browser/device operation.

Before public production, the operator must define and record:

- who is authorized to process account-deletion requests;
- how requester identity is verified;
- how the Auth user is deleted through an authorized administrative channel;
- how cascade deletion of both application rows is verified;
- the applicable retention and legal policy;
- instructions for users who also want device-local Guest/site data removed.

This document does not implement account deletion.

## I. Failure and recovery contract

- Learning load failure: authenticated ownership enters blocked/unavailable; Learning interaction and persistence remain fail-closed.
- Custom Vocabulary load failure: Account Custom ownership is unavailable, no Guest Custom state is exposed as Account state, and Learning initialization does not proceed.
- Save transport failure: no Guest fallback occurs. The unsaved Account mutation may remain only in memory and can be lost if the page reloads or closes before a successful later save.
- OCC conflict: no overwrite occurs. The user must explicitly reload the remote state; there is no automatic merge.
- Auth unavailable: the application performs no unsafe Cloud write and exposes a stable unavailable state for Account operations.
- Recovery request and confirmation resend failure: stable, retryable UI without raw server messages or account-enumeration disclosure.
- Rate limiting: explicit stable rate-limited result; the user must wait before retrying.
- Recovery or signup-confirmation signout failure: the owning Auth lifecycle remains blocking and does not release Account or Guest ownership incorrectly.

There is currently no offline outbox. Operators and support guidance must not promise offline Account mutation durability.

## J. Backup and restore

The application JSON vocabulary import/export capability is not a full Cloud backup. It does not back up Account Learning, database revisions/timestamps, Auth identity/session state, migration state, policies, ACLs, or Supabase project configuration.

The application contains no Cloud backup/restore subsystem. Backup and disaster recovery are Supabase deployment responsibilities. The production operator must record:

- Supabase plan/tier;
- available backup retention;
- the PITR decision, if applicable;
- logical export and off-site backup policy, if applicable;
- who has restore authority;
- the restore procedure and expected downtime/communications;
- the date and result of the last restore test;
- post-restore verification of schema, migration state, Auth operation, RLS policies, and the complete ACL matrix.

No backup configuration is assumed complete until verified in the deployed project.

## K. Pre-production acceptance checklist

### Repository

- [ ] `node --test` passes.
- [ ] `git diff --check` passes.
- [ ] The tracked working tree is clean at the release commit.
- [ ] The exact approved Supabase JavaScript version remains fully pinned.
- [ ] No secret/service-role credential is present in browser code, repository files, or deployment output.
- [ ] Migration and ACL contract tests pass.
- [ ] This operations contract has been reviewed against the release commit.

### Supabase Dashboard and deployment

- [ ] Production Site URL is correct.
- [ ] Exact production Redirect URLs are allowed.
- [ ] The localhost redirect decision is recorded.
- [ ] Email confirmation is configured as intended.
- [ ] Signup-confirmation and recovery templates are verified.
- [ ] Both templates preserve request-specific `RedirectTo` behavior.
- [ ] Custom SMTP is configured.
- [ ] Production sender/domain and deliverability records are verified.
- [ ] Auth rate limits are reviewed.
- [ ] Migrations 001–004 are recorded as applied in order.
- [ ] RLS is enabled on both application tables.
- [ ] SELECT, INSERT, and UPDATE policies enforce `auth.uid() = user_id`.
- [ ] The deployed ACL matches the matrix in section D.
- [ ] Browser configuration points to the intended Supabase project URL.
- [ ] Backup retention and restore procedure are recorded.
- [ ] Account-deletion request and cascade-verification procedures are recorded.
- [ ] Supabase administrator accounts are protected appropriately.

### Minimal production browser E2E

- [ ] Guest startup works.
- [ ] Guest state survives a normal reload.
- [ ] An existing Account can log in.
- [ ] Account Custom Vocabulary loads.
- [ ] Account Learning loads.
- [ ] One intentional Learning Cloud mutation saves and survives reload.
- [ ] One intentional Custom Vocabulary Cloud mutation saves and survives reload.
- [ ] Logout restores the preserved Guest state.
- [ ] No unexpected application or module-loading console error occurs.
- [ ] After production SMTP/redirect configuration, one disposable signup-confirmation email flow passes.
- [ ] After production SMTP/redirect configuration, one disposable password-recovery email flow passes.

The complete Stage 10.9D email/recovery matrix does not need to be repeated unless production configuration or application behavior changes.

## L. Production readiness status

**Status: HOLD for public production release.**

The repository/application implementation has no known Stage 10.9F P0 code defect. Documentation alone does not complete the deployment-owned work. Public production release remains on hold until evidence is recorded for at least:

- production Site URL and Redirect URL verification;
- custom SMTP configuration and delivery smoke tests;
- backup/restore responsibility and retention;
- migrations 001–004 plus deployed RLS/policy/ACL state;
- the account-deletion operational procedure.