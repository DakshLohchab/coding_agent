#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { createReadStream } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type EventRole = "user" | "assistant" | "system";

type EventType = "prompt" | "response" | "action" | "error";

type IgnoreRule = {
  baseDir: string;
  pattern: string;
  negated: boolean;
  dirOnly: boolean;
  anchored: boolean;
  hasSlash: boolean;
  regex: RegExp;
};

type RepoMapEntry = {
  file: string;
  symbols: string[];
};

const DB_PATH = process.env.AGENT_DB_PATH ?? "./agent-events.sqlite";
const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const BASE_URL = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
const API_KEY = process.env.OPENAI_API_KEY ?? process.env.OPENROUTER_API_KEY ?? "";
const ROOT_DIR = process.cwd();
const BASE_SYSTEM_PROMPT =
  process.env.AGENT_SYSTEM_PROMPT ??
  "You are a concise command-line coding agent. Help with programming tasks, explain tradeoffs, and ask clarifying questions when requirements are ambiguous.";
const MAX_HISTORY_MESSAGES = Number.parseInt(process.env.AGENT_MAX_HISTORY ?? "24", 10);
const REPO_MAP_TOKEN_BUDGET = Number.parseInt(process.env.AGENT_REPO_MAP_TOKENS ?? "1000", 10);
const REPO_MAP_CHAR_BUDGET = Math.max(1200, Math.floor((Number.isFinite(REPO_MAP_TOKEN_BUDGET) ? REPO_MAP_TOKEN_BUDGET : 1000) * 3.6));
const SUPPORTED_SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".py", ".go"]);
const ALWAYS_IGNORED_DIRS = new Set([".git", "node_modules", ".bun", "dist", "build", "coverage"]);
const TS_SYMBOL_PATTERNS = [
  /\bexport\s+(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/g,
  /\bclass\s+([A-Za-z_$][\w$]*)/g,
  /\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g,
  /\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g,
  /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/g,
  /^\s*(?:public\s+|private\s+|protected\s+|static\s+|async\s+|override\s+)*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*[:{]/g,
  /\bexport\s*\{\s*([^}]+)\s*\}/g,
];
const PY_SYMBOL_PATTERNS = [
  /^\s*class\s+([A-Za-z_][\w]*)\s*(?:\(([^)]*)\))?:/g,
  /^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(([^)]*)\)\s*(?:->\s*[^:]+)?:/g,
  /^\s*from\s+[\w.]+\s+import\s+(.+)$/g,
  /^\s*import\s+(.+)$/g,
];
const GO_SYMBOL_PATTERNS = [
  /^\s*type\s+([A-Z][\w]*)\s+(?:struct|interface)\b/g,
  /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)\s*\(([^)]*)\)/g,
  /^\s*var\s+([A-Z][\w]*)\b/g,
  /^\s*const\s+([A-Z][\w]*)\b/g,
];
let repoMap = "Repo Map: unavailable (scan has not completed).";

