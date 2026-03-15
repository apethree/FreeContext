import { describe, it, expect } from "vitest";
import { TreeSitterParser } from "../parser/ts-parser.js";
import { contentHash } from "../parser/hash.js";

describe("TreeSitterParser", () => {
  const parser = new TreeSitterParser();

  it("parses a function declaration", () => {
    const code = `function greet(name: string): string {
  return "hello " + name;
}`;
    const symbols = parser.parseFile("test.ts", code);
    const fn = symbols.find((s) => s.symbolKind === "function" && s.symbolName === "greet");
    expect(fn).toBeDefined();
    expect(fn!.startLine).toBe(1);
    expect(fn!.endLine).toBe(3);
  });

  it("parses a class declaration", () => {
    const code = `class MyService {
  method() {}
}`;
    const symbols = parser.parseFile("test.ts", code);
    const cls = symbols.find((s) => s.symbolKind === "class");
    expect(cls).toBeDefined();
    expect(cls!.symbolName).toBe("MyService");
  });

  it("parses an interface", () => {
    const code = `interface Config {
  name: string;
  value: number;
}`;
    const symbols = parser.parseFile("test.ts", code);
    const iface = symbols.find((s) => s.symbolKind === "interface");
    expect(iface).toBeDefined();
    expect(iface!.symbolName).toBe("Config");
  });

  it("parses a type alias", () => {
    const code = `type Result = { ok: boolean; data: string };`;
    const symbols = parser.parseFile("test.ts", code);
    const alias = symbols.find((s) => s.symbolKind === "type_alias");
    expect(alias).toBeDefined();
    expect(alias!.symbolName).toBe("Result");
  });

  it("parses an arrow function variable", () => {
    const code = `const add = (a: number, b: number) => a + b;`;
    const symbols = parser.parseFile("test.ts", code);
    const fn = symbols.find((s) => s.symbolKind === "function" && s.symbolName === "add");
    expect(fn).toBeDefined();
  });

  it("parses import statements", () => {
    const code = `import { readFile } from "fs";`;
    const symbols = parser.parseFile("test.ts", code);
    const imp = symbols.find((s) => s.symbolKind === "import");
    expect(imp).toBeDefined();
    expect(imp!.symbolName).toBe("fs");
    expect(imp!.imports).toEqual(["fs"]);
  });

  it("extracts call expressions", () => {
    const code = `function main() {
  console.log("hello");
  doStuff();
}`;
    const symbols = parser.parseFile("test.ts", code);
    const fn = symbols.find((s) => s.symbolName === "main");
    expect(fn).toBeDefined();
    expect(fn!.calls).toContain("doStuff");
    expect(fn!.calls).toContain("console.log");
  });

  it("detects exported symbols", () => {
    const code = `export function helper() {}`;
    const symbols = parser.parseFile("test.ts", code);
    const fn = symbols.find((s) => s.symbolName === "helper");
    expect(fn).toBeDefined();
    expect(fn!.exports).toContain("helper");
  });

  it("handles JSX files", () => {
    const code = `function App() {
  return <div>Hello</div>;
}`;
    const symbols = parser.parseFile("test.tsx", code);
    const fn = symbols.find((s) => s.symbolName === "App");
    expect(fn).toBeDefined();
  });

  it("handles plain variable declarations", () => {
    const code = `const MAX_SIZE = 100;`;
    const symbols = parser.parseFile("test.ts", code);
    const v = symbols.find((s) => s.symbolKind === "variable" && s.symbolName === "MAX_SIZE");
    expect(v).toBeDefined();
  });
});

describe("contentHash", () => {
  it("produces consistent hashes", () => {
    const a = contentHash("hello world");
    const b = contentHash("hello world");
    expect(a).toBe(b);
  });

  it("produces different hashes for different content", () => {
    const a = contentHash("hello");
    const b = contentHash("world");
    expect(a).not.toBe(b);
  });

  it("returns a 16-char hex string", () => {
    const h = contentHash("test");
    expect(h).toMatch(/^[a-f0-9]{16}$/);
  });
});
