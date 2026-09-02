import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/001_user_learning_states.sql",
  import.meta.url
);

async function readMigration() {
  return (await readFile(migrationUrl, "utf8"))
    .replace(/--.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

test("learning snapshot table uses auth user identity and one JSON object per user", async () => {
  const sql = await readMigration();

  assert.match(sql, /create table if not exists public\.user_learning_states \(/i);
  assert.match(sql, /user_id uuid primary key references auth\.users \(id\) on delete cascade/i);
  assert.match(sql, /state jsonb not null/i);
  assert.match(sql, /jsonb_typeof\(state\) = 'object'/i);
  assert.match(sql, /updated_at timestamptz not null default now\(\)/i);
});

test("migration enables RLS and authenticated users can only select their own row", async () => {
  const sql = await readMigration();

  assert.match(sql, /alter table public\.user_learning_states enable row level security/i);
  assert.match(
    sql,
    /create policy "Users can read their own learning state"[^;]+for select to authenticated using \(\(select auth\.uid\(\)\) = user_id\)/i
  );
});

test("insert and update policies enforce auth.uid on both old and new rows", async () => {
  const sql = await readMigration();

  assert.match(
    sql,
    /create policy "Users can insert their own learning state"[^;]+for insert to authenticated with check \(\(select auth\.uid\(\)\) = user_id\)/i
  );
  assert.match(
    sql,
    /create policy "Users can update their own learning state"[^;]+for update to authenticated using \(\(select auth\.uid\(\)\) = user_id\) with check \(\(select auth\.uid\(\)\) = user_id\)/i
  );
});

test("anonymous access and client-side delete are explicitly unavailable", async () => {
  const sql = await readMigration();

  assert.match(sql, /revoke all on table public\.user_learning_states from anon/i);
  assert.match(sql, /grant select, insert, update on table public\.user_learning_states to authenticated/i);
  assert.match(sql, /revoke delete on table public\.user_learning_states from authenticated/i);
  assert.doesNotMatch(sql, /create policy[^;]+to anon/i);
  assert.doesNotMatch(sql, /create policy[^;]+for delete/i);
});

test("policies contain no unrestricted true checks or credential-based authorization", async () => {
  const sql = await readMigration();

  assert.doesNotMatch(sql, /using\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(sql, /with check\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(sql, /service_role|sb_secret_|password|access_token|refresh_token/i);
  assert.doesNotMatch(sql, /\bemail\b/i);
});

test("database trigger owns updated_at for every insert and update", async () => {
  const sql = await readMigration();

  assert.match(sql, /create or replace function public\.set_user_learning_states_updated_at\(\)/i);
  assert.match(sql, /security invoker set search_path = ''/i);
  assert.match(
    sql,
    /create trigger set_user_learning_states_updated_at before insert or update on public\.user_learning_states for each row execute function public\.set_user_learning_states_updated_at\(\)/i
  );
});
