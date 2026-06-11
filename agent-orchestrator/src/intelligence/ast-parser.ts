import { injectable } from 'tsyringe';
import * as fs from 'fs';

const Parser = require('tree-sitter');
const tsGrammar = require('tree-sitter-typescript').typescript;

export interface ASTNodeData {
  type: 'class' | 'method' | 'import' | 'export';
  name: string;
  code: string;
  startLine: number;
  endLine: number;
}

export interface ParsedFile {
  filePath: string;
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
    const tree = this.parser.parse(code);
    const nodes: ASTNodeData[] = [];

    // Simple tree traversal to extract classes, methods, imports, and exports
    const traverse = (node: any) => {
      if (node.type === 'class_declaration') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          nodes.push({
            type: 'class',
            name: nameNode.text,
            code: node.text,
            startLine: node.startPosition.row,
            endLine: node.endPosition.row,
          });
        }
      } else if (node.type === 'method_definition') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          nodes.push({
            type: 'method',
            name: nameNode.text,
            code: node.text,
            startLine: node.startPosition.row,
            endLine: node.endPosition.row,
          });
        }
      } else if (node.type === 'import_statement') {
        nodes.push({
          type: 'import',
          name: 'import',
          code: node.text,
          startLine: node.startPosition.row,
          endLine: node.endPosition.row,
        });
      } else if (node.type === 'export_statement') {
        nodes.push({
          type: 'export',
          name: 'export',
          code: node.text,
          startLine: node.startPosition.row,
          endLine: node.endPosition.row,
        });
      }

      for (const child of node.namedChildren) {
        traverse(child);
      }
    };

    traverse(tree.rootNode);

    return { filePath, nodes };
  }
}
