import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";

const REPO_ROOT = process.cwd();

function interpolateTemplate(template, vars = {}) {
  return String(template ?? "").replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, key) => {
    const value = vars[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

function normalizeAssertion(assertion) {
  if (!assertion || typeof assertion !== "object") {
    return null;
  }

  if (assertion.type === "contains" || assertion.type === "not-contains") {
    return {
      type: assertion.type,
      value: String(assertion.value ?? ""),
    };
  }

  if (
    assertion.type === "javascript" &&
    typeof assertion.value === "string" &&
    assertion.value.includes("localToolCount") &&
    assertion.value.includes("mcpToolCount")
  ) {
    return {
      type: "tool-contract",
    };
  }

  return null;
}

export async function loadPromptfooSuite(configPath) {
  const absolutePath = resolve(REPO_ROOT, configPath);
  const source = await readFile(absolutePath, "utf8");
  const parsed = parse(source);
  return {
    path: absolutePath,
    raw: parsed,
    promptTemplate: parsed.prompts?.[0] ?? "",
    defaultTest: parsed.defaultTest ?? {},
    tests: Array.isArray(parsed.tests) ? parsed.tests : [],
    description: parsed.description ?? "",
  };
}

export async function loadBraintrustCases(configPath, { filterPattern, firstN } = {}) {
  const suite = await loadPromptfooSuite(configPath);
  const defaultMetadata = suite.defaultTest?.metadata ?? {};
  const defaultVars = suite.defaultTest?.vars ?? {};
  const defaultAsserts = Array.isArray(suite.defaultTest?.assert) ? suite.defaultTest.assert : [];
  const matcher = filterPattern ? new RegExp(filterPattern, "i") : null;

  const rows = suite.tests
    .filter((testCase) => (matcher ? matcher.test(String(testCase.description ?? "")) : true))
    .slice(0, firstN ?? Number.POSITIVE_INFINITY)
    .map((testCase, index) => {
      const vars = {
        ...defaultVars,
        ...(testCase.vars ?? {}),
      };
      const checks = [...defaultAsserts, ...(Array.isArray(testCase.assert) ? testCase.assert : [])]
        .map(normalizeAssertion)
        .filter(Boolean);
      const prompt = interpolateTemplate(suite.promptTemplate, vars).trim();
      const metadata = {
        suite: defaultMetadata.suite,
        category: defaultMetadata.category,
        caseDescription: testCase.description ?? `case-${index + 1}`,
        checks,
      };

      return {
        id: `case-${index + 1}-${String(testCase.description ?? "unnamed")
          .toLowerCase()
          .replace(/[^\w]+/g, "-")
          .replace(/^-|-$/g, "")}`,
        input: {
          prompt,
          question: vars.question ?? vars.task ?? "",
          description: testCase.description ?? `case-${index + 1}`,
        },
        expected: testCase.metadata?.expected ?? vars.expected ?? null,
        metadata,
      };
    });

  return {
    suite,
    cases: rows,
  };
}
