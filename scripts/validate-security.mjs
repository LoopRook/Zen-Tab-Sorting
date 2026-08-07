import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const TEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".ts",
  ".tsx",
  ".txt",
  ".yml",
  ".yaml",
]);
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage"]);
const FORBIDDEN_TEXT = [
  [["https://ai.redivo.ru", "/v1"].join(""), "hidden redivo endpoint must not appear"],
  [["FETCH DEBUG", " INFO"].join(""), "fetch debug marker must not appear"],
];
const LEAKED_SECRET_PATTERNS = [
  [/sk-[A-Za-z0-9_-]{20,}/g, "likely OpenAI API key"],
  [/AIza[A-Za-z0-9_-]{20,}/g, "likely Gemini API key"],
];
const LOG_CALL_PATTERN = /\b(?:console\.(?:debug|error|info|log|warn)|logger\.(?:debug|error|info|warn))\s*\(([\s\S]{0,900}?)\)/g;
const SECRET_LOG_PATTERNS = [
  [/\bauthorization\b/i, "authorization inside a logging call"],
  [/\bapi[_-]?key\b|\bapiKey\b/i, "API key inside a logging call"],
  [/\brequestBody\b|\bresponseBody\b/i, "raw request/response body inside a logging call"],
  [/\bprompt\b/i, "raw prompt inside a logging call"],
  [/\bheaders\b/i, "headers inside a logging call"],
];
const FLANTIG_URL_PATTERN = /https?:\/\/(?:raw\.githubusercontent\.com|github\.com|codeload\.github\.com)\/flantig\/Zen-Tab-Wand[^\s)"']*/g;

const collectTextFiles = (rootDir, dir = rootDir) => {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      if (!SKIP_DIRS.has(entry)) files.push(...collectTextFiles(rootDir, path));
      continue;
    }
    if (stats.isFile() && TEXT_EXTENSIONS.has(extname(path))) files.push(path);
  }
  return files;
};

const formatPath = (rootDir, path) => relative(rootDir, path).split(sep).join("/") || path;

const isAllowedUpstreamCredit = (line) => {
  const lower = line.toLowerCase();
  return lower.includes("based on") || lower.includes("credit") || lower.includes("mit-licensed");
};

const collectFileErrors = (rootDir, filePath) => {
  const source = readFileSync(filePath, "utf8");
  const label = formatPath(rootDir, filePath);
  const errors = [];

  for (const [needle, message] of FORBIDDEN_TEXT) {
    if (source.includes(needle)) errors.push(`${label}: ${message}`);
  }

  for (const [pattern, message] of LEAKED_SECRET_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const token = match[0];
      if (!token.includes("[redacted]")) errors.push(`${label}: ${message}`);
    }
  }

  for (const match of source.matchAll(LOG_CALL_PATTERN)) {
    const callText = match[0];
    for (const [pattern, message] of SECRET_LOG_PATTERNS) {
      if (pattern.test(callText)) errors.push(`${label}: ${message}`);
    }
  }

  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!FLANTIG_URL_PATTERN.test(line)) return;
    FLANTIG_URL_PATTERN.lastIndex = 0;
    if (!isAllowedUpstreamCredit(line)) {
      errors.push(`${label}:${index + 1}: public install URL must point to LoopRook/Zen-Tab-Sorting`);
    }
  });

  return errors;
};

export const validateSecurity = (rootDir = process.cwd()) => {
  const errors = collectTextFiles(rootDir).flatMap((filePath) => collectFileErrors(rootDir, filePath));
  return { ok: errors.length === 0, errors };
};

const isCli = process.argv[1] === fileURLToPath(import.meta.url);

if (isCli) {
  const result = validateSecurity();
  if (!result.ok) {
    console.error(result.errors.join("\n"));
    process.exit(1);
  }
  console.log("validate-security: PASS no legacy endpoint/debug/leaked secrets/raw secret logs");
}