const db = new Database(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    type TEXT NOT NULL CHECK (type IN ('prompt', 'response', 'action', 'error')),
    content TEXT NOT NULL,
    metadata TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
`);

const insertEvent = db.query(`
  INSERT INTO events (role, type, content, metadata)
  VALUES ($role, $type, $content, $metadata)
`);

function appendEvent(role: EventRole, type: EventType, content: string, metadata: Record<string, unknown> = {}) {
  insertEvent.run({
    $role: role,
    $type: type,
    $content: content,
    $metadata: JSON.stringify(metadata),
  });
}

function systemPromptWithRepoMap() {
  return `${BASE_SYSTEM_PROMPT}\n\n${repoMap}\nUse this compact repository structure for orientation only; inspect files before making precise claims.`;
}

function recentConversation(): ChatMessage[] {
  const rows = db
    .query<{ role: EventRole; content: string }, []>(`
      SELECT role, content
      FROM events
      WHERE type IN ('prompt', 'response') AND role IN ('user', 'assistant')
      ORDER BY id DESC
      LIMIT ${Number.isFinite(MAX_HISTORY_MESSAGES) && MAX_HISTORY_MESSAGES > 0 ? MAX_HISTORY_MESSAGES : 24}
    `)
    .all()
    .reverse();

  return [{ role: "system", content: systemPromptWithRepoMap() }, ...rows.map((row) => ({ role: row.role as "user" | "assistant", content: row.content }))];
}

function toPosix(filePath: string) {
  return filePath.split(path.sep).join("/");
}

function escapeRegex(text: string) {
  return text.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegex(pattern: string, anchored: boolean, hasSlash: boolean) {
  const segments = pattern.split("/").filter(Boolean);
  const body = segments
    .map((segment) => {
      if (segment === "**") {
        return ".*";
      }
      return escapeRegex(segment).replace(/\*/g, "[^/]*").replace(/\\\?/g, "[^/]");
    })
    .join("/");

  if (anchored || hasSlash) {
    return new RegExp(`^${body}(?:/.*)?$`);
  }

  return new RegExp(`(^|/)${body}(?:/.*)?$`);
}

async function loadIgnoreRules(dir: string, rules: IgnoreRule[]) {
  try {
    const content = await readFile(path.join(dir, ".gitignore"), "utf8");
    const baseDir = toPosix(path.relative(ROOT_DIR, dir));

    for (const rawLine of content.split(/\r?\n/)) {
      let line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }

      const negated = line.startsWith("!");
      if (negated) {
        line = line.slice(1);
      }

      const dirOnly = line.endsWith("/");
      line = line.replace(/^\/+/, "").replace(/\/+$/, "");
      if (!line) {
        continue;
      }

      const anchored = rawLine.trim().replace(/^!/, "").startsWith("/");
      const hasSlash = line.includes("/");
      rules.push({ baseDir, pattern: line, negated, dirOnly, anchored, hasSlash, regex: globToRegex(line, anchored, hasSlash) });
    }
  } catch {
    // Directory has no .gitignore or it cannot be read; continue scanning.
  }
}

function isIgnored(relativePath: string, isDirectory: boolean, rules: IgnoreRule[]) {
  const normalized = toPosix(relativePath).replace(/^\.\//, "");
  const name = path.posix.basename(normalized);

  if (isDirectory && ALWAYS_IGNORED_DIRS.has(name)) {
    return true;
  }

  let ignored = false;
  for (const rule of rules) {
    const base = rule.baseDir ? `${rule.baseDir}/` : "";
    if (base && normalized !== rule.baseDir && !normalized.startsWith(base)) {
      continue;
    }

    const scopedPath = base ? normalized.slice(base.length) : normalized;
    if (!scopedPath) {
      continue;
    }

    const matches = rule.regex.test(scopedPath);
    if (matches && (!rule.dirOnly || isDirectory || scopedPath.includes("/"))) {
      ignored = !rule.negated;
    }
  }

  return ignored;
}

function compactParams(params = "") {
  const cleaned = params.replace(/\s+/g, " ").trim();
  return cleaned.length > 60 ? `${cleaned.slice(0, 57)}...` : cleaned;
}

function extractSymbolsFromLine(file: string, line: string) {
  const ext = path.extname(file);
  const patterns = ext === ".py" ? PY_SYMBOL_PATTERNS : ext === ".go" ? GO_SYMBOL_PATTERNS : TS_SYMBOL_PATTERNS;
  const symbols: string[] = [];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of line.matchAll(pattern)) {
      const [full, name, params] = match;
      if (!name) {
        continue;
      }

      if (full.includes("import ")) {
        symbols.push(`import ${compactParams(name)}`);
      } else if (full.includes("export {") || full.trim().startsWith("export {")) {
        symbols.push(`export {${compactParams(name)}}`);
      } else if (/\bclass\b|\bstruct\b|\binterface\b/.test(full) || full.trim().startsWith("type ")) {
        symbols.push(`class ${name}`);
      } else if (params !== undefined) {
        symbols.push(`${name}(${compactParams(params)})`);
      } else {
        symbols.push(name);
      }
    }
  }

  return symbols;
}

async function scanSourceFile(filePath: string, relativeFile: string) {
  const symbols: string[] = [];
  const seen = new Set<string>();
  const lines = createInterface({ input: createReadStream(filePath, { encoding: "utf8" }), crlfDelay: Infinity });

  try {
    for await (const line of lines) {
      for (const symbol of extractSymbolsFromLine(relativeFile, line)) {
        if (!seen.has(symbol)) {
          seen.add(symbol);
          symbols.push(symbol);
        }

        if (symbols.length >= 12) {
          lines.close();
          break;
        }
      }
    }
  } catch {
    return null;
  }

  return { file: relativeFile, symbols } satisfies RepoMapEntry;
}

async function collectSourceFiles(dir: string, rules: IgnoreRule[], files: string[] = []) {
  await loadIgnoreRules(dir, rules);
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(ROOT_DIR, fullPath);
    if (isIgnored(relativePath, entry.isDirectory(), rules)) {
      continue;
    }

    if (entry.isDirectory()) {
      await collectSourceFiles(fullPath, rules, files);
    } else if (entry.isFile() && SUPPORTED_SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(toPosix(relativePath));
    }
  }

  return files;
}

function compressRepoMap(entries: RepoMapEntry[]) {
  const header = `Repo Map (${entries.length} source files; symbols only, no raw source):`;
  const lines = [header];
  let used = header.length + 1;

  for (const entry of entries.sort((a, b) => a.file.localeCompare(b.file))) {
    const symbolText = entry.symbols.length ? ` :: ${entry.symbols.join("; ")}` : "";
    let line = `- ${entry.file}${symbolText}`;
    if (line.length > 220) {
      line = `${line.slice(0, 217)}...`;
    }

    if (used + line.length + 1 > REPO_MAP_CHAR_BUDGET) {
      lines.push(`- ... ${entries.length - lines.length + 1} more files omitted to stay under ${REPO_MAP_TOKEN_BUDGET} tokens`);
      break;
    }

    lines.push(line);
    used += line.length + 1;
  }

  return lines.join("\n");
}

async function buildRepoMap() {
  try {
    const files = await collectSourceFiles(ROOT_DIR, []);
    const entries: RepoMapEntry[] = [];

    for (const relativeFile of files) {
      const entry = await scanSourceFile(path.join(ROOT_DIR, relativeFile), relativeFile);
      if (entry) {
        entries.push(entry);
      }
    }

    repoMap = compressRepoMap(entries);
    appendEvent("system", "action", "Workspace repo map refreshed.", { files: entries.length, charLength: repoMap.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    repoMap = `Repo Map: unavailable (${message})`;
    appendEvent("system", "error", "Workspace repo map scan failed.", { error: message });
  }
}

function write(text: string) {
  process.stdout.write(text);
}

function prompt() {
  write("\nagent> ");
}

function printHelp() {
  write(`
Commands:
  /help        Show this help
  /history     Print recent stored conversation events
  /map         Refresh and print the compact workspace Repo Map
  /clear       Clear terminal output only (database remains append-only)
  /exit        Quit

Environment:
  OPENAI_API_KEY          Required for OpenAI-compatible APIs
  OPENAI_MODEL            Defaults to ${MODEL}
  OPENAI_BASE_URL         Current base URL: ${BASE_URL}
  AGENT_DB_PATH           Defaults to ${DB_PATH}
  AGENT_SYSTEM_PROMPT     Override the system prompt
  AGENT_REPO_MAP_TOKENS   Repo Map budget, defaults to ${REPO_MAP_TOKEN_BUDGET}
`);
}

function printHistory() {
  const rows = db
    .query<{ id: number; created_at: string; role: string; type: string; content: string }, []>(`
      SELECT id, created_at, role, type, content
      FROM events
      ORDER BY id DESC
      LIMIT 20
    `)
    .all()
    .reverse();

  if (rows.length === 0) {
    write("No events stored yet.\n");
    return;
  }

  for (const row of rows) {
    const preview = row.content.length > 500 ? `${row.content.slice(0, 500)}…` : row.content;
    write(`[${row.id}] ${row.created_at} ${row.role}/${row.type}\n${preview}\n\n`);
  }
}

async function* sseChunks(response: Response): AsyncGenerator<string> {
  if (!response.body) {
    throw new Error("The API response did not include a readable stream.");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      for (const line of part.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data:")) {
          yield trimmed.slice(5).trim();
        }
      }
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    for (const line of buffer.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("data:")) {
        yield trimmed.slice(5).trim();
      }
    }
  }
}

async function streamCompletion(messages: ChatMessage[]): Promise<string> {
  if (!API_KEY) {
    throw new Error("Missing OPENAI_API_KEY. Set OPENAI_BASE_URL too if you are using an OpenAI-compatible provider such as OpenRouter.");
  }

  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "http://localhost",
      "X-Title": process.env.OPENROUTER_APP_NAME ?? "single-file-bun-coding-agent",
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      stream: true,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API request failed: ${response.status} ${response.statusText}\n${body}`);
  }

  let fullText = "";

  for await (const data of sseChunks(response)) {
    if (data === "[DONE]") {
      break;
    }

    try {
      const event = JSON.parse(data);
      const delta = event.choices?.[0]?.delta?.content ?? "";
      if (delta) {
        fullText += delta;
        write(delta);
      }
    } catch {
      // Ignore non-JSON keepalive frames from compatible providers.
    }
  }

  return fullText;
}

