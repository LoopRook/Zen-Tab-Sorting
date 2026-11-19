// Zen Tab Sorting — remote provider Pass 2 drivers.
//
// This mirrors the Ollama orchestration shape, but the transport is any
// OpenAI/Gemini/custom provider explicitly enabled in preferences.

import { LOG } from "./config.mjs";
import { getProviderReadiness } from "./provider-readiness.mjs";
import {
  buildProviderRequest,
  describeEmptyResponse,
  getProviderKind,
  guessParamStyle,
  isParamStyleError,
  otherParamStyle,
  parseProviderResponse,
  PARAM_STYLE_CLASSIC,
} from "./provider-requests.mjs";
import {
  deadlineFromSeconds,
  describeReasoningEffort,
  initialReasoningEffort,
  isReasoningParamError,
  nextReasoningEffort,
  normalizeReasoningPreference,
  normalizeTimeLimitSeconds,
} from "./reasoning.mjs";
import { readProviderSettings } from "./provider-settings.mjs";
import { buildClassifyPrompt, buildClusterPrompt, buildUnifiedPrompt, buildFreshPrompt } from "./ollama-prompts.mjs";
import { consolidateNewGroups } from "./new-group-consolidation.mjs";
import { chunkTabsForProvider, PROVIDER_TAB_BATCH_SIZE } from "./provider-batching.mjs";
import { collectProviderTabMap } from "./remote-assignment-retry.mjs";
import { fetchPageSnippet } from "./tabs.mjs";
import { showToast } from "./ui-toast.mjs";

const GENERATE_TIMEOUT_MS = 120000;
const PROVIDER_JSON_MAX_TOKENS = 4096;
const PROVIDER_FRESH_JSON_MAX_TOKENS = 4096;
const PROVIDER_FRESH_TAB_BATCH_SIZE = 35;

// Thrown instead of sending a request once the pass's time limit is spent.
// The batch retry loop treats it like any other batch failure, so tabs the
// provider already placed are kept and the rest stay where they were.
export class AiTimeLimitError extends Error {
  constructor(seconds) {
    super(`AI time limit reached${seconds ? ` (${seconds}s)` : ""}`);
    this.name = "AiTimeLimitError";
  }
}

// Attach one pass's deadline to the settings every request in it receives.
const withDeadline = (settings) => {
  const seconds = normalizeTimeLimitSeconds(settings.timeLimitSeconds);
  return { ...settings, timeLimitSeconds: seconds, deadline: deadlineFromSeconds(seconds) };
};

const timeLimitHit = (settings) => settings.deadline != null && Date.now() >= settings.deadline;

const timeLimitToast = (settings, leftCount) =>
  showToast(`AI time limit (${settings.timeLimitSeconds}s) reached — ${leftCount} tab(s) left where they were. Raise the limit in settings if your provider is slow.`);

const stripMetaPrefix = (s) => s
  .replace(/^\s*(?:new\s+)?(?:category|label|topic|bucket|group)\s*[:\-–]\s*/i, "")
  .trim();

// One-click connectivity probe for the settings dialog's "Test connection"
// button. Runs the SAME readiness gate as a real sort (consent stays required —
// a test request still sends data to the provider), then issues a minimal
// prompt. Returns a plain result object; never throws.
export const testProviderConnection = async (settings = readProviderSettings(Services.prefs)) => {
  const readiness = getProviderReadiness(settings);
  if (!readiness.ok) {
    return { ok: false, reason: readiness.reason, missingFields: readiness.missingFields || [] };
  }
  const t0 = Date.now();
  try {
    const result = await providerTextDetailed(readiness.value, "Reply with the single word: ok", 16);
    return {
      ok: true,
      reply: result.text.slice(0, 60),
      ms: Date.now() - t0,
      // Only OpenAI-shaped requests carry a reasoning setting.
      ...(result.adaptive ? { reasoning: describeReasoningEffort(result.effort) } : {}),
    };
  } catch (e) {
    return { ok: false, reason: "request_failed", error: e?.message || String(e) };
  }
};

