import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hybridRules } from "./zen-e2e-fixtures.mjs";

const DEFAULT_ZEN_APP_SUPPORT = join(process.env.HOME || "", "Library/Application Support/zen");
const LAB_COPY_EXCLUDE_NAMES = new Set([".debug-journal.md", ".git", ".omo", "node_modules"]);

export const findDefaultSineProfile = async () => {
  const profilesIni = await readFile(join(DEFAULT_ZEN_APP_SUPPORT, "profiles.ini"), "utf8");
  const profilePaths = [...profilesIni.matchAll(/^Path=(Profiles\/.+)$/gm)].map((match) =>
    join(DEFAULT_ZEN_APP_SUPPORT, match[1])
  );
  for (const profilePath of profilePaths) {
    if (await hasSineEngine(profilePath)) return profilePath;
  }
  throw new Error("Could not find a Zen profile with Sine installed; pass --sine-profile");
};

export const createLabProfile = async (repoRoot, sineProfile) => {
  const profileDir = await mkdtemp(join(tmpdir(), "zen-tab-sorting-e2e-"));
  const chromeDir = join(profileDir, "chrome");
  const modsDir = join(chromeDir, "sine-mods");
  await mkdir(modsDir, { recursive: true });

  for (const name of ["JS", "locales", "utils"]) {
    await cp(join(sineProfile, "chrome", name), join(chromeDir, name), { recursive: true });
  }

  await cp(repoRoot, join(modsDir, "zen-tab-sorting"), {
    recursive: true,
    filter: (source) => !LAB_COPY_EXCLUDE_NAMES.has(source.split("/").at(-1)),
  });

  const theme = JSON.parse(await readFile(join(repoRoot, "theme.json"), "utf8"));
  theme.enabled = true;
  theme.origin = "e2e-local";
  theme["no-updates"] = true;
  await writeFile(join(modsDir, "mods.json"), JSON.stringify({ "zen-tab-sorting": theme }), "utf8");
  return { profileDir };
};

export const removeLabProfile = async (profileDir) => {
  await rm(profileDir, { recursive: true, force: true });
};

export const writeUserPrefs = async (profileDir, prefs) => {
  const lines = prefs.map(([name, value]) => {
    const encoded = typeof value === "string" ? JSON.stringify(value) : String(value);
    return `user_pref(${JSON.stringify(name)}, ${encoded});`;
  });
  await writeFile(join(profileDir, "user.js"), `${lines.join("\n")}\n`, "utf8");
};

export const scenarioPrefs = ({ scenario, providerPort, marionettePort }) => {
  const mode = scenario === "full-ai" ? "full-ai" : "hybrid";
  const rules = scenario === "hybrid" ? hybridRules() : [];
  return [
    ["sine.allow-unsafe-js", true],
    ["sine.mods.disable-all", false],
    ["sine.auto-updates", false],
    ["sine.engine.auto-update", false],
    ["browser.startup.cache", false],
    ["browser.startup.page", 0],
    ["marionette.port", marionettePort],
    ["extensions.zen-auto-organize.ai-engine", "custom"],
    ["extensions.zen-auto-organize.ai-provider-consent", true],
    ["extensions.zen-auto-organize.ai-sort-mode", mode],
    ["extensions.zen-auto-organize.ai-new-group-behavior", "transient"],
    ["extensions.zen-auto-organize.ai-existing-behavior", "transient"],
    ["extensions.zen-auto-organize.ai-custom-endpoint", `http://127.0.0.1:${providerPort}/v1`],
    ["extensions.zen-auto-organize.ai-custom-api-key", "zen-tab-sorting-e2e-local-key"],
    ["extensions.zen-auto-organize.ai-custom-model", "zen-tab-sorting-e2e"],
    ["extensions.zen-auto-organize.ai-custom-format", "openai"],
    ["extensions.zen-auto-organize.rules-json", JSON.stringify(rules)],
  ];
};

const hasSineEngine = async (profilePath) => {
  try {
    await access(join(profilePath, "chrome", "JS", "sine.sys.mjs"));
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
};
