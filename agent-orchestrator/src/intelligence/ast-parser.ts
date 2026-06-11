import { injectable } from 'tsyringe';
import * as fs from 'fs';
import { createRequire } from 'module';

// Use Node's `createRequire` so this module can run as ESM while still
// loading CommonJS-style packages that expect `require`.
const require = createRequire(import.meta.url);
const Parser = require('tree-sitter');
const tsGrammar = require('tree-sitter-typescript').typescript;

export interface ASTNodeData {
  id: string;
  type: 'class' | 'method' | 'function' | 'import' | 'export' | 'interface';
  name: string;
  code: string;
  startLine: number;
  endLine: number;
  parentClass?: string;
  fileImports?: string[];
}

export interface ParsedFile {
  filePath: string;
  imports: string[];
  nodes: ASTNodeData[];
}

@injectable()
export class ASTParser {
  private parser: any;

  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(tsGrammar);
  }

  public parseFile(filePath: string): ParsedFile {
    const code = fs.readFileSync(filePath, 'utf8');
    let tree: any;
    try {
      tree = this.parser.parse(code);
    } catch (err) {
      // Tree-sitter may throw for very large or unsupported .d.ts/type files.
      // Return an empty parsed result so indexer can continue.
      return { filePath, imports: [], nodes: [] };
    }
    const nodes: ASTNodeData[] = [];
    const imports: string[] = [];

    // Pre-collect top-level imports for graph linking
    const collectImports = (node: any) => {
      if (node.type === 'import_statement') {
        imports.push(node.text);
      }
      for (const child of node.namedChildren) {
        collectImports(child);
      }
    };
    collectImports(tree.rootNode);

    // Context-aware DFS traversal
    const traverse = (node: any, currentClass?: string) => {
      let nextClass = currentClass;

      if (node.type === 'class_declaration' || node.type === 'interface_declaration') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          nextClass = nameNode.text;
          nodes.push({
            id: `${filePath}_${node.type}_${nextClass}`,
            type: node.type === 'class_declaration' ? 'class' : 'interface',
            name: nextClass,
            code: node.text,
            startLine: node.startPosition.row,
            endLine: node.endPosition.row,
            fileImports: imports // Attach global file scopes to the class
          });
        }
      } else if (node.type === 'method_definition' || node.type === 'function_declaration') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          const type = node.type === 'method_definition' ? 'method' : 'function';
          nodes.push({
            id: `${filePath}_${type}_${currentClass ? currentClass + '_' : ''}${nameNode.text}`,
            type: type,
            name: nameNode.text,
            code: node.text,
            startLine: node.startPosition.row,
            endLine: node.endPosition.row,
            parentClass: currentClass, // Graph relationship: BelongsToClass
            fileImports: imports       // Graph relationship: RequiresImports
          });
        }
      } else if (node.type === 'import_statement') {
        nodes.push({
          id: `${filePath}_import_${node.startPosition.row}`,
          type: 'import',
          name: 'import',
          code: node.text,
          startLine: node.startPosition.row,
          endLine: node.endPosition.row,
        });
      } else if (node.type === 'export_statement') {
        nodes.push({
          id: `${filePath}_export_${node.startPosition.row}`,
          type: 'export',
          name: 'export',
          code: node.text,
          startLine: node.startPosition.row,
          endLine: node.endPosition.row,
        });
      }

      for (const child of node.namedChildren) {
        traverse(child, nextClass);
      }
    };

    traverse(tree.rootNode);

    return { filePath, imports, nodes };
  }

  /**
   * Pre-flight Syntax Gatekeeper method.
   * Parses a raw virtual code string and recursively scans for AST 'ERROR' nodes.
   */
  public validateSyntax(code: string): { valid: boolean; errors: string[] } {
    const tree = this.parser.parse(code);
    const errors: string[] = [];

    const traverse = (node: any) => {
      // tree-sitter flags invalid syntax as 'ERROR' nodes or 'MISSING' nodes
      if (node.type === 'ERROR' || node.isMissing) {
        const errorMsg = `Syntax Error at line ${node.startPosition.row + 1}, column ${node.startPosition.column}: Unexpected token or missing block.`;
        errors.push(errorMsg);
      }
      
      for (const child of node.namedChildren) {
        traverse(child);
      }
    };

    traverse(tree.rootNode);

    return {
      valid: errors.length === 0,
      errors
    };
  }
}
