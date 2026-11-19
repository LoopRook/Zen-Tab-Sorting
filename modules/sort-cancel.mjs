// Zen Tab Sorting — stopping a running sort from the wand.
//
// Only one sort runs per window (click-handler.mjs). Clicking the wand again
// while it runs stops it: in-flight AI requests are aborted, no new ones are
// sent, and whatever batches were already answered are applied as usual. Tabs
// that were not reached stay where they were.
//
// State is per module instance, which Sine creates per browser window, so a
// stop in one window never touches a sort in another.

let controller = null;

// Thrown in place of a request once the sort has been stopped. `noSplit` tells
// the batch retry loop not to retry this batch in smaller pieces.
export class SortCancelledError extends Error {
  constructor() {
    super("Sorting stopped");
    this.name = "SortCancelledError";
    this.noSplit = true;
  }
}

export const beginSortScope = () => {
  controller = new AbortController();
};

export const endSortScope = () => {
  controller = null;
};

// Returns true when there was a running sort to stop.
export const cancelRunningSort = () => {
  if (!controller || controller.signal.aborted) return false;
  controller.abort();
  return true;
};

export const isSortCancelled = () => Boolean(controller?.signal.aborted);

export const sortCancelSignal = () => controller?.signal ?? null;

export const throwIfSortCancelled = () => {
  if (isSortCancelled()) throw new SortCancelledError();
};

// Abort `requestController` if the sort is stopped while a request is in
// flight. Returns a function that detaches the listener.
export const linkToSortCancel = (requestController) => {
  const signal = sortCancelSignal();
  if (!signal) return () => {};
  const onAbort = () => requestController.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
};
