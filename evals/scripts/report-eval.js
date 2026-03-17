import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

function usageFor(result) {
  return (
    result.response?.tokenUsage ??
    result.response?.metadata?.tokenUsage ??
    { prompt: 0, completion: 0, total: 0 }
  );
}

function metadataFor(result) {
  return result.response?.metadata ?? {};
}

function firstLine(value) {
  return String(value ?? "").split("\n")[0];
}

function formatList(values) {
  return Array.isArray(values) && values.length > 0 ? values.join(",") : "-";
}

async function run() {
  const targetPath = resolve(process.cwd(), process.argv[2] ?? "evals/.promptfoo/results.json");
  const raw = await readFile(targetPath, "utf8");
  const json = JSON.parse(raw);
  const rows = json.results?.results ?? [];

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`No eval rows found in ${targetPath}`);
  }

  process.stdout.write(`Report: ${targetPath}\n`);
  if (json.results?.timestamp) {
    process.stdout.write(`Timestamp: ${json.results.timestamp}\n`);
  }
  process.stdout.write(`Rows: ${rows.length}\n\n`);

  for (const row of rows) {
    const usage = usageFor(row);
    const metadata = metadataFor(row);
    const label = row.provider?.label ?? row.provider?.id ?? "unknown";
    const description = row.testCase?.description ?? row.description ?? "unnamed";
    const summary = [
      `${label}`,
      row.success ? "PASS" : "FAIL",
      `score=${row.score ?? "-"}`,
      `latencyMs=${row.latencyMs ?? metadata.modelLatencyMs ?? "-"}`,
      `promptTokens=${usage.prompt ?? 0}`,
      `completionTokens=${usage.completion ?? 0}`,
      `totalTokens=${usage.total ?? 0}`,
      `toolCount=${metadata.toolCount ?? 0}`,
      `tools=${formatList(metadata.toolsUsed)}`,
      `toolLoops=${metadata.toolLoopIterations ?? 0}`,
      `modelRounds=${metadata.modelRounds ?? 0}`,
      `toolLatencyMs=${metadata.toolLatencyMs ?? 0}`,
      `modelLatencyMs=${metadata.modelLatencyMs ?? 0}`,
    ].join("\t");

    process.stdout.write(`${summary}\n`);
    process.stdout.write(`  Test: ${description}\n`);
    process.stdout.write(`  Model: ${metadata.model ?? "-"}\n`);
    if (metadata.endpoint) {
      process.stdout.write(`  Endpoint: ${metadata.endpoint}\n`);
    }
    if (metadata.simulatedToolMarkup !== undefined) {
      process.stdout.write(`  SimulatedToolMarkup: ${metadata.simulatedToolMarkup}\n`);
    }
    const reason = row.error || row.gradingResult?.reason;
    if (reason) {
      process.stdout.write(`  Reason: ${firstLine(reason)}\n`);
    }
    process.stdout.write("\n");
  }
}

try {
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
