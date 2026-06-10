#!/usr/bin/env bun
import { Database } from "bun:sqlite";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type EventRole = "user" | "assistant" | "system";

type EventType = "prompt" | "response" | "action" | "error";

const DB_PATH = process.env.AGENT_DB_PATH ?? "./agent-events.sqlite";
const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const BASE_URL = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
const API_KEY = process.env.OPENAI_API_KEY ?? process.env.OPENROUTER_API_KEY ?? "";
const SYSTEM_PROMPT =
  process.env.AGENT_SYSTEM_PROMPT ??
  "You are a concise command-line coding agent. Help with programming tasks, explain tradeoffs, and ask clarifying questions when requirements are ambiguous.";
const MAX_HISTORY_MESSAGES = Number.parseInt(process.env.AGENT_MAX_HISTORY ?? "24", 10);

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

  return [{ role: "system", content: SYSTEM_PROMPT }, ...rows.map((row) => ({ role: row.role as "user" | "assistant", content: row.content }))];
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
  /clear       Clear terminal output only (database remains append-only)
  /exit        Quit

Environment:
  OPENAI_API_KEY       Required for OpenAI-compatible APIs
  OPENAI_MODEL         Defaults to ${MODEL}
  OPENAI_BASE_URL      Current base URL: ${BASE_URL}
  AGENT_DB_PATH        Defaults to ${DB_PATH}
  AGENT_SYSTEM_PROMPT  Override the system prompt
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

  if (text === "/clear") {
    appendEvent("system", "action", "Cleared terminal output.");
    write("\x1Bc");
    return;
  }

  appendEvent("user", "prompt", text, { model: MODEL, baseUrl: BASE_URL });
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
write(`Single-file Bun coding agent\nModel: ${MODEL}\nDatabase: ${DB_PATH}\nType /help for commands, /exit to quit.\n`);
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
  if (inputBuffer.trim()) {
    await handleInput(inputBuffer);
  }
  appendEvent("system", "action", "stdin ended; CLI stopped.");
  db.close();
});

process.on("SIGINT", () => {
  appendEvent("system", "action", "Received SIGINT; CLI stopped.");
  write("\nInterrupted. Goodbye.\n");
  db.close();
  process.exit(0);
});
