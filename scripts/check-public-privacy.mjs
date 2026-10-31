#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";

const allow = new Set([
  "tests/unit/llm-parser.test.mjs",
  "tests/unit/llm-security.test.mjs",
  "tests/unit/start-host.test.mjs",
]);

const rules = [
  [
    /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?!\d)\b/g,
    "private-network-address",
  ],
  [
    /\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}(?!\d)\b/g,
    "private-overlay-address",
  ],
  [
    /\b[\w-]+(?:\.[\w-]+)*\.ts\.net\b/gi,
    "private-tailnet-host",
  ],
  [
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    "deployment-identifier",
  ],
  [
    /(?<![A-Za-z0-9_.])\/(?:home|Users)\/(?!(?:user|username|runner|example)(?:\/|[\s"'<>]|$))[A-Za-z0-9_.-]+/g,
    "personal-home-path",
  ],
];

const narrowIdentifierPaths = [
  "deploy/cloudflared.yml",
  "docs/DEPLOYMENT.md",
];

const syntheticFixturePath = "tests/unit/llm-parser.test.mjs";
const syntheticModelPatterns = [
  /(?:^|\s)(?:Model|模型)\s*[:：]\s*(?:\[[^\]]+\]\s*)?["'`]([^"'`\n]+)["'`]/gi,
  /(?:^|\s)-\s*\[(?:Model|模型)\]\(([^)\s]+)\)/gi,
  /\.model\s*,\s*["'`]([^"'`\n]+)["'`]/gi,
];

const syntheticLabelPattern = /(?:^|["'`\s])(?:Model|模型)\s*[:：]\s*(.+)$/;

function normalizeFixtureModel(raw) {
  let value = raw.trim().replace(/^["'`]+|["'`,]+$/g, "");
  const markdown = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(value);
  if (markdown) {
    value = markdown[2];
  }
  return value.trim().replace(/^["'`]+|["'`,]+$/g, "").trim();
}

function loadExternalPatterns() {
  const patternPath = process.env.PRIVACY_MODEL_PATTERNS_PATH;
  if (!patternPath) {
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(patternPath, "utf8"));
  } catch {
    throw new Error("PRIVACY_MODEL_PATTERNS_PATH is set but is not readable JSON");
  }

  const source = Array.isArray(parsed)
    ? parsed
    : parsed && Array.isArray(parsed.patterns)
      ? parsed.patterns
      : null;
  if (!source) {
    throw new Error("PRIVACY_MODEL_PATTERNS_PATH must contain a pattern array");
  }

  return source.map((item) => {
    const raw = typeof item === "string" ? item : item && typeof item.pattern === "string" ? item.pattern : null;
    if (!raw) {
      throw new Error("PRIVACY_MODEL_PATTERNS_PATH contains an invalid pattern");
    }
    let pattern;
    try {
      pattern = new RegExp(raw, "i");
    } catch {
      throw new Error("PRIVACY_MODEL_PATTERNS_PATH contains a pattern that failed to compile");
    }
    return { category: "deployment-model", pattern };
  });
}

function loadExternalMarkers() {
  const markerPath = process.env.PRIVACY_MARKERS_PATH;
  if (!markerPath) {
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(markerPath, "utf8"));
  } catch {
    throw new Error("PRIVACY_MARKERS_PATH is set but is not readable JSON");
  }

  const source = Array.isArray(parsed)
    ? parsed
    : parsed && Array.isArray(parsed.markers)
      ? parsed.markers
      : null;
  if (!source) {
    throw new Error("PRIVACY_MARKERS_PATH must contain a marker array");
  }

  return source.map((item) => {
    if (!item || typeof item.value !== "string" || item.value.length === 0) {
      throw new Error("PRIVACY_MARKERS_PATH contains an invalid marker");
    }
    return { category: "external-marker", value: item.value };
  });
}

function trackedContent(path, mode, oid) {
  if (mode === "160000") {
    return "";
  }
  if (mode === "120000" || lstatSync(path).isSymbolicLink()) {
    try {
      return readlinkSync(path, "utf8");
    } catch {
      return execFileSync("git", ["cat-file", "blob", oid], {
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
      });
    }
  }
  return readFileSync(path, "utf8");
}

// Optional private model-name patterns (PRIVACY_MODEL_PATTERNS_PATH) keep real
// deployment model names out of the repo while still gating regressions.
const externalMarkers = loadExternalMarkers();
const externalPatterns = loadExternalPatterns();

const files = execFileSync("git", ["ls-files", "-s", "-z"], { encoding: "buffer" })
  .toString()
  .split("\0")
  .filter(Boolean);

let findings = 0;
for (const trackedEntry of files) {
  const [metadata, ...pathParts] = trackedEntry.split("\t");
  const path = pathParts.join("\t");
  const [mode, oid] = metadata.trim().split(/\s+/);
  const content = trackedContent(path, mode, oid);
  const lines = content.split("\n");
  if (path === syntheticFixturePath) {
    for (const [lineIndex, line] of lines.entries()) {
      const labelMatch = syntheticLabelPattern.exec(line);
      if (labelMatch) {
        const value = normalizeFixtureModel(labelMatch[1]);
        if (!value.startsWith("synthetic-model-")) {
          console.error(path + ":" + (lineIndex + 1) + ": non-synthetic-model-fixture");
          findings += 1;
        }
      }
    }
    for (const pattern of syntheticModelPatterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content))) {
        const lineNumber = content.slice(0, match.index).split("\n").length;
        const value = normalizeFixtureModel(match[1]);
        if (!value.startsWith("synthetic-model-")) {
          console.error(path + ":" + lineNumber + ": non-synthetic-model-fixture");
          findings += 1;
        }
      }
    }
  }
  for (const [pattern, category] of rules) {
    // These tests exercise RFC1918 validation; other privacy rules still apply.
    if (category === "private-network-address" && allow.has(path)) {
      continue;
    }
    if (category === "deployment-identifier" && !narrowIdentifierPaths.includes(path)) {
      continue;
    }
    pattern.lastIndex = 0;
    lines.forEach((line, index) => {
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        console.error(path + ":" + (index + 1) + ": " + category);
        findings += 1;
      }
    });
  }
  for (const marker of externalMarkers) {
    lines.forEach((line, index) => {
      if (line.includes(marker.value)) {
        console.error(path + ":" + (index + 1) + ": " + marker.category);
        findings += 1;
      }
    });
  }
  for (const { pattern, category } of externalPatterns) {
    lines.forEach((line, index) => {
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        console.error(path + ":" + (index + 1) + ": " + category);
        findings += 1;
      }
    });
  }
}

if (findings > 0) {
  console.error("privacy check failed: " + findings + " finding(s)");
  process.exit(1);
}

console.log("privacy check passed");
