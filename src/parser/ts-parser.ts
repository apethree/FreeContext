import Parser from "tree-sitter";
import TypeScript from "tree-sitter-typescript";
import JavaScript from "tree-sitter-javascript";
import type {
  LanguageParser,
  ParsedImportBinding,
  ParsedSymbol,
  SymbolKind,
} from "../types/index.js";

const PARSER_VERSION = "1.0.0";
const TREE_SITTER_STRING_PARSE_LIMIT = 32_768;
const TREE_SITTER_FALLBACK_BUFFER_SIZE = 1_024;

export class TreeSitterParser implements LanguageParser {
  readonly supportedExtensions = [".ts", ".tsx", ".js", ".jsx"];
  readonly parserVersion = PARSER_VERSION;

  private tsParser: Parser;
  private tsxParser: Parser;
  private jsParser: Parser;

  constructor() {
    this.tsParser = new Parser();
    this.tsParser.setLanguage(TypeScript.typescript as unknown as Parameters<Parser["setLanguage"]>[0]);

    this.tsxParser = new Parser();
    this.tsxParser.setLanguage(TypeScript.tsx as unknown as Parameters<Parser["setLanguage"]>[0]);

    this.jsParser = new Parser();
    this.jsParser.setLanguage(JavaScript as unknown as Parameters<Parser["setLanguage"]>[0]);
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
    const tree =
      content.length >= TREE_SITTER_STRING_PARSE_LIMIT
        ? parser.parse(
            this.createLineInput(content),
            undefined,
            { bufferSize: TREE_SITTER_FALLBACK_BUFFER_SIZE }
          )
        : parser.parse(content);
    const symbols: ParsedSymbol[] = [];

    this.walkNode(tree.rootNode, symbols);
    return symbols;
  }

  private createLineInput(content: string): Parser.Input {
    const lines = content
      .split("\n")
      .map((line, index, source) => (index < source.length - 1 ? `${line}\n` : line));

    return (index, position) => {
      if (!position) {
        return content.slice(index, index + TREE_SITTER_FALLBACK_BUFFER_SIZE);
      }

      const line = lines[position.row];
      return line ? line.slice(position.column) : null;
    };
  }

  private walkNode(node: Parser.SyntaxNode, symbols: ParsedSymbol[]): void {
    const sym = this.extractSymbol(node);
    if (sym) symbols.push(sym);

    for (const child of node.children) {
      this.walkNode(child, symbols);
    }
  }

  private extractSymbol(node: Parser.SyntaxNode): ParsedSymbol | null {
    const kind = this.nodeToKind(node);
    if (!kind) return null;

    const name = this.extractName(node, kind);
    if (!name) return null;

    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const rawText = node.text;
    const calls = this.extractCalls(node);
    const imports = this.extractImports(node);
    const importBindings = this.extractImportBindings(node);
    const exports = this.extractExports(node, name);
    const extendsTypes = this.extractExtendsTypes(node);
    const implementsTypes = this.extractImplementsTypes(node);

    return {
      symbolName: name,
      symbolKind: kind,
      startLine,
      endLine,
      rawText,
      imports,
      importBindings,
      exports,
      calls,
      extendsTypes,
      implementsTypes,
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

  private extractImportBindings(node: Parser.SyntaxNode): ParsedImportBinding[] {
    if (node.type !== "import_statement") {
      return [];
    }

    const source = node.childForFieldName("source")?.text.replace(/['"]/g, "");
    if (!source) {
      return [];
    }

    const clause = node.children.find((child) => child.type === "import_clause");
    if (!clause) {
      return [];
    }

    const bindings: ParsedImportBinding[] = [];

    for (const child of clause.children) {
      if (child.type === "identifier") {
        bindings.push({
          source,
          importedName: "default",
          localName: child.text,
        });
      }

      if (child.type === "namespace_import") {
        const localName = child.children.at(-1)?.text;
        if (localName) {
          bindings.push({
            source,
            importedName: "*",
            localName,
          });
        }
      }

      if (child.type === "named_imports") {
        for (const specifier of child.children) {
          if (specifier.type !== "import_specifier") {
            continue;
          }

          const identifiers = specifier.children.filter((grandchild) =>
            grandchild.type === "identifier" || grandchild.type === "type_identifier"
          );
          const importedName = identifiers[0]?.text;
          const localName = identifiers.at(-1)?.text;
          if (importedName && localName) {
            bindings.push({
              source,
              importedName,
              localName,
            });
          }
        }
      }
    }

    return bindings;
  }

  private extractExtendsTypes(node: Parser.SyntaxNode): string[] {
    if (node.type === "class_declaration") {
      const heritage = node.children.find((child) => child.type === "class_heritage");
      if (!heritage) {
        return [];
      }
      const extendsClause = heritage.children.find((child) => child.type === "extends_clause");
      return extendsClause ? this.extractTypeNames(extendsClause) : [];
    }

    if (node.type === "interface_declaration") {
      const extendsClause = node.children.find((child) => child.type === "extends_type_clause");
      return extendsClause ? this.extractTypeNames(extendsClause) : [];
    }

    return [];
  }

  private extractImplementsTypes(node: Parser.SyntaxNode): string[] {
    if (node.type !== "class_declaration") {
      return [];
    }

    const heritage = node.children.find((child) => child.type === "class_heritage");
    if (!heritage) {
      return [];
    }

    const implementsClause = heritage.children.find((child) => child.type === "implements_clause");
    return implementsClause ? this.extractTypeNames(implementsClause) : [];
  }

  private extractTypeNames(node: Parser.SyntaxNode): string[] {
    const names = node.children
      .filter((child) => child.type === "identifier" || child.type === "type_identifier")
      .map((child) => child.text);
    return [...new Set(names)];
  }

  private isExported(node: Parser.SyntaxNode): boolean {
    const parent = node.parent;
    if (!parent) return false;
    return parent.type === "export_statement";
  }

  private extractExports(node: Parser.SyntaxNode, name: string): string[] {
    if (!this.isExported(node)) {
      return [];
    }

    const exports = [name];
    const parent = node.parent;
    if (parent?.children.some((child) => child.type === "default")) {
      exports.push("default");
    }

    return exports;
  }
}
