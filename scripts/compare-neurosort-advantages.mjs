import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyExistingGroupsRemoteBatch, runPass2Remote, runPass2RemoteFresh } from "../modules/remote-provider.mjs";

const DEFAULT_OPEN_ROOT = process.cwd();
// Optional sibling NeuroSort checkout used only for cross-project parity asserts.
// Absent on any machine other than the original author's — see oldRootAvailable.
const DEFAULT_OLD_ROOT = process.env.NEUROSORT_ROOT || "/Users/tyrell/Projects/misc/tab-neurosort";

const readText = (rootDir, path) => readFileSync(join(rootDir, path), "utf8");
const readJson = (rootDir, path) => JSON.parse(readText(rootDir, path));
const exists = (rootDir, path) => existsSync(join(rootDir, path));
const includesAll = (text, needles) => needles.every((needle) => text.includes(needle));
const hasScript = (pkg, name, parts) => {
  const value = pkg.scripts?.[name];
  return typeof value === "string" && parts.every((part) => value.includes(part));
};

const preferenceOptionValues = (preferences, property) => {
  const entry = preferences.find((item) => item?.property === property);
  return Array.isArray(entry?.options)
    ? entry.options.flatMap((option) => (typeof option?.value === "string" ? [option.value] : []))
    : [];
};

const runChecks = async (openRoot, oldRoot) => {
  const pkg = readJson(openRoot, "package.json");
  const theme = readJson(openRoot, "theme.json");
  const prefs = readJson(openRoot, "preferences.json");
  const readme = readText(openRoot, "README.md");
  const config = readText(openRoot, "modules/config.mjs");
  const sortingMode = readText(openRoot, "modules/sorting-mode.mjs");
  const providerBatching = readText(openRoot, "modules/provider-batching.mjs");
  const readiness = readText(openRoot, "modules/provider-readiness.mjs");
  const requests = readText(openRoot, "modules/provider-requests.mjs");
  const providerSettings = readText(openRoot, "modules/provider-settings.mjs");
  const remoteProvider = readText(openRoot, "modules/remote-provider.mjs");
  const clickHandler = readText(openRoot, "modules/click-handler.mjs");
  const rules = readText(openRoot, "modules/rules.mjs");
  const prefsUi = readText(openRoot, "modules/prefs-ui.mjs");
  const readOptional = (rootDir, path) => {
    try {
      return readText(rootDir, path);
    } catch {
      return null;
    }
  };
  // The sibling NeuroSort checkout is optional. When it's missing (any machine
  // other than the original author's), the cross-project parity assertions are
  // skipped rather than failed; every local-side check still runs, so this
  // stays a meaningful gate.
  const oldReadme = readOptional(oldRoot, "README.md");
  const oldPreferences = readOptional(oldRoot, "preferences.json");
  const oldRootAvailable = oldReadme !== null && oldPreferences !== null;
  const engineValues = preferenceOptionValues(prefs, "extensions.zen-auto-organize.ai-engine");
  const sortModeValues = preferenceOptionValues(prefs, "extensions.zen-auto-organize.ai-sort-mode");
  const remoteNoConsentFetchCalls = await probeRemoteNoConsentFetches();
  const buildVersion = config.match(/BUILD_VERSION\s*=\s*"([^"]+)"/)?.[1] || "";

  return [
    {
      name: "provider choices",
      ok: includesAll(readme, ["Off", "Local", "Ollama", "OpenAI-compatible", "Gemini", "Custom"]) &&
        includesAll(engineValues.join(","), ["local", "ollama", "openai", "gemini", "custom"]) &&
        prefsUi.includes("Leave AI engine off") &&
        providerSettings.includes('return { provider: "off", consentToSendData: false }') &&
        (!oldRootAvailable || oldPreferences.includes("extensions.neurosort.provider")),
    },
    {
      name: "remote consent gate",
      ok: prefs.some((entry) => entry?.property === "extensions.zen-auto-organize.ai-provider-consent") &&
        readiness.includes("consent_required") &&
        readiness.includes("consentToSendData") &&
        remoteNoConsentFetchCalls === 0 &&
        (!oldRootAvailable || oldReadme.includes("data-sending consent")),
    },
    {
      name: "provider readiness tests",
      ok: exists(openRoot, "tests/provider-readiness.test.mjs") &&
        readText(openRoot, "tests/provider-readiness.test.mjs").includes("consent_required"),
    },
    {
      name: "provider request tests",
      ok: exists(openRoot, "tests/provider-requests.test.mjs") &&
        includesAll(readText(openRoot, "tests/provider-requests.test.mjs"), ["OpenAI-compatible", "Gemini", "custom Ollama"]),
    },
    {
      name: "security tests and validator",
      ok: exists(openRoot, "tests/security.test.mjs") &&
        exists(openRoot, "scripts/validate-security.mjs") &&
        hasScript(pkg, "validate:security", ["validate-security.mjs"]),
    },
    {
      name: "manifest validator",
      ok: exists(openRoot, "scripts/validate-manifest.mjs") &&
        hasScript(pkg, "validate:manifest", ["validate-manifest.mjs"]),
    },
    {
      name: "preferences validator",
      ok: exists(openRoot, "scripts/validate-preferences.mjs") &&
        hasScript(pkg, "validate:preferences", ["validate-preferences.mjs"]),
    },
    {
      name: "npm check script",
      ok: hasScript(pkg, "check", ["validate", "test", "compare"]),
    },
    {
      name: "brand metadata",
      ok: theme.id === "zen-tab-sorting" &&
        theme.name === "Zen Tab Sorting" &&
        theme.version === pkg.version &&
        theme.version === buildVersion &&
        theme.homepage === "https://github.com/LoopRook/Zen-Tab-Sorting" &&
        theme.readme === "https://raw.githubusercontent.com/LoopRook/Zen-Tab-Sorting/main/README.md",
    },
    {
      name: "sorting mode controls",
      ok: includesAll(sortModeValues.join(","), ["rules-first", "hybrid", "full-ai"]) &&
        includesAll(sortingMode, ["resolveSortingPlan", "FULL_AI", "HYBRID"]) &&
        clickHandler.includes("getAISortMode") &&
        clickHandler.includes("resolveSortingPlan"),
    },
    {
      name: "large provider batching",
      ok: providerBatching.includes("PROVIDER_TAB_BATCH_SIZE") &&
        remoteProvider.includes("chunkTabsForProvider") &&
        exists(openRoot, "tests/provider-batching.test.mjs") &&
        readText(openRoot, "tests/provider-batching.test.mjs").includes("300 ready-provider tabs"),
    },
    {
      name: "README differences",
      ok: includesAll(readme, ["What Makes This Fork Different", "Relationship To NeuroSort", "Relationship To Zen Tab Wand"]) &&
        (!oldRootAvailable || oldReadme.includes("# NeuroSort")) &&
        !readme.includes(["https://ai.redivo.ru", "/v1"].join("")),
    },
    {
      name: "retained Wand advantages",
      ok: includesAll(readme, ["editable domain rules", "skip domains", "backup and restore", "Plan Mode", "local AI", "Ollama", "persistent collapsed groups"]) &&
        includesAll(prefsUi, ["buildRulesEditor", "buildSkipDomainsEditor", "buildBackupRestoreSection"]) &&
        config.includes("collapsed-groups-json"),
    },
    {
      name: "provider request implementation",
      ok: includesAll(requests, ["chat/completions", "generateContent", "/api/generate", "custom"]) &&
        includesAll(remoteProvider, ["runPass2Remote", "runPass2RemoteFresh", "classifyExistingGroupsRemoteBatch"]) &&
        includesAll(clickHandler, ["runPass2Remote", "runPass2RemoteFresh", "classifyExistingGroupsRemoteBatch"]) &&
        includesAll(rules, ["openai", "gemini", "custom"]),
    },
  ];
};

