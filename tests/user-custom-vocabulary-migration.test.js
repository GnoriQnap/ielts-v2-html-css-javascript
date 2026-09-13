import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL(
  "../supabase/migrations/003_user_custom_vocabularies.sql",
  import.meta.url
), "utf8");

test("custom vocabulary migration creates the snapshot row with revision constraints", () => {
  assert.match(sql, /create table if not exists public\.user_custom_vocabularies/i);
  assert.match(sql, /user_id uuid primary key[\s\S]*references auth\.users\s*\(id\)[\s\S]*on delete cascade/i);
  assert.match(sql, /vocabulary jsonb not null/i);
  assert.match(sql, /revision bigint not null default 1/i);
  assert.match(sql, /updated_at timestamptz not null default now\(\)/i);
  assert.match(sql, /jsonb_typeof\(vocabulary\)\s*=\s*'object'/i);
  assert.match(sql, /check\s*\(revision\s*>=\s*1\)/i);
});

test("custom vocabulary migration reuses updated_at trigger behavior without revision automation", () => {
  assert.match(sql, /before insert or update on public\.user_custom_vocabularies/i);
  assert.match(sql, /execute function public\.set_user_learning_states_updated_at\(\)/i);
  assert.doesNotMatch(sql, /create\s+(or\s+replace\s+)?function/i);
  assert.doesNotMatch(sql, /new\.revision|revision\s*:=|revision\s*=\s*revision\s*\+/i);
});

test("custom vocabulary RLS grants authenticated ownership without client delete", () => {
  assert.match(sql, /alter table public\.user_custom_vocabularies enable row level security/i);
  assert.match(sql, /for select[\s\S]*to authenticated[\s\S]*using\s*\(\(select auth\.uid\(\)\)\s*=\s*user_id\)/i);
  assert.match(sql, /for insert[\s\S]*to authenticated[\s\S]*with check\s*\(\(select auth\.uid\(\)\)\s*=\s*user_id\)/i);
  assert.match(sql, /for update[\s\S]*to authenticated[\s\S]*using\s*\(\(select auth\.uid\(\)\)\s*=\s*user_id\)[\s\S]*with check\s*\(\(select auth\.uid\(\)\)\s*=\s*user_id\)/i);
  assert.match(sql, /revoke all on table public\.user_custom_vocabularies from public/i);
  assert.match(sql, /revoke all on table public\.user_custom_vocabularies from anon/i);
  assert.match(sql, /revoke all on table public\.user_custom_vocabularies from authenticated/i);
  assert.match(
    sql,
    /revoke all on table public\.user_custom_vocabularies from authenticated[\s\S]*grant select, insert, update on table public\.user_custom_vocabularies to authenticated/i
  );
  assert.match(sql, /revoke delete on table public\.user_custom_vocabularies from authenticated/i);
  assert.doesNotMatch(
    sql,
    /grant\s+(?:all|[^;]*(?:delete|truncate|references|trigger)[^;]*)\s+on table public\.user_custom_vocabularies/i
  );
  assert.doesNotMatch(sql, /create policy[^;]*for delete/is);
  assert.doesNotMatch(sql, /using\s*\(\s*true\s*\)|with check\s*\(\s*true\s*\)/i);
});
