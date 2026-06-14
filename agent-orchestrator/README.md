# OpenClaw (Local CoderCore Agent Orchestrator)

A highly robust, headless terminal daemon integrated directly into an isolated local OS execution environment for autonomous software engineering. Built as an extensible multi-agent orchestration framework, it can understand prompts, analyze codebases using RAG, architect solutions, execute code generation, and verify implementations natively.

## Features

- **Multi-Agent Architecture:**
  - 🧠 **Thinking Agent:** Discovers context edge cases and provides deep structural reasoning before planning.
  - 🗺️ **Planning Agent:** Creates rigid, step-by-step execution strategies.
  - 🏗️ **Architect Agent:** Analyzes prompts and repository structures to output exact file diff strategies.
  - ⚡ **Execution Agent:** Generates raw, precise code modifications and executes native toolchains.
  - 🔨 **Building Agent:** Compiles project assets and verifies dependencies natively.
  - ✅ **Verification Agent:** Runs local syntax checks, compilation tests, or test suites to ensure correctness.
  - 🗣️ **Debate Agent:** Cross-examines alternative strategies internally if verification fails.

- **Advanced RAG Engine:** Uses ChromaDB and Tree-sitter AST parsing to search and embed semantic dependencies across your local codebase, giving the agents deep context over large projects.

- **Cross-Platform Native Shell:** Executes commands directly via `/bin/bash` or `powershell.exe`, with detached background process support for long-running dev servers.

- **Surgical File Operations:** Bypasses error-prone LLM shell scripting (`echo`) via dedicated, native Node.js tools:
  - `write_file`
  - `read_file`
  - `patch_file`
  - `make_directory`

- **LLM Provider Agnostic:** Fully supports multiple top-tier models directly via API:
  - Gemini API (`gemini-2.0-flash` or custom models)
  - Anthropic Claude (`claude-3-7-sonnet` etc.)
  - OpenAI (`gpt-4o`, `o1`, etc.)
  - OpenRouter

- **Terminal UI:** Beautiful, reactive terminal interface powered by [Ink](https://github.com/vadimdemedes/ink) and React.

## Installation

Ensure you have [Node.js](https://nodejs.org/) installed (v18+ recommended).

```bash
# Clone the repository
git clone https://github.com/yourusername/agent-orchestrator.git
cd agent-orchestrator

# Install dependencies
npm install

# Build the project
npm run build

# Link the CLI globally (optional)
npm link
```

## Setup & Configuration

Run the configuration wizard to securely add your LLM API keys:

```bash
ca2026 # or `npm start`
```

The wizard will prompt you to select your preferred LLM provider, enter your API key, and optionally specify a model name. Configurations are safely stored in your home directory (`~/.ca2026rc`).

## Skills System

The orchestrator utilizes a dynamic "Skills" engine allowing you to define exactly how the agent should tackle specific frameworks or languages. 
Place markdown files in the `skills/` directory (e.g., `create-react-app.md` or `machine-learning.md`) to automatically inject execution patterns and best practices into the agent's context when it parses related intents.

## Architecture & Under the Hood

- **State Machine Engine:** Built entirely on **XState v5**, providing a bulletproof, deterministic state loop (`idle -> thinking -> planning -> architecting -> executing -> building -> verifying -> debating`).
- **Dependency Injection:** Utilizes **TSyringe** for modular decoupling of agents, logging, and tools.
- **Context Compression:** A sliding-window ContextCompressor ensures the orchestrator never crashes due to LLM token budget overflows during extensive multi-file edits.

## License

ISC License. See `package.json` for details.
