/** @module app/ui/shortcuts-overlay */

const overlay = document.getElementById('shortcuts-overlay');
const modal = document.getElementById('shortcuts-modal');
const openButton = document.getElementById('shortcuts-btn');
const closeButton = document.getElementById('shortcuts-close-btn');
let previousFocus = null;

function isOpen() {
  return overlay && !overlay.hidden;
}

/** Opens the keyboard-shortcut dialog and remembers the prior focus target. */
export function openShortcutsOverlay() {
  if (!overlay || isOpen()) {
    return;
  }
  previousFocus = document.activeElement;
  overlay.hidden = false;
  closeButton?.focus();
}

/** Closes the keyboard-shortcut dialog and restores focus. */
export function closeShortcutsOverlay() {
  if (!overlay || !isOpen()) {
    return;
  }
  overlay.hidden = true;
  const focusTarget = previousFocus?.isConnected ? previousFocus : openButton;
  previousFocus = null;
  focusTarget?.focus();
}

window.openShortcutsOverlay = openShortcutsOverlay;
window.closeShortcutsOverlay = closeShortcutsOverlay;

closeButton?.addEventListener('click', closeShortcutsOverlay);
overlay?.addEventListener('click', event => {
  if (event.target === overlay) {
    closeShortcutsOverlay();
  }
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && isOpen()) {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeShortcutsOverlay();
    return;
  }

  const tag = document.activeElement?.tagName;
  const isTextInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable;
  if (event.key === '?' && !event.metaKey && !event.ctrlKey && !event.altKey && !isTextInput) {
    event.preventDefault();
    if (isOpen()) {
      closeShortcutsOverlay();
    } else {
      openShortcutsOverlay();
    }
  }
});

modal?.addEventListener('keydown', event => {
  if (event.key !== 'Tab') {
    return;
  }
  event.preventDefault();
  closeButton?.focus();
});
