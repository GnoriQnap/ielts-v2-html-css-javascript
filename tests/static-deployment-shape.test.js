import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import test, { before } from "node:test";

import {
  DIST_ROOT,
  PRODUCTION_ASSET_ALLOWLIST,
  REPOSITORY_ROOT
} from "../scripts/build-static-assets.mjs";

const execFileAsync = promisify(execFile);
const BUILD_SCRIPT = path.join(REPOSITORY_ROOT, "scripts/build-static-assets.mjs");
const EXPECTED_FILES = [...PRODUCTION_ASSET_ALLOWLIST].sort();
const EXPECTED_JS_FILES = EXPECTED_FILES.filter((file) => file.endsWith(".js"));

before(async () => {
  await execFileAsync(process.execPath, [BUILD_SCRIPT], { cwd: REPOSITORY_ROOT });
});

test("static asset build succeeds with exactly the approved production allowlist", async () => {
  assert.deepEqual(await listFiles(DIST_ROOT), EXPECTED_FILES);
});

test("repository-only material is absent from generated static assets", async () => {
  for (const relativePath of [
    "tests",
    "docs",
    "supabase",
    "README.md",
    "package.json",
    ".gitignore",
    "wrangler.jsonc",
    "scripts",
    "work",
    "outputs",
    "js/core/vocabulary-details-import-service.js"
  ]) {
    await assert.rejects(access(path.join(DIST_ROOT, relativePath)));
  }
});

test("Wrangler config deploys only dist as assets without a Worker or SPA fallback", async () => {
  const config = JSON.parse(await readFile(
    path.join(REPOSITORY_ROOT, "wrangler.jsonc"),
    "utf8"
  ));

  assert.equal(config.name, "ielts-v2-html-css-javascript");
  assert.equal(config.compatibility_date, "2026-09-28");
  assert.deepEqual(config.assets, { directory: "./dist" });
  assert.equal(Object.hasOwn(config, "main"), false);
  assert.equal(Object.hasOwn(config, "script"), false);
  assert.equal(Object.hasOwn(config.assets, "not_found_handling"), false);
  assert.equal(Object.hasOwn(config.assets, "binding"), false);
  assert.equal(Object.hasOwn(config.assets, "run_worker_first"), false);
});

test("generated HTML local browser resources resolve inside dist", async () => {
  const html = await readFile(path.join(DIST_ROOT, "index.html"), "utf8");
  const references = extractHtmlBrowserReferences(html);

  assert.ok(references.length > 0);
  for (const reference of references) {
    const relativePath = resolveBrowserPath("index.html", reference);
    assert.ok(relativePath, `Expected a local browser reference: ${reference}`);
    await access(path.join(DIST_ROOT, relativePath));
  }
});

test("allowlist exactly matches the recursively reachable local browser module graph", async () => {
  const html = await readFile(path.join(DIST_ROOT, "index.html"), "utf8");
  const entryModules = extractHtmlBrowserReferences(html)
    .map((reference) => resolveBrowserPath("index.html", reference))
    .filter((relativePath) => relativePath?.endsWith(".js"));
  const reachableModules = await collectReachableModules(entryModules);

  assert.deepEqual([...reachableModules].sort(), EXPECTED_JS_FILES);
});

async function collectReachableModules(entryModules) {
  const visited = new Set();

  async function visit(relativePath) {
    if (visited.has(relativePath)) return;
    visited.add(relativePath);
    const source = await readFile(path.join(DIST_ROOT, relativePath), "utf8");
    for (const specifier of extractModuleSpecifiers(source)) {
      if (!isLocalReference(specifier)) continue;
      const dependency = resolveBrowserPath(relativePath, specifier);
      assert.ok(dependency, `Invalid local module specifier ${specifier} from ${relativePath}`);
      await access(path.join(DIST_ROOT, dependency));
      await visit(dependency);
    }
  }

  for (const entryModule of entryModules) await visit(entryModule);
  return visited;
}

function extractHtmlBrowserReferences(html) {
  return [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"[^>]*>/gi)]
    .map((match) => match[1])
    .filter(isLocalReference);
}

function extractModuleSpecifiers(source) {
  const specifiers = [];
  for (const match of source.matchAll(/^\s*import\s+([\s\S]*?);/gm)) {
    const quotedValues = [...match[1].matchAll(/["']([^"']+)["']/g)];
    if (quotedValues.length > 0) specifiers.push(quotedValues.at(-1)[1]);
  }
  for (const match of source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    specifiers.push(match[1]);
  }
  for (const match of source.matchAll(/^\s*export\s+[\s\S]*?\sfrom\s+["']([^"']+)["'];/gm)) {
    specifiers.push(match[1]);
  }
  return [...new Set(specifiers)];
}

function resolveBrowserPath(importerPath, reference) {
  if (!isLocalReference(reference)) return null;
  const cleanReference = reference.replace(/[?#].*$/, "");
  const resolved = cleanReference.startsWith("/")
    ? path.posix.normalize(cleanReference.slice(1))
    : path.posix.normalize(path.posix.join(path.posix.dirname(importerPath), cleanReference));
  if (!resolved || resolved === ".." || resolved.startsWith("../")) return null;
  return resolved.replace(/^\.\//, "");
}

function isLocalReference(reference) {
  return typeof reference === "string" &&
    !reference.startsWith("#") &&
    !/^[a-z][a-z\d+.-]*:/i.test(reference) &&
    !reference.startsWith("//");
}

async function listFiles(directory, relativeDirectory = "") {
  const entries = await readdir(path.join(directory, relativeDirectory), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(directory, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath.split(path.sep).join("/"));
    }
  }
  return files.sort();
}