export const classifyExistingGroupsRemoteBatch = async (pendingTabs, rules, settings = readProviderSettings(Services.prefs)) => {
  if (!pendingTabs?.length || !rules?.length) return new Map();
  const readiness = getProviderReadiness(settings);
  if (!readiness.ok) {
    showToast(readiness.reason === "consent_required"
      ? "Remote provider needs data-sending consent before sorting."
      : `Remote provider is not ready: ${readiness.reason}`);
    return skippedMap(pendingTabs);
  }

  const namesByLower = new Map(rules.map((r) => r?.name).filter(Boolean).map((name) => [name.toLowerCase(), name]));
  const out = new Map();
  const active = withDeadline(readiness.value);

  for (const chunk of chunkTabsForProvider(pendingTabs)) {
    let parsed;
    try {
      parsed = await providerJson(active, buildClassifyPrompt(rules, chunk.tabs));
    } catch (e) {
      if (!(e instanceof AiTimeLimitError)) throw e;
      timeLimitToast(active, pendingTabs.length - out.size);
      break;
    }
    for (const [key, value] of Object.entries(parsed)) {
      const chunkIdx = Number.parseInt(key, 10);
      if (!Number.isFinite(chunkIdx) || chunkIdx < 0 || chunkIdx >= chunk.tabs.length) continue;
      const raw = String(value || "").trim();
      const canonical = namesByLower.get(raw.toLowerCase());
      out.set(chunk.start + chunkIdx, canonical || null);
    }
  }
  for (let i = 0; i < pendingTabs.length; i++) if (!out.has(i)) out.set(i, null);
  return out;
};

export const runPass2Remote = async (unmatched, rules, settings = readProviderSettings(Services.prefs)) => {
  const empty = { assignedToExisting: [], newGroups: [], skipped: [] };
  if (!unmatched?.length) return empty;

  try {
    const readiness = getProviderReadiness(settings);
    if (!readiness.ok) {
      const message = readiness.reason === "consent_required"
        ? "Remote provider needs data-sending consent before sorting."
        : `Remote provider is not ready: ${readiness.reason}`;
      showToast(message);
      return { ...empty, skipped: unmatched, failed: readiness.reason };
    }

    const active = withDeadline(readiness.value);
    if (!rules.some((r) => r?.name)) {
      const grouped = await clusterUnmatchedNewGroups(unmatched, active);
      return { assignedToExisting: [], newGroups: grouped.groups, skipped: grouped.skipped };
    }

    const { deduped, origToDeduped } = dedupeTabs(unmatched);
    const snippets = await fetchSnippets(deduped, "remote");
    const ruleNameByLower = new Map(rules.filter((r) => r?.name).map((r) => [r.name.toLowerCase(), r.name]));
    const { parsedByIndex: parsedByDedupedIndex, failures } = await collectProviderTabMap({
      tabs: deduped,
      snippets,
      initialBatchSize: PROVIDER_TAB_BATCH_SIZE,
      label: "remote provider",
      buildPrompt: (tabs, chunkSnippets) => buildUnifiedPrompt(rules, tabs, chunkSnippets),
      fetchJson: (prompt) => providerJson(active, prompt, PROVIDER_JSON_MAX_TOKENS),
    });
    const assignedToExisting = [];
    const newGroupsByKey = new Map();
    const skipped = [];

    for (let i = 0; i < unmatched.length; i++) {
      const value = parsedByDedupedIndex.get(origToDeduped[i]);
      const raw = stripMetaPrefix(value == null ? "" : String(value).trim());
      const lower = raw.toLowerCase();
      if (!raw || lower === "skipped" || lower === "none") {
        skipped.push(unmatched[i]);
        continue;
      }
      const canonical = ruleNameByLower.get(lower);
      if (canonical) {
        assignedToExisting.push({ tabInfo: unmatched[i], groupName: canonical, similarity: 1.0 });
        continue;
      }
      if (!newGroupsByKey.has(lower)) newGroupsByKey.set(lower, { name: raw, tabs: [] });
      newGroupsByKey.get(lower).tabs.push(unmatched[i]);
    }

    const newGroups = await consolidateNewGroups([...newGroupsByKey.values()], (prompt) =>
      providerJson(active, prompt), "Remote provider");
    if (timeLimitHit(active) && failures.length > 0) {
      timeLimitToast(active, skipped.length);
    } else if (failures.length > 0) {
      showToast(`Remote provider retried incomplete batches; ${skipped.length} tab(s) still did not move.`);
    }
    return { assignedToExisting, newGroups, skipped };
  } catch (e) {
    console.error(`${LOG} remote provider classification failed:`, e);
    showToast(`Remote provider classification failed: ${e.message || e}`);
    return { ...empty, skipped: unmatched, failed: e.message || String(e) };
  }
};

