import { Database } from "bun:sqlite";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { applyEditBlocks } from "./editor";
import { generateRepoMap } from "./scanner";

type ChatRole = "user" | "assistant";

type ChatMessage = {
  role: ChatRole;
  content: string;
};

type Provider = "anthropic" | "openai";

const db = new Database("agent.sqlite");
const MAX_EDIT_RETRIES = 2;

function initializeDatabase(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS conversation_logs (
      id INTEGER PRIMARY KEY,
      role TEXT,
      content TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function saveMessage(role: ChatRole, content: string): void {
  db.query("INSERT INTO conversation_logs (role, content) VALUES (?, ?)").run(role, content);
}

function getRecentMessages(limit = 10): ChatMessage[] {
  const rows = db
    .query("SELECT role, content FROM conversation_logs ORDER BY id DESC LIMIT ?")
    .all(limit) as ChatMessage[];

  return rows.reverse();
}

function getProvider(): Provider | null {
  if (process.env.ANTHROPIC_API_KEY) {
    return "anthropic";
  }

  if (process.env.OPENAI_API_KEY) {
    return "openai";
  }

  return null;
}

function buildSystemPrompt(repoMap: string): string {
  return `You are a lightweight AI coding agent. Use this compact repository map for local codebase context.

When modifying files, do not rewrite entire files. You MUST output targeted edit blocks only.
State the target file path clearly immediately above each block, using this format:

target_file: path/to/file.ts
<<<<<<< SEARCH
[exact lines of code currently in the file to be replaced]
=======
[the new lines of code]
>>>>>>> REPLACE

The SEARCH section must match the current file contents exactly, including indentation and blank lines.
If multiple edits are needed, emit one block per replacement.

<repo_map>
${repoMap}
</repo_map>`;
}

function buildRequest(provider: Provider, messages: ChatMessage[], repoMap: string): Request {
  const system = buildSystemPrompt(repoMap);

  if (provider === "anthropic") {
    return new Request("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        stream: true,
        system,
        messages,
      }),
    });
  }

  return new Request("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-4o",
      stream: true,
      messages: [{ role: "system", content: system }, ...messages],
    }),
  });
}

function extractText(provider: Provider, payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const data = payload as Record<string, any>;

  if (provider === "anthropic") {
    if (data.type === "content_block_delta" && data.delta?.type === "text_delta") {
      return data.delta.text ?? "";
    }

    return "";
  }

  return data.choices?.[0]?.delta?.content ?? "";
}

function parseSseFrame(provider: Provider, frame: string, onText: (text: string) => void): boolean {
  const lines = frame.split(/\r?\n/);
  const dataLines = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());

  if (dataLines.length === 0) {
    return false;
  }

  const eventData = dataLines.join("\n");

  if (eventData === "[DONE]") {
    return true;
  }

  try {
    const payload = JSON.parse(eventData);

    if (payload?.type === "error") {
      throw new Error(payload.error?.message ?? "LLM stream returned an error event.");
    }

    const text = extractText(provider, payload);

    if (text) {
      onText(text);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse LLM stream event: ${message}`);
  }

  return false;
}

async function streamSse(
  response: Response,
  provider: Provider,
  onText: (text: string) => void,
): Promise<void> {
  if (!response.body) {
    throw new Error("LLM response did not include a readable stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      if (parseSseFrame(provider, frame, onText)) {
        return;
      }
    }
  }

  buffer += decoder.decode();

  if (buffer.trim() && parseSseFrame(provider, buffer, onText)) {
    return;
  }
}

function buildEditCorrectionPrompt(errors: string[]): string {
  return `One or more edit blocks failed to apply. Use the closest local lines below to correct the SEARCH block exactly. Return only corrected edit blocks with target_file lines.

${errors.join("\n\n")}`;
}

export async function callLLM(prompt: string, editRetryCount = 0): Promise<string> {
  const provider = getProvider();

  if (!provider) {
    console.error("Missing API key. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.");
    return "";
  }

  saveMessage("user", prompt);

  const messages = getRecentMessages(10);
  const repoMap = await generateRepoMap(process.cwd());
  const request = buildRequest(provider, messages, repoMap);
  const response = await fetch(request);

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`LLM request failed (${response.status} ${response.statusText}): ${body}`);
  }

  let assistantResponse = "";

  await streamSse(response, provider, (text) => {
    assistantResponse += text;
    process.stdout.write(text);
  });

  process.stdout.write("\n");

  if (assistantResponse.trim()) {
    saveMessage("assistant", assistantResponse);
  }

  const editErrors = await applyEditBlocks(assistantResponse);

  if (editErrors.length > 0 && editRetryCount < MAX_EDIT_RETRIES) {
    return callLLM(buildEditCorrectionPrompt(editErrors), editRetryCount + 1);
  }

  if (editErrors.length > 0) {
    console.error("Edit blocks still failed after retry limit:");
    console.error(editErrors.join("\n\n"));
  }

  return assistantResponse;
}

async function main(): Promise<void> {
  initializeDatabase(db);

  console.log("Lightweight Agent Initialized");

  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
  });

  terminal.prompt();

  for await (const line of terminal) {
    const prompt = line.trim();

    if (!prompt) {
      terminal.prompt();
      continue;
    }

    if (prompt === "/exit" || prompt === "/quit") {
      break;
    }

    try {
      await callLLM(prompt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
    }

    terminal.prompt();
  }

  terminal.close();
  db.close();
}

process.on("SIGINT", () => {
  process.stdout.write("\n");
  db.close();
  process.exit(0);
});

await main();