async function handleInput(input: string) {
  const text = input.trim();
  if (!text) {
    return;
  }

  if (text === "/exit" || text === "/quit") {
    appendEvent("system", "action", "User exited the CLI.");
    write("Goodbye.\n");
    db.close();
    process.exit(0);
  }

  if (text === "/help") {
    appendEvent("system", "action", "Displayed help text.");
    printHelp();
    return;
  }

  if (text === "/history") {
    appendEvent("system", "action", "Displayed recent event history.");
    printHistory();
    return;
  }

  if (text === "/map") {
    appendEvent("system", "action", "User requested Repo Map refresh.");
    await buildRepoMap();
    write(`${repoMap}\n`);
    return;
  }

  if (text === "/clear") {
    appendEvent("system", "action", "Cleared terminal output.");
    write("\x1Bc");
    return;
  }

  appendEvent("user", "prompt", text, { model: MODEL, baseUrl: BASE_URL, repoMapLength: repoMap.length });
  write("\n");

  try {
    const responseText = await streamCompletion(recentConversation());
    write("\n");
    appendEvent("assistant", "response", responseText, { model: MODEL, baseUrl: BASE_URL });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendEvent("system", "error", message, { model: MODEL, baseUrl: BASE_URL });
    write(`\nError: ${message}\n`);
  }
}

