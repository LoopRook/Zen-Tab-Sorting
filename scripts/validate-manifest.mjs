import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "LoopRook/Zen-Tab-Sorting";
const GITHUB_BASE = `https://github.com/${REPO}`;
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/main`;

const isRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readJsonObject = (rootDir, fileName, errors) => {
  try {
    const parsed = JSON.parse(readFileSync(resolve(rootDir, fileName), "utf8"));
    if (!isRecord(parsed)) {
      errors.push(`${fileName} must contain a JSON object`);
      return {};
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`${fileName} is not valid JSON: ${message}`);
    return {};
  }
};

const expectValue = (errors, label, actual, expected) => {
  if (actual !== expected) errors.push(`${label} must be ${expected}`);
};

const expectLocalFile = (rootDir, errors, label, value) => {
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`${label} must reference a local file`);
    return;
  }
  if (!existsSync(resolve(rootDir, value))) {
    errors.push(`${label} references missing file ${value}`);
  }
};

const validateScripts = (rootDir, theme, errors) => {
  if (!isRecord(theme.scripts)) {
    errors.push("scripts must be an object");
    return;
  }

  const scriptNames = Object.keys(theme.scripts);
  if (existsSync(resolve(rootDir, "auto-organize.uc.mjs")) && !scriptNames.includes("auto-organize.uc.mjs")) {
    errors.push("scripts must include auto-organize.uc.mjs");
  }

  for (const scriptName of scriptNames) {
    expectLocalFile(rootDir, errors, `scripts.${scriptName}`, scriptName);
  }
};

export const validateManifest = (rootDir = process.cwd()) => {
  const errors = [];
  const theme = readJsonObject(rootDir, "theme.json", errors);
  const pkg = readJsonObject(rootDir, "package.json", errors);
  const configSource = readFileSync(resolve(rootDir, "modules/config.mjs"), "utf8");
  const buildVersion = configSource.match(/BUILD_VERSION\s*=\s*"([^"]+)"/)?.[1] || "";

  expectValue(errors, "id", theme.id, "zen-tab-sorting");
  expectValue(errors, "name", theme.name, "Zen Tab Sorting");
  if (typeof theme.version !== "string" || !theme.version.trim()) {
    errors.push("version must be a non-empty string");
  }
  expectValue(errors, "package version", pkg.version, theme.version);
  expectValue(errors, "BUILD_VERSION", buildVersion, theme.version);
  expectValue(errors, "homepage", theme.homepage, GITHUB_BASE);
  expectValue(errors, "readme", theme.readme, `${RAW_BASE}/README.md`);
  expectValue(errors, "image", theme.image, `${RAW_BASE}/image.png`);
  expectValue(errors, "preferences", theme.preferences, "preferences.json");
  expectLocalFile(rootDir, errors, "preferences", theme.preferences);
  validateScripts(rootDir, theme, errors);

  return { ok: errors.length === 0, errors };
};

const isCli = process.argv[1] === fileURLToPath(import.meta.url);

if (isCli) {
  const result = validateManifest();
  if (!result.ok) {
    console.error(result.errors.join("\n"));
    process.exit(1);
  }
  console.log("validate-manifest: PASS zen-tab-sorting manifest/package/build version URLs/scripts");
}
