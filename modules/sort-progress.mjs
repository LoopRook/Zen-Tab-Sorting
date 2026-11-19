// Zen Tab Sorting — progress readout on the wand while the AI is sorting.
//
// The AI pass sends tabs in batches and the provider says nothing until a
// batch is answered, so progress is only known batch by batch: "how many tabs
// have an answer so far". That is shown as a percentage beside the wand, with
// the exact count in its tooltip. Within one batch there is nothing to report,
// so the number moves in steps, and a long batch just holds its value while
// the wand keeps pulsing.
//
// Safe to call anywhere: outside the browser window (Node tests, the settings
// page) there is no wand and every call is a no-op.

import { CONFIG } from "./config.mjs";

const IDLE_TOOLTIP = "Auto Organize Tabs (domain rules + AI fallback)";

const wands = () => {
  try {
    if (typeof document === "undefined" || !document.querySelectorAll) return [];
    // One wand per workspace separator, all sharing the id.
    return [...document.querySelectorAll(`[id="${CONFIG.BUTTON_ID}"]`)];
  } catch {
    return [];
  }
};

const labelFor = (button) => {
  let label = button.querySelector(".zao-progress");
  if (!label && typeof document.createXULElement === "function") {
    label = document.createXULElement("label");
    label.className = "zao-progress";
    (button.querySelector(".toolbarbutton-box") || button).appendChild(label);
  }
  return label;
};

const show = (short, long) => {
  for (const button of wands()) {
    try {
      const label = labelFor(button);
      label?.setAttribute("value", short);
      button.setAttribute("data-zao-progress", short);
      button.setAttribute("tooltiptext", long);
    } catch { /* a wand mid-teardown must not break the sort */ }
  }
};

// The pure part, exported for tests.
export const progressText = (done, total) => {
  const safeTotal = Math.max(0, Math.floor(total) || 0);
  const safeDone = Math.min(safeTotal, Math.max(0, Math.floor(done) || 0));
  const percent = safeTotal ? Math.floor((safeDone / safeTotal) * 100) : 0;
  return {
    short: `${percent}%`,
    long: `Sorting with AI: ${safeDone} of ${safeTotal} tab(s) answered. Click the wand to stop.`,
  };
};

export const setSortProgress = (done, total) => {
  if (!(total > 0)) return;
  const { short, long } = progressText(done, total);
  show(short, long);
};

// A step with no count (e.g. merging near-duplicate group names).
export const setSortPhase = (short, long = short) => show(short, long);

export const clearSortProgress = () => {
  for (const button of wands()) {
    try {
      button.querySelector(".zao-progress")?.remove();
      button.removeAttribute("data-zao-progress");
      button.setAttribute("tooltiptext", IDLE_TOOLTIP);
    } catch {}
  }
};
