import { LOG } from "./config.mjs";
import { buildMergePrompt } from "./ollama-prompts.mjs";

const TRAILING_GENERICS = new Set([
  "category", "categories", "label", "labels", "topic", "topics",
  "bucket", "buckets", "group", "groups", "management", "tools",
  "resources", "resource", "sites", "site", "pages", "page",
  "products", "product", "stuff", "things",
]);

const lightStem = (word) =>
  word
    .replace(/(ability|ibility)$/i, "")
    .replace(/(able|ible)$/i, "")
    .replace(/(ation|ization)$/i, "")
    .replace(/(ing)$/i, "")
    .replace(/(ies)$/i, "y")
    .replace(/(s)$/i, "");

const normalizeNameForDedupe = (name) => {
  const words = String(name || "")
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  while (words.length > 1 && TRAILING_GENERICS.has(words[words.length - 1])) {
    words.pop();
  }
  return words.map(lightStem).join(" ");
};

const dedupeSimilarNewGroups = (newGroups) => {
  if (!newGroups || newGroups.length < 2) return newGroups || [];
  const byNorm = new Map();
  const out = [];
  for (const group of newGroups) {
    const norm = normalizeNameForDedupe(group.name);
    if (byNorm.has(norm)) {
      out[byNorm.get(norm)].tabs.push(...group.tabs);
      continue;
    }
    byNorm.set(norm, out.length);
    out.push({ ...group });
  }
  return out;
};

const applyMergePlan = (newGroups, parsed) => {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return newGroups;
  const origByLower = new Map(newGroups.map((group) => [group.name.toLowerCase(), group]));
  const consumed = new Set();
  const byTarget = new Map();

  for (const [origName, targetRaw] of Object.entries(parsed)) {
    const origKey = String(origName || "").trim().toLowerCase();
    const targetName = String(targetRaw || "").trim();
    if (!origKey || !targetName || consumed.has(origKey)) continue;
    const source = origByLower.get(origKey);
    if (!source) continue;
    consumed.add(origKey);

    const targetKey = targetName.toLowerCase();
    if (!byTarget.has(targetKey)) byTarget.set(targetKey, { name: targetName, tabs: [] });
    byTarget.get(targetKey).tabs.push(...source.tabs);
  }

  const merged = [...byTarget.values()];
  for (const group of newGroups) {
    if (!consumed.has(group.name.toLowerCase())) merged.push(group);
  }
  return merged;
};

export const consolidateNewGroups = async (newGroups, fetchMergePlan, label = "Provider") => {
  let merged = newGroups || [];
  if (merged.length >= 2) {
    try {
      merged = applyMergePlan(merged, await fetchMergePlan(buildMergePrompt(merged)));
    } catch (e) {
      console.warn(`${LOG} ${label} merge-pass errored; keeping un-merged groups:`, e);
    }
  }
  return dedupeSimilarNewGroups(merged);
};
