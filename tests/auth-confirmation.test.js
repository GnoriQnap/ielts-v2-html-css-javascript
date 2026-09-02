import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanEmailConfirmationCallbackUrl,
  createEmailConfirmationRedirectUrl,
  createPendingSignupEmailStore,
  inspectEmailConfirmationCallback,
  PENDING_SIGNUP_EMAIL_KEY
} from "../js/core/auth-confirmation.js";

test("confirmation redirect is derived from the current origin and path", () => {
  assert.equal(
    createEmailConfirmationRedirectUrl({ origin: "http://localhost:8000", pathname: "/" }),
    "http://localhost:8000/?auth=confirmed"
  );
  assert.equal(
    createEmailConfirmationRedirectUrl({ origin: "https://example.test", pathname: "/trainer/" }),
    "https://example.test/trainer/?auth=confirmed"
  );
});

test("a URL marker alone is never accepted as successful confirmation", () => {
  const callback = inspectEmailConfirmationCallback("http://localhost:8000/?auth=confirmed");
  assert.equal(callback.isCallback, true);
  assert.equal(callback.hasConfirmationEvidence, false);
  assert.equal(callback.hasError, false);
});

test("implicit signup tokens provide confirmation evidence without exposing their values", () => {
  const callback = inspectEmailConfirmationCallback(
    "http://localhost:8000/?auth=confirmed#access_token=sensitive&type=signup&refresh_token=hidden"
  );
  assert.equal(callback.isCallback, true);
  assert.equal(callback.hasConfirmationEvidence, true);
  assert.equal("accessToken" in callback, false);
});

test("expired confirmation callbacks are detected as failures", () => {
  const callback = inspectEmailConfirmationCallback(
    "http://localhost:8000/?auth=confirmed#error=access_denied&error_code=otp_expired&type=signup"
  );
  assert.equal(callback.isCallback, true);
  assert.equal(callback.hasError, true);
  assert.equal(callback.errorCode, "otp_expired");
});

test("ordinary localhost visits are not mistaken for confirmation", () => {
  assert.equal(inspectEmailConfirmationCallback("http://localhost:8000/").isCallback, false);
  assert.equal(inspectEmailConfirmationCallback("http://localhost:8000/#wordbook").isCallback, false);
});

test("pending signup storage writes only the dedicated email key", () => {
  const calls = [];
  const values = new Map();
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { calls.push([key, value]); values.set(key, value); },
    removeItem(key) { values.delete(key); }
  };
  const store = createPendingSignupEmailStore({ storage });
  store.save(" user@example.com ");
  assert.deepEqual(calls, [[PENDING_SIGNUP_EMAIL_KEY, "user@example.com"]]);
  assert.equal(store.load(), "user@example.com");
  assert.equal(JSON.stringify(calls).includes("password"), false);
  store.clear();
  assert.equal(store.load(), "");
});

test("callback cleanup removes auth query and token fragments", () => {
  let replaced = "";
  cleanEmailConfirmationCallbackUrl({
    locationRef: {
      href: "http://localhost:8000/?auth=confirmed&kept=yes#access_token=sensitive&type=signup"
    },
    historyRef: {
      state: { safe: true },
      replaceState(_state, _title, url) { replaced = url; }
    }
  });
  assert.equal(replaced, "/?kept=yes");
  assert.equal(replaced.includes("sensitive"), false);
});
