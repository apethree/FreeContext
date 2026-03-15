import Parser from "tree-sitter";
import TypeScript from "tree-sitter-typescript";
import JavaScript from "tree-sitter-javascript";
import type { LanguageParser, ParsedSymbol, SymbolKind } from "../types/index.js";

const PARSER_VERSION = "1.0.0";

export class TreeSitterParser implements LanguageParser {
  readonly supportedExtensions = [".ts", ".tsx", ".js", ".jsx"];
  readonly parserVersion = PARSER_VERSION;

  private tsParser: Parser;
  private tsxParser: Parser;
  private jsParser: Parser;

  constructor() {
    this.tsParser = new Parser();
    this.tsParser.setLanguage(TypeScript.typescript as unknown as Parser.Language);

    this.tsxParser = new Parser();
    this.tsxParser.setLanguage(TypeScript.tsx as unknown as Parser.Language);

    this.jsParser = new Parser();
    this.jsParser.setLanguage(JavaScript as unknown as Parser.Language);
  }

  private getParser(filePath: string): Parser {
    if (filePath.endsWith(".tsx") || filePath.endsWith(".jsx")) {
      return filePath.endsWith(".tsx") ? this.tsxParser : this.jsParser;
    }
    if (filePath.endsWith(".ts")) return this.tsParser;
    return this.jsParser;
  }

  parseFile(filePath: string, content: string): ParsedSymbol[] {
    const parser = this.getParser(filePath);
    const tree = parser.parse(content);
    const symbols: ParsedSymbol[] = [];
    const lines = content.split("\n");

    this.walkNode(tree.rootNode, symbols, lines, content);
    return symbols;
  }

  private walkNode(
    node: Parser.SyntaxNode,
    symbols: ParsedSymbol[],
    lines: string[],
    fullContent: string
  ): void {
    const sym = this.extractSymbol(node, lines, fullContent);
    if (sym) symbols.push(sym);

    for (const child of node.children) {
      this.walkNode(child, symbols, lines, fullContent);
    }
  }

  private extractSymbol(
    node: Parser.SyntaxNode,
    lines: string[],
    fullContent: string
  ): ParsedSymbol | null {
    const kind = this.nodeToKind(node);
    if (!kind) return null;

    const name = this.extractName(node, kind);
    if (!name) return null;

    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const rawText = node.text;
    const calls = this.extractCalls(node);
    const imports = this.extractImports(node);
    const exports = this.isExported(node) ? [name] : [];

    return {
      symbolName: name,
      symbolKind: kind,
      startLine,
      endLine,
      rawText,
      imports,
      exports,
      calls,
    };
  }

  private nodeToKind(node: Parser.SyntaxNode): SymbolKind | null {
    switch (node.type) {
      case "function_declaration":
      case "arrow_function":
      case "generator_function_declaration":
        return "function";
      case "method_definition":
        return "method";
      case "class_declaration":
        return "class";
      case "interface_declaration":
        return "interface";
      case "type_alias_declaration":
        return "type_alias";
      case "lexical_declaration":
      case "variable_declaration":
        return this.isTopLevelFunctionVar(node) ? "function" : "variable";
      case "import_statement":
        return "import";
      case "export_statement":
        return this.getExportInnerKind(node);
      default:
        return null;
    }
  }

  private isTopLevelFunctionVar(node: Parser.SyntaxNode): boolean {
    for (const child of node.children) {
      if (child.type === "variable_declarator") {
        const value = child.childForFieldName("value");
        if (
          value &&
          (value.type === "arrow_function" ||
            value.type === "function_expression")
        ) {
          return true;
        }
      }
    }
    return false;
  }

  private getExportInnerKind(node: Parser.SyntaxNode): SymbolKind | null {
    for (const child of node.children) {
      const k = this.nodeToKind(child);
      if (k) return null; // inner node will be caught on its own
    }
    return "export";
  }

  private extractName(node: Parser.SyntaxNode, kind: SymbolKind): string | null {
    if (kind === "import") {
      return this.extractImportName(node);
    }
    if (kind === "export") {
      return this.extractExportName(node);
    }

    const nameNode = node.childForFieldName("name");
    if (nameNode) return nameNode.text;

    // For variable declarations, get the declarator name
    if (
      node.type === "lexical_declaration" ||
      node.type === "variable_declaration"
    ) {
      for (const child of node.children) {
        if (child.type === "variable_declarator") {
          const n = child.childForFieldName("name");
          if (n) return n.text;
        }
      }
    }

    return null;
  }

  private extractImportName(node: Parser.SyntaxNode): string | null {
    const source = node.childForFieldName("source");
    return source ? source.text.replace(/['"]/g, "") : null;
  }

  private extractExportName(node: Parser.SyntaxNode): string | null {
    // export { foo, bar } - use the first specifier
    for (const child of node.children) {
      if (child.type === "export_clause") {
        for (const spec of child.children) {
          if (spec.type === "export_specifier") {
            const n = spec.childForFieldName("name");
            if (n) return n.text;
          }
        }
      }
    }
    return "default";
  }

  private extractCalls(node: Parser.SyntaxNode): string[] {
    const calls: string[] = [];
    this.findCallExpressions(node, calls);
    return [...new Set(calls)];
  }

  private findCallExpressions(
    node: Parser.SyntaxNode,
    calls: string[]
  ): void {
    if (node.type === "call_expression") {
      const fn = node.childForFieldName("function");
      if (fn) {
        if (fn.type === "identifier") {
          calls.push(fn.text);
        } else if (fn.type === "member_expression") {
          calls.push(fn.text);
        }
      }
    }
    for (const child of node.children) {
      this.findCallExpressions(child, calls);
    }
  }

  private extractImports(node: Parser.SyntaxNode): string[] {
    if (node.type !== "import_statement") return [];
    const source = node.childForFieldName("source");
    return source ? [source.text.replace(/['"]/g, "")] : [];
  }

  private isExported(node: Parser.SyntaxNode): boolean {
    const parent = node.parent;
    if (!parent) return false;
    return parent.type === "export_statement";
  }
}
