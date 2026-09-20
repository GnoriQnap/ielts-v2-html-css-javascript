import assert from "node:assert/strict";
import test from "node:test";

import {
  shouldLearningSurfaceBeInert
} from "../js/ui/learning-surface-interactivity.js";

test("Learning and round-modal inert reasons compose without clearing one another", () => {
  assert.equal(shouldLearningSurfaceBeInert({
    learningSurfaceBlocked: true,
    modalOpen: false
  }), true);
  assert.equal(shouldLearningSurfaceBeInert({
    learningSurfaceBlocked: true,
    modalOpen: true
  }), true);
  assert.equal(shouldLearningSurfaceBeInert({
    learningSurfaceBlocked: false,
    modalOpen: true
  }), true);
  assert.equal(shouldLearningSurfaceBeInert({
    learningSurfaceBlocked: false,
    modalOpen: false
  }), false);
});