export const runPass2RemoteFresh = async (allTabs, settings = readProviderSettings(Services.prefs)) => {
  const empty = { assignedToExisting: [], newGroups: [], skipped: [] };
  if (!allTabs?.length) return empty;

  try {
    const readiness = getProviderReadiness(settings);
    if (!readiness.ok) {
      showToast(`Remote provider is not ready: ${readiness.reason}`);
      return { ...empty, skipped: allTabs, failed: readiness.reason };
    }

    const active = withDeadline(readiness.value);
    const { deduped, origToDeduped } = dedupeTabs(allTabs);
    const snippets = await fetchSnippets(deduped, "remote fresh");
    const { parsedByIndex: parsedByDedupedIndex, failures } = await collectProviderTabMap({
      tabs: deduped,
      snippets,
      initialBatchSize: PROVIDER_FRESH_TAB_BATCH_SIZE,
      label: "remote provider fresh",
      buildPrompt: (tabs, chunkSnippets) => buildFreshPrompt(tabs, chunkSnippets),
      fetchJson: (prompt) => providerJson(active, prompt, PROVIDER_FRESH_JSON_MAX_TOKENS),
    });
    const newGroupsByKey = new Map();
    const skipped = [];

    for (let i = 0; i < allTabs.length; i++) {
      const value = parsedByDedupedIndex.get(origToDeduped[i]);
      const raw = stripMetaPrefix(value == null ? "" : String(value).trim());
      const lower = raw.toLowerCase();
      if (!raw || lower === "skipped" || lower === "none") {
        skipped.push(allTabs[i]);
        continue;
      }
      if (!newGroupsByKey.has(lower)) newGroupsByKey.set(lower, { name: raw, tabs: [] });
      newGroupsByKey.get(lower).tabs.push(allTabs[i]);
    }

    if (timeLimitHit(active) && failures.length > 0) {
      timeLimitToast(active, skipped.length);
    } else if (failures.length > 0) {
      showToast(`Remote provider skipped ${failures.length} full-AI batch(es). Try a stronger model if some tabs did not move.`);
    }

    const newGroups = await consolidateNewGroups([...newGroupsByKey.values()], (prompt) =>
      providerJson(active, prompt, PROVIDER_FRESH_JSON_MAX_TOKENS), "Remote provider");

    return {
      assignedToExisting: [],
      newGroups,
      skipped,
      ...(failures.length > 0 ? { failed: failures.join("; ") } : {}),
    };
  } catch (e) {
    console.error(`${LOG} remote provider fresh classification failed:`, e);
    showToast(`Remote provider fresh classification failed: ${e.message || e}`);
    return { ...empty, skipped: allTabs, failed: e.message || String(e) };
  }
};