appendEvent("system", "action", "CLI started.", { model: MODEL, baseUrl: BASE_URL, dbPath: DB_PATH });
await buildRepoMap();
write(`Single-file Bun coding agent\nModel: ${MODEL}\nDatabase: ${DB_PATH}\nRepo Map: ${repoMap.length} chars\nType /help for commands, /exit to quit.\n`);
prompt();

let inputBuffer = "";
let busy = Promise.resolve();

process.stdin.setEncoding("utf8");
process.stdin.resume();
process.stdin.on("data", (chunk) => {
  inputBuffer += chunk;
  const lines = inputBuffer.split(/\r?\n/);
  inputBuffer = lines.pop() ?? "";

  for (const line of lines) {
    busy = busy
      .then(() => handleInput(line))
      .finally(() => prompt());
  }
});

process.stdin.on("end", async () => {
  busy = busy.then(async () => {
    if (inputBuffer.trim()) {
      await handleInput(inputBuffer);
    }
    appendEvent("system", "action", "stdin ended; CLI stopped.");
    db.close();
  });

  await busy;
});

process.on("SIGINT", () => {
  appendEvent("system", "action", "Received SIGINT; CLI stopped.");
  write("\nInterrupted. Goodbye.\n");
  db.close();
  process.exit(0);
});
