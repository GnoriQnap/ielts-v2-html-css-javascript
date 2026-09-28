import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PRODUCTION_ASSET_ALLOWLIST = Object.freeze([
  "index.html",
  "css/base.css",
  "js/app.js",
  "js/config/supabase-config.js",
  "js/data/default-vocabulary.js",
  "js/data/vocabulary-details.js",
  "js/data/vocabulary.js",
  "js/core/auth-confirmation.js",
  "js/core/auth-recovery-startup.js",
  "js/core/auth-service.js",
  "js/core/auth-signup-confirmation-startup.js",
  "js/core/cloud-custom-vocabulary-repository.js",
  "js/core/cloud-learning-state-repository.js",
  "js/core/custom-vocabulary-integration.js",
  "js/core/custom-vocabulary-runtime.js",
  "js/core/custom-vocabulary-snapshot.js",
  "js/core/learning-service.js",
  "js/core/learning-state-runtime.js",
  "js/core/normalization.js",
  "js/core/official-vocabulary-identity.js",
  "js/core/question-engine.js",
  "js/core/review-scheduler.js",
  "js/core/round-service.js",
  "js/core/storage.js",
  "js/core/supabase-client.js",
  "js/core/vocabulary-category-service.js",
  "js/core/vocabulary-details.js",
  "js/core/vocabulary-export-service.js",
  "js/core/vocabulary-import-service.js",
  "js/core/vocabulary-index.js",
  "js/core/vocabulary-repository.js",
  "js/core/vocabulary-validator.js",
  "js/core/vocabulary-word-service.js",
  "js/core/wordbook-service.js",
  "js/ui/auth-dialog.js",
  "js/ui/cloud-learning-setup-dialog.js",
  "js/ui/custom-vocabulary-setup-dialog.js",
  "js/ui/home-dashboard.js",
  "js/ui/learning-surface-interactivity.js",
  "js/ui/main-navigation-state.js",
  "js/ui/vocabulary-card-overlay.js",
  "js/ui/vocabulary-card.js",
  "js/ui/vocabulary-details-view.js"
]);

export const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
export const DIST_ROOT = path.join(REPOSITORY_ROOT, "dist");

export async function buildStaticAssets({
  repositoryRoot = REPOSITORY_ROOT,
  outputRoot = DIST_ROOT
} = {}) {
  const resolvedRepositoryRoot = path.resolve(repositoryRoot);
  const resolvedOutputRoot = path.resolve(outputRoot);
  const expectedFiles = [...PRODUCTION_ASSET_ALLOWLIST].sort();

  if (new Set(expectedFiles).size !== expectedFiles.length) {
    throw new Error("Production asset allowlist contains duplicate paths.");
  }
  if (isWithin(resolvedOutputRoot, resolvedRepositoryRoot)) {
    throw new Error("Static asset output cannot contain the repository source tree.");
  }

  await rm(resolvedOutputRoot, { recursive: true, force: true });

  for (const relativePath of expectedFiles) {
    assertSafeRelativePath(relativePath);
    const sourcePath = path.resolve(resolvedRepositoryRoot, relativePath);
    const destinationPath = path.resolve(resolvedOutputRoot, relativePath);

    if (!isWithin(resolvedRepositoryRoot, sourcePath)) {
      throw new Error(`Allowlisted source escapes the repository: ${relativePath}`);
    }
    if (!isWithin(resolvedOutputRoot, destinationPath)) {
      throw new Error(`Allowlisted destination escapes the output directory: ${relativePath}`);
    }

    let sourceStat;
    try {
      sourceStat = await stat(sourcePath);
    } catch {
      throw new Error(`Missing allowlisted production asset: ${relativePath}`);
    }
    if (!sourceStat.isFile()) {
      throw new Error(`Allowlisted production asset is not a file: ${relativePath}`);
    }

    await mkdir(path.dirname(destinationPath), { recursive: true });
    await copyFile(sourcePath, destinationPath);
  }

  const generatedFiles = await listFiles(resolvedOutputRoot);
  if (!sameStringList(generatedFiles, expectedFiles)) {
    throw new Error("Generated static asset inventory does not match the production allowlist.");
  }

  return Object.freeze({
    outputRoot: resolvedOutputRoot,
    files: Object.freeze(generatedFiles)
  });
}

function assertSafeRelativePath(relativePath) {
  if (typeof relativePath !== "string" || !relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`Invalid production asset path: ${String(relativePath)}`);
  }
  const normalized = path.normalize(relativePath);
  if (normalized !== relativePath || normalized.startsWith(`..${path.sep}`) || normalized === "..") {
    throw new Error(`Unsafe production asset path: ${relativePath}`);
  }
}

function isWithin(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

async function listFiles(directory, relativeDirectory = "") {
  const entries = await readdir(path.join(directory, relativeDirectory), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(directory, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath.split(path.sep).join("/"));
    } else {
      throw new Error(`Unsupported generated asset type: ${relativePath}`);
    }
  }
  return files.sort();
}

function sameStringList(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  buildStaticAssets()
    .then(({ files, outputRoot }) => {
      console.log(`Built ${files.length} static assets in ${path.relative(REPOSITORY_ROOT, outputRoot)}/.`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
