import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("graded practice actions use equal solid decisions and a full secondary details button", async () => {
  const [html, css] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../css/base.css", import.meta.url), "utf8")
  ]);

  assert.match(html, /id="mark-review" class="button button-danger-solid"/);
  assert.match(html, /id="mark-remembered" class="button button-primary"/);
  assert.match(
    html,
    /id="view-question-details" class="word-detail-trigger button button-outline button-compact button-full"/
  );
  assert.match(css, /\.decision-actions \.button\s*\{[\s\S]*flex:\s*1 1 0;[\s\S]*box-shadow:/);
  assert.match(css, /\.button-danger-solid\s*\{[\s\S]*var\(--color-danger\)[\s\S]*color:\s*var\(--color-surface\);/);
  assert.match(css, /\.question-details-row\s*\{[\s\S]*width:\s*min\(100%, 388px\)/);
  assert.match(css, /\.question-details-row \.word-detail-trigger\s*\{[\s\S]*min-height:\s*42px;/);
});
