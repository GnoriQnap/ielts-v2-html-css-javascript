import {
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL
} from "../config/supabase-config.js";

export const SUPABASE_ESM_URL =
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm";

export const SUPABASE_BROWSER_OPTIONS = Object.freeze({
  auth: Object.freeze({
    persistSession: true,
    autoRefreshToken: true
  })
});

const URL_PLACEHOLDER = "PASTE_SUPABASE_URL_HERE";
const KEY_PLACEHOLDER = "PASTE_SUPABASE_PUBLISHABLE_KEY_HERE";

export function validateSupabaseBrowserConfig({
  url = SUPABASE_URL,
  publishableKey = SUPABASE_PUBLISHABLE_KEY
} = {}) {
  const normalizedUrl = typeof url === "string" ? url.trim() : "";
  const normalizedKey = typeof publishableKey === "string" ? publishableKey.trim() : "";

  if (!normalizedUrl || normalizedUrl === URL_PLACEHOLDER) {
    return unavailableConfig("missing-url");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(normalizedUrl);
  } catch {
    return unavailableConfig("invalid-url");
  }
  if (!["https:", "http:"].includes(parsedUrl.protocol)) {
    return unavailableConfig("invalid-url");
  }

  if (!normalizedKey || normalizedKey === KEY_PLACEHOLDER) {
    return unavailableConfig("missing-publishable-key");
  }
  if (/^(sb_secret_|service_role\b)/i.test(normalizedKey)) {
    return unavailableConfig("unsafe-secret-key");
  }
  if (!normalizedKey.startsWith("sb_publishable_")) {
    return unavailableConfig("invalid-publishable-key");
  }

  return {
    available: true,
    reason: null,
    url: parsedUrl.toString().replace(/\/$/, ""),
    publishableKey: normalizedKey
  };
}

export function hasPersistedSupabaseSession({
  url = SUPABASE_URL,
  storage = globalThis.localStorage
} = {}) {
  if (!storage || typeof storage.getItem !== "function") return false;
  try {
    const projectRef = new URL(url).hostname.split(".")[0];
    if (!projectRef) return false;
    return storage.getItem(`sb-${projectRef}-auth-token`) !== null;
  } catch {
    return false;
  }
}

export function createSupabaseClientProvider({
  url = SUPABASE_URL,
  publishableKey = SUPABASE_PUBLISHABLE_KEY,
  loadLibrary = loadSupabaseLibrary
} = {}) {
  let initializationPromise = null;

  function getClientResult() {
    if (!initializationPromise) {
      initializationPromise = initializeClient({ url, publishableKey, loadLibrary });
    }
    return initializationPromise;
  }

  async function getClient() {
    return (await getClientResult()).client;
  }

  async function getConnectionStatus() {
    const initialized = await getClientResult();
    if (!initialized.client) {
      return {
        available: false,
        status: "unavailable",
        reason: initialized.reason,
        session: null
      };
    }

    try {
      const { data, error } = await initialized.client.auth.getSession();
      if (error) {
        return connectionUnavailable("auth-error");
      }
      return {
        available: true,
        status: "connected",
        reason: null,
        session: data?.session ?? null
      };
    } catch {
      return connectionUnavailable("auth-unreachable");
    }
  }

  return Object.freeze({ getClient, getClientResult, getConnectionStatus });
}

async function initializeClient({ url, publishableKey, loadLibrary }) {
  const config = validateSupabaseBrowserConfig({ url, publishableKey });
  if (!config.available) {
    return { client: null, status: "unavailable", reason: config.reason };
  }

  try {
    const library = await loadLibrary();
    if (typeof library?.createClient !== "function") {
      return { client: null, status: "unavailable", reason: "library-unavailable" };
    }
    const client = library.createClient(
      config.url,
      config.publishableKey,
      SUPABASE_BROWSER_OPTIONS
    );
    return { client, status: "ready", reason: null };
  } catch {
    return { client: null, status: "unavailable", reason: "library-unavailable" };
  }
}

async function loadSupabaseLibrary() {
  return import(SUPABASE_ESM_URL);
}

function unavailableConfig(reason) {
  return {
    available: false,
    reason,
    url: null,
    publishableKey: null
  };
}

function connectionUnavailable(reason) {
  return {
    available: false,
    status: "unavailable",
    reason,
    session: null
  };
}

const sharedProvider = createSupabaseClientProvider();

export function getSupabaseClient() {
  return sharedProvider.getClient();
}

export function getSupabaseConnectionStatus() {
  return sharedProvider.getConnectionStatus();
}