const clusterUnmatchedNewGroups = async (leftover, settings) => {
  const seen = new Set();
  const groupsByLower = new Map();

  for (const chunk of chunkTabsForProvider(leftover)) {
    let parsed;
    try {
      parsed = await providerJson(settings, buildClusterPrompt(chunk.tabs));
    } catch (e) {
      // Out of time: keep the groups earlier chunks produced instead of
      // throwing them away with the rest of the pass.
      if (!(e instanceof AiTimeLimitError)) throw e;
      timeLimitToast(settings, leftover.length - seen.size);
      break;
    }
    const validIdx = (i) => Number.isFinite(i) && i >= 0 && i < chunk.tabs.length;

    for (const group of Array.isArray(parsed?.groups) ? parsed.groups : []) {
      const name = String(group?.name || "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (!groupsByLower.has(key)) groupsByLower.set(key, { name, tabs: [] });

      for (const chunkIdx of Array.isArray(group?.tabs) ? group.tabs.filter(validIdx) : []) {
        const originalIdx = chunk.start + chunkIdx;
        if (seen.has(originalIdx)) continue;
        seen.add(originalIdx);
        groupsByLower.get(key).tabs.push(leftover[originalIdx]);
      }
    }
  }

  return {
    groups: [...groupsByLower.values()].filter((group) => group.tabs.length > 0),
    skipped: leftover.filter((_, idx) => !seen.has(idx)),
  };
};

const providerJson = async (settings, prompt, maxTokens = PROVIDER_JSON_MAX_TOKENS) => {
  const responseText = await providerText(settings, prompt, maxTokens);
  let parsed;
  try {
    parsed = JSON.parse(extractJsonObjectText(responseText));
  } catch {
    throw new Error(`Provider returned non-JSON content: ${String(responseText).slice(0, 120)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Provider returned non-object JSON");
  }
  return parsed;
};

const extractJsonObjectText = (text) => {
  const raw = String(text || "").trim();
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();
  return raw;
};

// Resolve which fetch to use. In the about:preferences context (where the
// "Test connection" button lives) the document's CSP can block fetches to
// external provider hosts with a bare "NetworkError" — so route requests
// through the main browser window's fetch instead. In the browser window this
// resolves to the same fetch as before, and in Node (tests stub
// globalThis.fetch) Services is undefined so the global is used unchanged.
const resolveFetch = () => {
  try {
    if (typeof Services !== "undefined" && typeof window !== "undefined" &&
        window.location?.href !== "chrome://browser/content/browser.xhtml") {
      const win = Services.wm?.getMostRecentWindow?.("navigator:browser");
      if (win?.fetch) return win.fetch.bind(win);
    }
  } catch {}
  return fetch;
};

// The per-request timeout shrinks to whatever is left of the pass's time limit,
// and a pass that is already out of time sends nothing at all.
const sendProviderRequest = async (request, settings = {}) => {
  let timeoutMs = GENERATE_TIMEOUT_MS;
  let limitedByDeadline = false;
  if (settings.deadline != null) {
    const remaining = settings.deadline - Date.now();
    if (remaining <= 0) throw new AiTimeLimitError(settings.timeLimitSeconds);
    if (remaining < timeoutMs) {
      timeoutMs = remaining;
      limitedByDeadline = true;
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const doFetch = resolveFetch();
    const response = await doFetch(request.url, { ...request.init, signal: controller.signal });
    return { response, body: await response.text() };
  } catch (e) {
    if (e.name === "AbortError" && limitedByDeadline) throw new AiTimeLimitError(settings.timeLimitSeconds);
    throw new Error(e.name === "AbortError" ? `timeout after ${timeoutMs}ms` : (e.message || String(e)));
  } finally {
    clearTimeout(timer);
  }
};

// What an endpoint and model accepted (parameter shape and reasoning value),
// remembered so a sort pays for a rejected request once rather than on every
// batch. In-memory on purpose: this belongs to the model, not to the user's
// settings, and re-learning it after a restart costs one rejected request.
// Keyed by the reasoning preference too, so changing it takes effect at once.
const acceptedByTarget = new Map();

// Each corrective retry changes exactly one thing (the shape or the reasoning
// value), so a handful covers every combination. The bound only guards against
// a provider that keeps answering with contradictory errors.
const MAX_REQUEST_ATTEMPTS = 5;

const providerTextDetailed = async (settings, prompt, maxTokens) => {
  const kind = getProviderKind(settings);
  // Only the OpenAI-shaped kinds have the parameter split and a reasoning
  // field. Gemini and Ollama take their own parameters and are left alone.
  const adaptive = kind === "openai";
  const preference = normalizeReasoningPreference(settings.reasoningEffort);
  const target = `${settings.endpoint || ""}\x00${settings.model || ""}\x00${preference}`;
  const cached = adaptive ? acceptedByTarget.get(target) : null;

  let style = !adaptive ? PARAM_STYLE_CLASSIC : cached ? cached.style : guessParamStyle(settings.model);
  let effort = !adaptive ? null : cached ? cached.effort : initialReasoningEffort(preference);
  const triedStyles = new Set([style]);
  const triedEfforts = new Set([effort]);

  let response;
  let body;
  // Retry only while the provider is specifically rejecting how the request
  // was shaped. Any other failure is the caller's problem, not ours.
  for (let attempt = 0; attempt < MAX_REQUEST_ATTEMPTS; attempt++) {
    ({ response, body } = await sendProviderRequest(
      buildProviderRequest(settings, prompt, maxTokens, style, effort), settings));
    if (response.ok || !adaptive) break;
    // Checked first: a reasoning complaint also says "unsupported".
    if (effort != null && isReasoningParamError(response.status, body)) {
      const next = nextReasoningEffort(preference, body, triedEfforts);
      console.log(`${LOG} provider rejected reasoning_effort "${effort}"; ${next ? `trying "${next}"` : "retrying without it"}`);
      effort = next;
      triedEfforts.add(next);
      continue;
    }
    if (isParamStyleError(response.status, body) && !triedStyles.has(otherParamStyle(style))) {
      console.log(`${LOG} provider rejected the ${style} parameter shape`);
      style = otherParamStyle(style);
      triedStyles.add(style);
      continue;
    }
    break;
  }

  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 200)}`);
  if (adaptive) acceptedByTarget.set(target, { style, effort });
  const text = parseProviderResponse(kind, body);
  if (typeof text !== "string" || !text.trim()) {
    const detail = describeEmptyResponse(kind, body);
    throw new Error(`Provider response did not contain text${detail ? ` (${detail})` : ""}`);
  }
  return { text: text.trim(), adaptive, style, effort };
};

const providerText = async (settings, prompt, maxTokens) =>
  (await providerTextDetailed(settings, prompt, maxTokens)).text;

const dedupeTabs = (tabs) => {
  const indexByKey = new Map();
  const deduped = [];
  const origToDeduped = tabs.map((tab) => {
    const key = `${tab.hostname || ""}\x00${tab.title || ""}`;
    if (indexByKey.has(key)) return indexByKey.get(key);
    const idx = deduped.length;
    indexByKey.set(key, idx);
    deduped.push(tab);
    return idx;
  });
  return { deduped, origToDeduped };
};

const fetchSnippets = async (tabs, label) => {
  const t0 = performance.now();
  const snippets = await Promise.all(tabs.map((tab) => {
    const url = tab.url || "";
    if (!url.startsWith("http://") && !url.startsWith("https://")) return "";
    return fetchPageSnippet(url);
  }));
  const hit = snippets.filter(Boolean).length;
  console.log(`${LOG} ${label}: fetched snippets for ${hit}/${tabs.length} tab(s) in ${Math.round(performance.now() - t0)}ms`);
  return snippets;
};

const skippedMap = (tabs) => new Map(tabs.map((_, idx) => [idx, null]));
