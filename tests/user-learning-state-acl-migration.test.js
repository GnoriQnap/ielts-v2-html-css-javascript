import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL(
  "../supabase/migrations/004_user_learning_states_acl.sql",
  import.meta.url
), "utf8");
const normalizedSql = sql
  .replace(/--.*$/gm, "")
  .replace(/\s+/g, " ")
  .trim();

test("Learning ACL migration resets every browser role before granting the required operations", () => {
  assert.match(normalizedSql, /^begin\s*;/i);
  assert.match(normalizedSql, /commit\s*;$/i);
  assert.match(
    normalizedSql,
    /revoke all privileges on table public\.user_learning_states from public\s*;/i
  );
  assert.match(
    normalizedSql,
    /revoke all privileges on table public\.user_learning_states from anon\s*;/i
  );
  assert.match(
    normalizedSql,
    /revoke all privileges on table public\.user_learning_states from authenticated\s*;/i
  );

  const authenticatedRevokeIndex = normalizedSql.search(
    /revoke all privileges on table public\.user_learning_states from authenticated\s*;/i
  );
  const authenticatedGrantIndex = normalizedSql.search(
    /grant select, insert, update on table public\.user_learning_states to authenticated\s*;/i
  );
  assert.notEqual(authenticatedRevokeIndex, -1);
  assert.notEqual(authenticatedGrantIndex, -1);
  assert.ok(authenticatedRevokeIndex < authenticatedGrantIndex);
});

test("Learning ACL migration grants authenticated only SELECT, INSERT, and UPDATE", () => {
  const authenticatedGrants = [...normalizedSql.matchAll(
    /\bgrant\s+([^;]+?)\s+on table\s+public\.user_learning_states\s+to\s+authenticated\s*;/gi
  )];
  assert.equal(authenticatedGrants.length, 1);
  assert.deepEqual(
    authenticatedGrants[0][1]
      .split(",")
      .map((privilege) => privilege.trim().toLowerCase()),
    ["select", "insert", "update"]
  );
  assert.match(
    normalizedSql,
    /revoke delete on table public\.user_learning_states from authenticated\s*;/i
  );
  assert.doesNotMatch(normalizedSql, /\bgrant\s+all(?:\s+privileges)?\b/i);
  assert.doesNotMatch(
    normalizedSql,
    /\bgrant\s+[^;]*(?:delete|truncate|references|trigger|maintain)[^;]*\s+on table\s+public\.user_learning_states/i
  );
});

test("Learning ACL migration targets only table privileges and is data-neutral", () => {
  const qualifiedObjects = [...normalizedSql.matchAll(/\bpublic\.([a-z_][a-z0-9_]*)\b/gi)]
    .map((match) => match[1].toLowerCase());
  assert.ok(qualifiedObjects.length > 0);
  assert.deepEqual(new Set(qualifiedObjects), new Set(["user_learning_states"]));

  assert.doesNotMatch(normalizedSql, /\bcreate\s+table\b|\bdrop\s+table\b|\balter\s+table\b/i);
  assert.doesNotMatch(normalizedSql, /\binsert\s+into\b/i);
  assert.doesNotMatch(normalizedSql, /\bupdate\s+(?:only\s+)?public\.user_learning_states\b/i);
  assert.doesNotMatch(normalizedSql, /\bdelete\s+from\b/i);
  assert.doesNotMatch(normalizedSql, /\bcreate\s+policy\b|\bdrop\s+policy\b/i);
  assert.doesNotMatch(normalizedSql, /\b(?:enable|disable)\s+row\s+level\s+security\b/i);
});
