function parseOutput(output) {
  return JSON.parse(output);
}

function resultArray(output) {
  const data = parseOutput(output);
  return Array.isArray(data.results) ? data.results : [];
}

export function hasSymbol(output, context) {
  const expected = context.vars?.expectedSymbol ?? context.config?.expectedSymbol;
  return resultArray(output).some((item) => item.symbolName === expected);
}

export function anyFilePathIncludes(output, context) {
  const substring = context.vars?.expectedPath ?? context.config?.expectedPath;
  return resultArray(output).some((item) => {
    if (typeof item === "string") {
      return item.includes(substring);
    }
    return typeof item?.filePath === "string" && item.filePath.includes(substring);
  });
}

export function symbolMatches(output, context) {
  const data = parseOutput(output);
  const symbol = data.symbol;
  return Boolean(
    symbol &&
      symbol.symbolName === context.vars?.expectedSymbol &&
      symbol.symbolKind === context.vars?.expectedKind &&
      symbol.filePath === context.vars?.expectedPath
  );
}

export function countAtLeast(output, context) {
  const data = parseOutput(output);
  return typeof data.count === "number" && data.count >= Number(context.config?.minimum ?? 1);
}

export function codebaseCountsPositive(output) {
  const data = parseOutput(output);
  return data.files > 0 && data.symbols > 0 && data.edges > 0;
}

export function reindexLooksHealthy(output) {
  const data = parseOutput(output);
  return (
    typeof data.filesIndexed === "number" &&
    typeof data.filesSkipped === "number" &&
    typeof data.symbolsIndexed === "number" &&
    data.filesIndexed >= 0 &&
    data.filesSkipped >= 0 &&
    data.symbolsIndexed > 0
  );
}

export function hasChangedSymbolsShape(output) {
  const data = parseOutput(output);
  return typeof data.count === "number" && Array.isArray(data.results);
}

export default function defaultAssertion(output) {
  return Boolean(output);
}
