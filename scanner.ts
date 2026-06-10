import { readdir } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build"]);
const SUPPORTED_EXTENSIONS = new Set([".ts", ".js", ".py", ".go"]);
const MAX_SIGNATURES_PER_FILE = 24;
const MAX_MAP_CHARS = 6_000;

type SignaturePattern = {
  label: string;
  pattern: RegExp;
};

const SIGNATURE_PATTERNS: Record<string, SignaturePattern[]> = {
  ".ts": [
    { label: "class", pattern: /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/gm },
    { label: "interface", pattern: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/gm },
    { label: "type", pattern: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/gm },
    {
      label: "function",
      pattern: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm,
    },
    { label: "const", pattern: /^\s*export\s+const\s+([A-Za-z_$][\w$]*)/gm },
  ],
  ".js": [
    { label: "class", pattern: /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/gm },
    {
      label: "function",
      pattern: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm,
    },
    { label: "const", pattern: /^\s*export\s+const\s+([A-Za-z_$][\w$]*)/gm },
  ],
  ".py": [
    { label: "class", pattern: /^\s*class\s+([A-Za-z_]\w*)/gm },
    { label: "function", pattern: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/gm },
  ],
  ".go": [
    { label: "type", pattern: /^\s*type\s+([A-Za-z_]\w*)\s+(?:struct|interface)\b/gm },
    { label: "function", pattern: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/gm },
    { label: "var", pattern: /^\s*var\s+([A-Za-z_]\w*)/gm },
    { label: "const", pattern: /^\s*const\s+([A-Za-z_]\w*)/gm },
  ],
};

type RepoFile = {
  path: string;
  signatures: string[];
};

function shouldIgnoreDir(name: string): boolean {
  return IGNORED_DIRS.has(name) || name.startsWith(".");
}

async function walk(dir: string, root: string, files: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!shouldIgnoreDir(entry.name)) {
          await walk(fullPath, root, files);
        }

        return;
      }

      if (entry.isFile() && SUPPORTED_EXTENSIONS.has(extname(entry.name))) {
        files.push(relative(root, fullPath).split(sep).join("/"));
      }
    }),
  );
}

function extractSignatures(extension: string, source: string): string[] {
  const patterns = SIGNATURE_PATTERNS[extension] ?? [];
  const signatures: Array<{ index: number; text: string }> = [];

  for (const { label, pattern } of patterns) {
    pattern.lastIndex = 0;

    for (const match of source.matchAll(pattern)) {
      const name = match[1];

      if (!name) {
        continue;
      }

      signatures.push({
        index: match.index ?? 0,
        text: `${label} ${name}`,
      });

      if (signatures.length >= MAX_SIGNATURES_PER_FILE) {
        break;
      }
    }
  }

  return signatures
    .sort((a, b) => a.index - b.index)
    .slice(0, MAX_SIGNATURES_PER_FILE)
    .map((signature) => signature.text);
}

async function scanFile(root: string, path: string): Promise<RepoFile | null> {
  const fullPath = join(root, path);
  const source = await Bun.file(fullPath).text();
  const signatures = extractSignatures(extname(path), source);

  if (signatures.length === 0) {
    return null;
  }

  return { path, signatures };
}

function formatRepoMap(files: RepoFile[]): string {
  const lines = ["# Repository Map"];

  for (const file of files) {
    lines.push(`- ${file.path}`);

    for (const signature of file.signatures) {
      lines.push(`  - ${signature}`);
    }
  }

  let output = lines.join("\n");

  if (output.length > MAX_MAP_CHARS) {
    output = `${output.slice(0, MAX_MAP_CHARS)}\n- ...repo map truncated`;
  }

  return output;
}

export async function generateRepoMap(dir: string): Promise<string> {
  const files: string[] = [];

  await walk(dir, dir, files);

  const scannedFiles = await Promise.all(files.sort().map((file) => scanFile(dir, file)));
  const mappedFiles = scannedFiles.filter((file): file is RepoFile => file !== null);

  if (mappedFiles.length === 0) {
    return "# Repository Map\n- No structural signatures found.";
  }

  return formatRepoMap(mappedFiles);
}