const probeRemoteNoConsentFetches = async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("{}");
  };
  try {
    const settings = {
      provider: "openai",
      consentToSendData: false,
      endpoint: "https://api.example.test/v1",
      apiKey: "sk-test",
      model: "gpt-tabs",
    };
    const tabs = [{ hostname: "github.com", title: "Pull request", url: "" }];
    const rules = [{ name: "Dev", domains: ["github.com"] }];
    await classifyExistingGroupsRemoteBatch(tabs, rules, settings);
    await runPass2Remote(tabs, rules, settings);
    await runPass2RemoteFresh(tabs, settings);
    return calls;
  } finally {
    globalThis.fetch = originalFetch;
  }
};

export const compareNeuroSortAdvantages = async (openRoot = DEFAULT_OPEN_ROOT, oldRoot = DEFAULT_OLD_ROOT) => {
  const checks = await runChecks(openRoot, oldRoot);
  const missingOldAdvantages = checks.filter((check) => !check.ok).map((check) => check.name);
  return { missingOldAdvantages, checks };
};

const isCli = process.argv[1] === fileURLToPath(import.meta.url);

if (isCli) {
  const result = await compareNeuroSortAdvantages();
  console.log(JSON.stringify(result, null, 2));
  if (result.missingOldAdvantages.length > 0) {
    console.error(`compare-neurosort-advantages: FAIL ${result.missingOldAdvantages.join(", ")}`);
    process.exit(1);
  }
  console.log("compare-neurosort-advantages: PASS Zen Tab Sorting covers listed NeuroSort advantages");
}
