import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMainAgentLabel, buildScoutAgentLabel } from "../providers/provider-labels.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const EVALS_DIR = resolve(REPO_ROOT, "evals");

function suiteTaskType(configPath) {
  return configPath.endsWith("edit-evals.yaml") ? "edit" : "agent";
}

function readIndentedValue(lines, key) {
  const line = lines.find((entry) => entry.trim().startsWith(`${key}:`));
  if (!line) return undefined;
  return line.split(":").slice(1).join(":").trim().replace(/^['"]|['"]$/g, "");
}

function readBooleanValue(lines, key) {
  const value = readIndentedValue(lines, key);
  if (value == null) return undefined;
  return value === "true";
}

function deriveLabelFromBlock(blockLines, configPath) {
  const idLine = blockLines.find((line) => line.trim().startsWith("- id:"));
  const providerId = idLine?.split(":").slice(1).join(":").trim();
  const taskType = suiteTaskType(configPath);

  switch (providerId) {
    case "file://./providers/anthropic-default-tools.js":
      return buildMainAgentLabel({ mainProvider: "anthropic", useMcp: false, taskType });
    case "file://./providers/anthropic-freecontext.js":
      return buildMainAgentLabel({ mainProvider: "anthropic", useMcp: true, taskType });
    case "file://./providers/openai-default-tools.js":
      return buildMainAgentLabel({ mainProvider: "openai", useMcp: false, taskType });
    case "file://./providers/openai-freecontext.js":
      return buildMainAgentLabel({ mainProvider: "openai", useMcp: true, taskType });
    case "file://./providers/edit-claude-default-tools.js":
      return buildMainAgentLabel({ mainProvider: "anthropic", useMcp: false, taskType: "edit" });
    case "file://./providers/edit-claude-freecontext.js":
      return buildMainAgentLabel({ mainProvider: "anthropic", useMcp: true, taskType: "edit" });
    case "file://./providers/edit-codex-default-tools.js":
      return buildMainAgentLabel({ mainProvider: "openai", useMcp: false, taskType: "edit" });
    case "file://./providers/edit-codex-freecontext.js":
      return buildMainAgentLabel({ mainProvider: "openai", useMcp: true, taskType: "edit" });
    case "file://./providers/scout-provider.js":
    case "file://./providers/edit-scout-provider.js": {
      const mainProvider = readIndentedValue(blockLines, "mainProvider") ?? "openai";
      const scoutPreset = readIndentedValue(blockLines, "scoutPreset");
      const scoutModel = readIndentedValue(blockLines, "scoutModel");
      const useMcp = readBooleanValue(blockLines, "useMcp") ?? true;
      return buildScoutAgentLabel({
        mainProvider,
        scoutPreset,
        scoutModel,
        useMcp,
        taskType,
      });
    }
    default:
      return providerId ?? "unknown-provider";
  }
}

function splitTopLevelSections(text) {
  const lines = text.split("\n");
  const providersStart = lines.findIndex((line) => line.trim() === "providers:");
  if (providersStart === -1) {
    throw new Error("Could not find providers section in Promptfoo config.");
  }

  let providersEnd = lines.length;
  for (let index = providersStart + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[A-Za-z][A-Za-z0-9_-]*:/.test(line)) {
      providersEnd = index;
      break;
    }
  }

  return {
    before: lines.slice(0, providersStart + 1),
    providers: lines.slice(providersStart + 1, providersEnd),
    after: lines.slice(providersEnd),
  };
}

function splitProviderBlocks(providerLines) {
  const blocks = [];
  let current = [];

  for (const line of providerLines) {
    if (line.startsWith("  - id:")) {
      if (current.length > 0) {
        blocks.push(current);
      }
      current = [line];
      continue;
    }

    if (current.length > 0) {
      current.push(line);
    }
  }

  if (current.length > 0) {
    blocks.push(current);
  }

  return blocks;
}

function injectLabel(blockLines, label) {
  const withoutExistingLabel = blockLines
    .filter((line) => !line.trim().startsWith("label:"))
    .map((line) => {
      if (!line.trim().startsWith("- id:")) {
        return line;
      }

      const providerId = line.split(":").slice(1).join(":").trim();
      if (!providerId.startsWith("file://./")) {
        return line;
      }

      const relativePath = providerId.slice("file://".length);
      const absolutePath = resolve(EVALS_DIR, relativePath);
      return `  - id: file://${absolutePath}`;
    });
  return [
    withoutExistingLabel[0],
    `    label: "${label}"`,
    ...withoutExistingLabel.slice(1),
  ];
}

export function buildFilteredPromptfooConfig(configPath, filterPattern) {
  const absoluteConfigPath = resolve(REPO_ROOT, configPath);
  const source = readFileSync(absoluteConfigPath, "utf8");
  const { before, providers, after } = splitTopLevelSections(source);
  const normalizedBefore = before.map((line) => {
    if (!line.trim().startsWith("envFile:")) {
      return line;
    }

    const envPath = line.split(":").slice(1).join(":").trim();
    const absoluteEnvPath = resolve(dirname(absoluteConfigPath), envPath);
    return `envFile: ${absoluteEnvPath}`;
  });
  const blocks = splitProviderBlocks(providers);
  const matcher = filterPattern ? new RegExp(filterPattern) : null;

  const selectedBlocks = blocks
    .map((block) => {
      const label = deriveLabelFromBlock(block, configPath);
      return {
        label,
        block: injectLabel(block, label),
      };
    })
    .filter(({ label }) => (matcher ? matcher.test(label) : true));

  if (selectedBlocks.length === 0) {
    throw new Error(`No providers matched the filter "${filterPattern}".`);
  }

  return [
    ...normalizedBefore,
    ...selectedBlocks.flatMap(({ block }) => block),
    ...after,
  ].join("\n");
}

export function writeFilteredPromptfooConfig(configPath, filterPattern) {
  const rendered = buildFilteredPromptfooConfig(configPath, filterPattern);
  const outDir = resolve(REPO_ROOT, "evals", ".promptfoo");
  mkdirSync(outDir, { recursive: true });
  const targetPath = resolve(
    outDir,
    `${configPath.split("/").pop()?.replace(/\.ya?ml$/, "") ?? "promptfoo"}-filtered-${Date.now()}.yaml`
  );
  writeFileSync(targetPath, rendered, "utf8");
  return targetPath;
}

export function stripArgWithValue(args, name) {
  const result = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name) {
      index += 1;
      continue;
    }
    result.push(args[index]);
  }
  return result;
}

export function readArgValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}
