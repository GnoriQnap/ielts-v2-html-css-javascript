import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH_CALLBACK_CLASSIFICATIONS,
  cleanAuthCallbackUrl,
  cleanEmailConfirmationCallbackUrl,
  createEmailConfirmationRedirectUrl,
  createPasswordRecoveryRedirectUrl,
  createPendingSignupEmailStore,
  inspectAuthCallback,
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

test("recovery redirect uses a distinct marker on the current origin and path", () => {
  assert.equal(
    createPasswordRecoveryRedirectUrl({ origin: "http://localhost:8000", pathname: "/" }),
    "http://localhost:8000/?auth=recovery"
  );
  assert.equal(
    createPasswordRecoveryRedirectUrl({ origin: "https://example.test", pathname: "/trainer/" }),
    "https://example.test/trainer/?auth=recovery"
  );
});

test("auth callbacks classify signup URL evidence and SDK-established recovery evidence", () => {
  const signup = inspectAuthCallback(
    "https://example.test/?auth=confirmed#access_token=signup-secret&type=signup"
  );
  assert.equal(signup.classification, AUTH_CALLBACK_CLASSIFICATIONS.SIGNUP_CONFIRMATION);

  const recovery = inspectAuthCallback(
    "https://example.test/?auth=recovery#access_token=recovery-secret&type=recovery",
    { authEvent: "PASSWORD_RECOVERY", sessionKind: "password-recovery" }
  );
  assert.equal(recovery.classification, AUTH_CALLBACK_CLASSIFICATIONS.PASSWORD_RECOVERY);
  assert.equal(JSON.stringify({ signup, recovery }).includes("secret"), false);
});

test("attacker-editable recovery URL material cannot authorize an ordinary session", () => {
  const ordinarySession = { sessionKind: "ordinary", authEvent: "SIGNED_IN" };
  const forgedUrls = [
    "https://example.test/?auth=recovery",
    "https://example.test/?auth=recovery&type=recovery",
    "https://example.test/?auth=recovery&code=generic-code",
    "https://example.test/?auth=recovery&token_hash=forged&type=recovery",
    "https://example.test/?auth=recovery#access_token=forged&type=recovery&refresh_token=forged",
    "https://example.test/?auth=recovery&code=stale&type=recovery#access_token=stale"
  ];
  for (const url of forgedUrls) {
    assert.equal(
      inspectAuthCallback(url, ordinarySession).classification,
      AUTH_CALLBACK_CLASSIFICATIONS.INVALID_PASSWORD_RECOVERY
    );
  }
});

test("recovery requires SDK-established recovery event or session kind", () => {
  assert.equal(
    inspectAuthCallback("https://example.test/?auth=recovery&code=generic-code", {
      sessionKind: "password-recovery",
      authEvent: "PASSWORD_RECOVERY"
    }).classification,
    AUTH_CALLBACK_CLASSIFICATIONS.PASSWORD_RECOVERY
  );
});

test("signup and recovery markers cannot consume one another's evidence", () => {
  assert.equal(
    inspectAuthCallback(
      "https://example.test/?auth=confirmed#access_token=hidden&type=recovery",
      { authEvent: "PASSWORD_RECOVERY", sessionKind: "password-recovery" }
    ).classification,
    AUTH_CALLBACK_CLASSIFICATIONS.INVALID_SIGNUP_CONFIRMATION
  );
  assert.equal(
    inspectAuthCallback("https://example.test/?auth=recovery#access_token=hidden&type=signup")
      .classification,
    AUTH_CALLBACK_CLASSIFICATIONS.INVALID_PASSWORD_RECOVERY
  );
  assert.equal(
    inspectAuthCallback("https://example.test/?auth=confirmed&code=recovery-code", {
      authEvent: "PASSWORD_RECOVERY",
      sessionKind: "password-recovery"
    }).classification,
    AUTH_CALLBACK_CLASSIFICATIONS.INVALID_SIGNUP_CONFIRMATION
  );
});

test("malformed or expired callbacks retain their flow-specific invalid classification", () => {
  assert.equal(
    inspectAuthCallback("https://example.test/?auth=confirmed").classification,
    AUTH_CALLBACK_CLASSIFICATIONS.INVALID_SIGNUP_CONFIRMATION
  );
  assert.equal(
    inspectAuthCallback("https://example.test/?auth=recovery").classification,
    AUTH_CALLBACK_CLASSIFICATIONS.INVALID_PASSWORD_RECOVERY
  );
  assert.equal(
    inspectAuthCallback(
      "https://example.test/?auth=recovery#error=access_denied&error_code=otp_expired&type=recovery"
    ).classification,
    AUTH_CALLBACK_CLASSIFICATIONS.INVALID_PASSWORD_RECOVERY
  );
  assert.equal(
    inspectAuthCallback("https://example.test/").classification,
    AUTH_CALLBACK_CLASSIFICATIONS.NONE
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

test("generic callback cleanup is explicit and removes recovery evidence only when called", () => {
  const href = "https://example.test/trainer/?auth=recovery&code=sensitive&kept=yes";
  let replaced = "";
  assert.equal(href.includes("auth=recovery"), true);
  cleanAuthCallbackUrl({
    locationRef: { href },
    historyRef: {
      state: null,
      replaceState(_state, _title, url) { replaced = url; }
    }
  });
  assert.equal(replaced, "/trainer/?kept=yes");
  assert.equal(replaced.includes("sensitive"), false);
  assert.equal(
    inspectAuthCallback(`https://example.test${replaced}`, {
      authEvent: "SIGNED_IN",
      sessionKind: "ordinary"
    }).classification,
    AUTH_CALLBACK_CLASSIFICATIONS.NONE
  );
});
