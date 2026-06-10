import { existsSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import process from "node:process";

export type EditBlock = {
  targetFile: string;
  searchBlock: string;
  replaceBlock: string;
};

const EDIT_BLOCK_PATTERN = /<<<<<<< SEARCH\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>> REPLACE/g;

function cleanTargetFile(value: string): string {
  return value
    .trim()
    .replace(/^[-*]\s*/, "")
    .replace(/^#+\s*/, "")
    .replace(/^`|`$/g, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}

function extractTargetFile(prefix: string): string | null {
  const lines = prefix
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-8)
    .reverse();

  for (const line of lines) {
    const labeled = line.match(/^(?:target_file|target file|file|path)\s*:\s*(.+)$/i);

    if (labeled?.[1]) {
      return cleanTargetFile(labeled[1]);
    }

    const codePath = line.match(/`([^`]+\.(?:ts|js|py|go|json|md|txt|css|html))`/i);

    if (codePath?.[1]) {
      return cleanTargetFile(codePath[1]);
    }

    if (/^[./\w-][./\w\s-]*\.(?:ts|js|py|go|json|md|txt|css|html)$/i.test(line)) {
      return cleanTargetFile(line);
    }
  }

  return null;
}

export function parseEditBlocks(response: string): EditBlock[] {
  const edits: EditBlock[] = [];

  for (const match of response.matchAll(EDIT_BLOCK_PATTERN)) {
    const targetFile = extractTargetFile(response.slice(0, match.index ?? 0));
    const searchBlock = match[1];
    const replaceBlock = match[2];

    if (!targetFile || searchBlock === undefined || replaceBlock === undefined) {
      continue;
    }

    edits.push({
      targetFile,
      searchBlock,
      replaceBlock,
    });
  }

  return edits;
}

function resolveTargetFile(targetFile: string): string {
  const root = process.cwd();
  const resolved = resolve(root, targetFile);
  const relativePath = relative(root, resolved);

  if (relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
    throw new Error(`Refusing to edit a file outside the workspace: ${targetFile}`);
  }

  return resolved;
}

function getClosestLines(source: string, searchBlock: string): string {
  const sourceLines = source.split(/\r?\n/);
  const searchLines = searchBlock.split(/\r?\n/);
  const windowSize = Math.max(1, searchLines.length);
  let bestStart = 0;
  let bestScore = -1;

  for (let index = 0; index < sourceLines.length; index += 1) {
    const window = sourceLines.slice(index, index + windowSize);
    let score = 0;

    for (let offset = 0; offset < windowSize; offset += 1) {
      const actual = window[offset] ?? "";
      const expected = searchLines[offset] ?? "";

      if (actual === expected) {
        score += 4;
      } else if (actual.trim() === expected.trim()) {
        score += 2;
      } else if (expected && actual.includes(expected.trim())) {
        score += 1;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestStart = index;
    }
  }

  const contextStart = Math.max(0, bestStart - 2);
  const contextEnd = Math.min(sourceLines.length, bestStart + windowSize + 2);

  return sourceLines
    .slice(contextStart, contextEnd)
    .map((line, index) => `${contextStart + index + 1}: ${line}`)
    .join("\n");
}

export async function applyEditBlock(edit: EditBlock): Promise<string | null> {
  const targetPath = resolveTargetFile(edit.targetFile);

  if (!existsSync(targetPath)) {
    return `Edit failed for ${edit.targetFile}: target file does not exist.`;
  }

  const source = await Bun.file(targetPath).text();

  if (!source.includes(edit.searchBlock)) {
    const closestLines = getClosestLines(source, edit.searchBlock);

    return `Edit failed for ${edit.targetFile}: SEARCH block did not match exactly.

Closest lines from the local file:
${closestLines}

Please return a corrected edit block using the exact current file contents.`;
  }

  const updated = source.replace(edit.searchBlock, edit.replaceBlock);

  await Bun.write(targetPath, updated);

  console.log(`Applied edit to ${relative(process.cwd(), targetPath)}`);
  return null;
}

export async function applyEditBlocks(response: string): Promise<string[]> {
  const edits = parseEditBlocks(response);
  const errors: string[] = [];

  for (const edit of edits) {
    const error = await applyEditBlock(edit).catch((reason: unknown) => {
      const message = reason instanceof Error ? reason.message : String(reason);

      return `Edit failed for ${edit.targetFile}: ${message}`;
    });

    if (error) {
      errors.push(error);
    }
  }

  return errors;
}
