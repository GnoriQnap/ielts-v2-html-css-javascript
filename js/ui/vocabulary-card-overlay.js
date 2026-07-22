export function createVocabularyCardOverlayController({
  overlay,
  host,
  body,
  backgroundElements = [],
  documentRef = globalThis.document
}) {
  requireElement(overlay, "Vocabulary Card Overlay");
  requireElement(host, "Vocabulary Card Host");
  requireElement(body, "页面 body");

  let returnFocusElement = null;
  let isOpen = false;

  function open(card, options = {}) {
    requireElement(card, "Vocabulary Card");
    const nextReturnFocus = options.returnFocusElement ?? documentRef?.activeElement ?? null;
    if (!isOpen) {
      returnFocusElement = nextReturnFocus;
    }

    try {
      host.replaceChildren(card);
      overlay.hidden = false;
      overlay.setAttribute("aria-hidden", "false");
      overlay.classList.add("is-open");
      body.classList.add("vocabulary-card-open");
      setBackgroundInert(true);
      isOpen = true;
      card.querySelector?.("[data-vocabulary-card-close]")?.focus();
      return true;
    } catch (error) {
      resetOpenState({ clearContent: true, restoreFocus: false });
      throw error;
    }
  }

  function close(options = {}) {
    resetOpenState({
      clearContent: options.clearContent !== false,
      restoreFocus: options.restoreFocus !== false
    });
  }

  function handleKeydown(event) {
    if (isOpen && event.key === "Escape") {
      event.preventDefault?.();
      close();
    }
  }

  function destroy() {
    close();
    documentRef?.removeEventListener?.("keydown", handleKeydown);
  }

  function resetOpenState({ clearContent, restoreFocus }) {
    const focusTarget = returnFocusElement;
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    overlay.classList.remove("is-open");
    body.classList.remove("vocabulary-card-open");
    setBackgroundInert(false);
    isOpen = false;
    returnFocusElement = null;

    if (clearContent) {
      host.replaceChildren();
    }
    if (restoreFocus && focusTarget?.isConnected) {
      try {
        focusTarget.focus();
      } catch {
        // Focus restoration must never block scroll-lock cleanup.
      }
    }
  }

  function setBackgroundInert(inert) {
    for (const element of backgroundElements) {
      element?.toggleAttribute?.("inert", inert);
    }
  }

  documentRef?.addEventListener?.("keydown", handleKeydown);

  return {
    open,
    close,
    destroy,
    isOpen: () => isOpen
  };
}

function requireElement(element, label) {
  if (!element) {
    throw new TypeError(`${label} 不存在。`);
  }
}
