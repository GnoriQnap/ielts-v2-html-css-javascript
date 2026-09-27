import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createSupabaseClientProvider,
  hasPersistedSupabaseSession,
  SUPABASE_BROWSER_OPTIONS,
  SUPABASE_ESM_URL,
  validateSupabaseBrowserConfig
} from "../js/core/supabase-client.js";

const VALID_URL = "https://project-ref.supabase.co";
const VALID_KEY = "sb_publishable_browser_test_key";

test("Supabase browser ESM dependency is fully pinned to the approved patch version", () => {
  assert.equal(
    SUPABASE_ESM_URL,
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm"
  );
  assert.match(
    SUPABASE_ESM_URL,
    /^https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@\d+\.\d+\.\d+\/\+esm$/
  );
  assert.doesNotMatch(SUPABASE_ESM_URL, /@2\/\+esm|@latest\/|@[~^*]|@[0-9]+\.x(?:\.x)?\//);
});

test("Supabase-related browser module graph uses the Stage 10.9E cache identity", async () => {
  const [html, app, authService, learningRepository, customRepository] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../js/app.js", import.meta.url), "utf8"),
    readFile(new URL("../js/core/auth-service.js", import.meta.url), "utf8"),
    readFile(new URL("../js/core/cloud-learning-state-repository.js", import.meta.url), "utf8"),
    readFile(new URL("../js/core/cloud-custom-vocabulary-repository.js", import.meta.url), "utf8")
  ]);
  const version = "10.9e2";

  assert.match(html, new RegExp(`src="\\./js/app\\.js\\?v=${version}"`));
  for (const modulePath of [
    "./core/auth-service.js",
    "./core/supabase-client.js",
    "./core/cloud-learning-state-repository.js",
    "./core/cloud-custom-vocabulary-repository.js"
  ]) {
    const escapedPath = modulePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(app, new RegExp(`${escapedPath}\\?v=${version}`));
  }
  for (const importer of [authService, learningRepository, customRepository]) {
    assert.match(importer, new RegExp(`\\./supabase-client\\.js\\?v=${version}`));
  }

  const relevantGraph = [app, authService, learningRepository, customRepository].join("\n");
  assert.doesNotMatch(relevantGraph, /supabase-client\.js\?v=(?:10\.1|10\.7c)/);
});

test("startup can distinguish a definite Guest from a persisted Supabase session without reading its contents", () => {
  const requestedKeys = [];
  const storage = {
    getItem(key) {
      requestedKeys.push(key);
      return key === "sb-project-ref-auth-token" ? "opaque-session" : null;
    }
  };

  assert.equal(hasPersistedSupabaseSession({ url: VALID_URL, storage }), true);
  assert.deepEqual(requestedKeys, ["sb-project-ref-auth-token"]);
  assert.equal(hasPersistedSupabaseSession({
    url: VALID_URL,
    storage: { getItem: () => null }
  }), false);
  assert.equal(hasPersistedSupabaseSession({ url: "not a url", storage }), false);
});

test("correct browser configuration creates one shared client", async () => {
  const calls = [];
  const expectedClient = createFakeClient();
  const provider = createSupabaseClientProvider({
    url: VALID_URL,
    publishableKey: VALID_KEY,
    loadLibrary: async () => ({
      createClient(...args) {
        calls.push(args);
        return expectedClient;
      }
    })
  });

  assert.equal(await provider.getClient(), expectedClient);
  assert.equal(await provider.getClient(), expectedClient);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], VALID_URL);
  assert.equal(calls[0][1], VALID_KEY);
});

test("missing URL fails safely without loading the CDN module", async () => {
  let loadCount = 0;
  const provider = createSupabaseClientProvider({
    url: "",
    publishableKey: VALID_KEY,
    loadLibrary: async () => {
      loadCount += 1;
      throw new Error("must not load");
    }
  });

  assert.deepEqual(await provider.getConnectionStatus(), {
    available: false,
    status: "unavailable",
    reason: "missing-url",
    session: null
  });
  assert.equal(loadCount, 0);
});

test("missing publishable key fails safely", async () => {
  const result = validateSupabaseBrowserConfig({
    url: VALID_URL,
    publishableKey: ""
  });

  assert.equal(result.available, false);
  assert.equal(result.reason, "missing-publishable-key");
});

test("secret and service-role key formats are rejected for browser clients", () => {
  for (const publishableKey of ["sb_secret_browser_forbidden", "service_role forbidden"]) {
    const result = validateSupabaseBrowserConfig({ url: VALID_URL, publishableKey });
    assert.equal(result.available, false);
    assert.equal(result.reason, "unsafe-secret-key");
  }
});

test("an unavailable Supabase library cannot reject or block application startup", async () => {
  const provider = createSupabaseClientProvider({
    url: VALID_URL,
    publishableKey: VALID_KEY,
    loadLibrary: async () => {
      throw new Error("network unavailable");
    }
  });

  await assert.doesNotReject(() => provider.getConnectionStatus());
  assert.deepEqual(await provider.getConnectionStatus(), {
    available: false,
    status: "unavailable",
    reason: "library-unavailable",
    session: null
  });

  const appSource = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
  assert.match(appSource, /void initializeAuthentication\(\);/);
  assert.match(appSource, /await authService\.initialize\(\);/);
});

test("browser auth session persistence and automatic refresh stay enabled", async () => {
  let receivedOptions;
  const provider = createSupabaseClientProvider({
    url: VALID_URL,
    publishableKey: VALID_KEY,
    loadLibrary: async () => ({
      createClient(_url, _key, options) {
        receivedOptions = options;
        return createFakeClient();
      }
    })
  });

  await provider.getClient();
  assert.equal(SUPABASE_BROWSER_OPTIONS.auth.persistSession, true);
  assert.equal(SUPABASE_BROWSER_OPTIONS.auth.autoRefreshToken, true);
  assert.equal(receivedOptions.auth.persistSession, true);
  assert.equal(receivedOptions.auth.autoRefreshToken, true);
});

test("Auth getSession reports a connected anonymous browser session as null", async () => {
  const provider = createSupabaseClientProvider({
    url: VALID_URL,
    publishableKey: VALID_KEY,
    loadLibrary: async () => ({ createClient: () => createFakeClient() })
  });

  assert.deepEqual(await provider.getConnectionStatus(), {
    available: true,
    status: "connected",
    reason: null,
    session: null
  });
});

function createFakeClient() {
  return {
    auth: {
      async getSession() {
        return { data: { session: null }, error: null };
      }
    }
  };
}
