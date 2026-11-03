# Agentic Coding Assistant

An AI-powered coding assistant that works directly inside your terminal to understand, modify, and manage software projects. Built with **TypeScript, LangChain, and OpenRouter**, it uses an LLM-driven agent loop and a collection of file-system and terminal tools to perform coding tasks.

The agent can generate code snippets, inspect project files, search code, make changes, execute shell commands, and maintain persistent conversation history across sessions.

## Features

### 1. AI-Powered Agent

- Integrates with OpenRouter to access LLMs through a compatible API.
- Implements an iterative agent loop in which the model determines when to call tools and uses their results to continue working.
- Supports ReAct-style and XML-style tool-call parsing.
- Displays execution progress through terminal spinners.

### 2. File System Operations

The agent has access to tools that allow it to interact with the current project:

| Tool | Functionality |
|---|---|
| `read_file` | Read source files |
| `write_file` | Create or update files |
| `list_files` | Explore directory contents |
| `file_exists` | Check whether a file exists |
| `delete` | Delete files |
| `search_files` | Search source files using text or regular expressions |
| `edit_file` | Replace matching text and generate a diff |
| `execute_command` | Run shell commands in the project directory |

### 3. Code Editing and Diff Generation

- Supports targeted text replacement in existing files.
- Generates unified diffs using the `diff` package.
- Uses guarded file-writing operations for modifications.
- Creates backups when saving conversation sessions.

### 4. Persistent Conversation Memory

The project implements a local, file-based memory system to retain previous conversations and agent actions.

- Stores conversation messages and tool execution records.
- Creates and restores sessions.
- Supports session renaming and session history retrieval.
- Uses an in-memory cache with LRU-style access tracking.
- Saves session data as JSON files.
- Maintains a session index for faster session listing.
- Uses temporary files and backups during session persistence.

### 5. Safety Mechanisms

- Asks the user to confirm that the working project directory is trusted before starting.
- Includes path validation for file operations.
- Blocks selected dangerous shell-command patterns.
- Supports confirmation prompts for file writes and command execution.
- Includes an allowlist mechanism for previously approved operations.

**Note:** These are basic safeguards, not a complete security sandbox. Review commands and changes before approving them, and avoid running the agent on untrusted repositories or sensitive environments.

### 6. Interactive CLI Dashboard

The terminal interface provides:

- A project workspace display.
- The currently configured model name.
- An interactive prompt for coding tasks.
- Session restoration and project initialization commands.
- Progress indicators while the agent processes requests.

## Architecture

```text
                 User Prompt
                      |
                      v
              Interactive CLI
                      |
                      v
                Agent Loop
                      |
                      v
              OpenRouter LLM
                (LangChain)
                      |
                      v
              Tool Call Parsing
                      |
                      v
              Agent Tool Registry
                      |
          +-----------+-----------+
          |           |           |
          v           v           v
       File       Code Search   Terminal
     Operations    & Editing   Execution
          |           |           |
          +-----------+-----------+
                      |
                      v
               Tool Observations
                      |
                      v
                Agent Loop
                      |
                      v
                Final Response

          Persistent Session Memory
             (Local JSON Storage)
```

## Tech Stack

| Category | Technologies |
|---|---|
| Language | TypeScript, Node.js |
| LLM Integration | OpenRouter |
| Agent Framework | LangChain |
| Model Client | `@langchain/openai` |
| Input Validation | Zod |
| CLI Interface | Enquirer, Chalk, Boxen, Ora |
| File System | Node.js `fs` and `path` |
| Diff Generation | `diff` |
| Configuration | dotenv |
| Memory Persistence | JSON-based local storage |



## Getting Started

### Prerequisites

- Node.js and npm
- An OpenRouter account
- An OpenRouter API key
- A terminal environment

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/agentic-coding-assistant.git

cd agentic-coding-assistant
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create a `.env` file in the project root using `.env.example` as a template.

Replace the API key with your own OpenRouter API key.

Keep your `.env` file private and never commit API keys or other secrets to GitHub.

### 4. Run in Development Mode

```bash
npm run dev
```

The application starts with a trust confirmation prompt. Confirm that you trust the current project directory before proceeding.

### 5. Build the Project

```bash
npm run build
```

### 6. Run the Built Application

```bash
npm start
```

You can also pass a task directly as a command-line argument:

```bash
node dist/cli/index.js "Explain the project structure"
```

## CLI Commands

| Command | Description |
|---|---|
| `/init` | Creates an `AICODINGAGENT.md` project-context template |
| `/restore-session` | Restores the latest active conversation session |
| `/quit` | Exits the application |
| `exit` | Exits the application |

You can also enter natural-language coding instructions directly into the interactive prompt.

The agent can inspect the relevant files, select appropriate tools, perform operations, and use tool outputs to continue its reasoning.

## Memory Storage

Conversation history is stored locally in the configured memory directory.

The session store maintains individual JSON session files and an index containing session metadata.

A typical storage layout is:

```text
.aicodingagent/
└── memory/
    └── sessions/
        ├── index.json
        ├── session-id-1.json
        └── session-id-2.json
```

The actual directory is controlled by `MEMORY_PATH`.
