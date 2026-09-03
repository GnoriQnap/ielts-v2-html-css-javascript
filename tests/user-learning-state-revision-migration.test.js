import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/002_user_learning_state_revision.sql",
  import.meta.url
);
const sql = readFileSync(migrationUrl, "utf8");

test("revision migration adds a positive bigint revision with a default of one", () => {
  assert.match(sql, /alter table public\.user_learning_states/i);
  assert.match(sql, /add column revision bigint not null default 1/i);
  assert.match(sql, /check\s*\(revision\s*>=\s*1\)/i);
});

test("revision migration leaves rows, state, RLS, and triggers untouched", () => {
  assert.doesNotMatch(sql, /drop\s+table|create\s+table/i);
  assert.doesNotMatch(sql, /\bupdate\s+public\.user_learning_states/i);
  assert.doesNotMatch(sql, /\bstate\s*=/i);
  assert.doesNotMatch(sql, /policy|row level security/i);
  assert.doesNotMatch(sql, /create\s+(or\s+replace\s+)?function|create\s+trigger/i);
});
