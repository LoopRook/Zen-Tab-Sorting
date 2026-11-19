// Zen Tab Sorting — shared toast / system-notification helper.
//
// Tries Zen's UI manager first (best integration), falls back to the standard
// nsIAlertsService (OS-level notification), finally console.warn if neither
// is available. Used by both AI engine modules (ai.mjs, ollama.mjs) for
// user-visible error surfacing.

import { LOG } from "./config.mjs";

// The same message raised twice in quick succession (a readiness failure hit
// by each batch, or by a modal callback right after the main pass) is shown
// once. Different messages always go through.
const TOAST_REPEAT_WINDOW_MS = 4000;
const lastShownAt = new Map();

export const showToast = (message) => {
  const now = Date.now();
  if (now - (lastShownAt.get(message) ?? -Infinity) < TOAST_REPEAT_WINDOW_MS) {
    console.log(`${LOG} toast suppressed (repeat): ${message}`);
    return;
  }
  lastShownAt.set(message, now);
  if (lastShownAt.size > 50) lastShownAt.delete(lastShownAt.keys().next().value);
  try {
    if (typeof gZenUIManager !== "undefined" && typeof gZenUIManager.showToast === "function") {
      console.log(`${LOG} toast: ${message}`);
      // gZenUIManager.showToast expects a localized string id, which we don't
      // have. We log + fall through to the alerts service which takes raw text.
      try {
        const alertsService = Cc["@mozilla.org/alerts-service;1"]?.getService(Ci.nsIAlertsService);
        alertsService?.showAlertNotification(null, "Zen Tab Sorting", message);
      } catch {}
      return;
    }
  } catch {}
  console.warn(`${LOG} toast (no gZenUIManager): ${message}`);
};
