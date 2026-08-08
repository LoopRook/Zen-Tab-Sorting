// Zen Tab Sorting — remote provider Pass 2 drivers.
//
// This mirrors the Ollama orchestration shape, but the transport is any
// OpenAI/Gemini/custom provider explicitly enabled in preferences.

import { LOG } from "./config.mjs";
import { getProviderReadiness } from "./provider-readiness.mjs";
import { buildProviderRequest, getProviderKind, parseProviderResponse } from "./provider-requests.mjs";
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
  try {
    const reply = await providerText(readiness.value, "Reply with the single word: ok", 16);
    return { ok: true, reply: reply.slice(0, 60) };
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

  for (const chunk of chunkTabsForProvider(pendingTabs)) {
    const parsed = await providerJson(readiness.value, buildClassifyPrompt(rules, chunk.tabs));
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

    if (!rules.some((r) => r?.name)) {
      const grouped = await clusterUnmatchedNewGroups(unmatched, readiness.value);
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
      fetchJson: (prompt) => providerJson(readiness.value, prompt, PROVIDER_JSON_MAX_TOKENS),
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
      providerJson(readiness.value, prompt), "Remote provider");
    if (failures.length > 0) {
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

    const { deduped, origToDeduped } = dedupeTabs(allTabs);
    const snippets = await fetchSnippets(deduped, "remote fresh");
    const { parsedByIndex: parsedByDedupedIndex, failures } = await collectProviderTabMap({
      tabs: deduped,
      snippets,
      initialBatchSize: PROVIDER_FRESH_TAB_BATCH_SIZE,
      label: "remote provider fresh",
      buildPrompt: (tabs, chunkSnippets) => buildFreshPrompt(tabs, chunkSnippets),
      fetchJson: (prompt) => providerJson(readiness.value, prompt, PROVIDER_FRESH_JSON_MAX_TOKENS),
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

    if (failures.length > 0) {
      showToast(`Remote provider skipped ${failures.length} full-AI batch(es). Try a stronger model if some tabs did not move.`);
    }

    const newGroups = await consolidateNewGroups([...newGroupsByKey.values()], (prompt) =>
      providerJson(readiness.value, prompt, PROVIDER_FRESH_JSON_MAX_TOKENS), "Remote provider");

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
    const parsed = await providerJson(settings, buildClusterPrompt(chunk.tabs));
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

const providerText = async (settings, prompt, maxTokens) => {
  const request = buildProviderRequest(settings, prompt, maxTokens);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);
  let response;
  try {
    const doFetch = resolveFetch();
    response = await doFetch(request.url, { ...request.init, signal: controller.signal });
  } catch (e) {
    throw new Error(e.name === "AbortError" ? `timeout after ${GENERATE_TIMEOUT_MS}ms` : (e.message || String(e)));
  } finally {
    clearTimeout(timer);
  }

  const body = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 200)}`);
  const text = parseProviderResponse(getProviderKind(settings), body);
  if (typeof text !== "string" || !text.trim()) throw new Error("Provider response did not contain text");
  return text.trim();
};

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
