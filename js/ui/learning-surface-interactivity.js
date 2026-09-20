export function shouldLearningSurfaceBeInert({
  learningSurfaceBlocked,
  modalOpen
} = {}) {
  return Boolean(learningSurfaceBlocked || modalOpen);
}
