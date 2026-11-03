#!/usr/bin/env node

import boxen from "boxen";
import chalk from "chalk";
import * as dotenv from "dotenv";
import Enquirer from "enquirer";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { runAgent } from "../agent/agent.js";
import { DEFAULT_MEMORY_CONFIG, HistoryManager } from "../memory/index.js";
import { setGlobalMemory } from "../memory/singleton.js";
import { contextFileExists, createContextTemplate } from "../utils/context.js";

const { Select, Input } = Enquirer as any;
const MIN_TERM_WIDTH = 80;
const MIN_PANEL_WIDTH = 30;
const GAP = 2;

// Replace with your own color palette
const colors = {
  primary: chalk.hex("#6366F1"),
  secondary: chalk.hex("#6366F1"),
  accent: chalk.hex("#6366F1"),
  success: chalk.hex("#22C55E"),
  warning: chalk.hex("#EF4444"),
  muted: chalk.hex("#EAB308"),
  text: chalk.hex("#6366F1"),
  dim: chalk.hex("#6366F1"),
  border: chalk.hex("#6366F1"),
};

dotenv.config({ path: path.join(process.cwd(), ".env") });
async function showTrustCheck(): Promise<boolean> {
  console.clear();
  console.log(chalk.yellow.bold("\n Quick safety check:"));
  console.log(chalk.white("Is this a project you created or one you trust?"));
  console.log(
    chalk.dim(
      `Aicodingagent will be able to read, edit, and execute files here.\n`,
    ),
  );

  const prompt = new Select({
    name: "trust",
    message: "Do you trust this folder?",
    choices: [
      {
        name: "yes",
        message: "1. Yes, I trust this folder",
        value: true,
      },
      {
        name: "no",
        message: "2. No, exit",
        value: false,
      },
    ],
  });

  const answer = await prompt.run();
  return answer === "yes";
}

async function ensureConfig() {
  const envPath = path.join(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }

  const requiredKeys = ["OPENROUTER_API_KEY", "MODEL_NAME"];
  const missingKeys = requiredKeys.filter(
    (key) => !process.env[key] || process.env[key]?.trim() === "",
  );

  if (missingKeys.length > 0) {
    console.log(
      `Configuration incomplete. Missing: ${missingKeys.join(", ")}\n`,
    );
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const question = (q: string) =>
      new Promise<string>((res) => rl.question(q, res));

    let newEnvContent = fs.existsSync(envPath)
      ? fs.readFileSync(envPath, "utf-8")
      : "";

    if (!process.env.OPENROUTER_API_KEY) {
      const key = await question("Enter OpenRouter API Key:");
      newEnvContent += `\nOPENROUTER_API_KEY=${key}`;
    }

    if (!process.env.MODEL_NAME) {
      const model =
        (await question("Model (default: stepfun/step-3.5-flash:free):")) ||
        "stepfun/step-3.5-flash:free";
      newEnvContent += `\nMODEL_NAME=${model}`;
    }

    if (!newEnvContent.includes("OPENROUTER_BASE_URL")) {
      newEnvContent += `\nOPENROUTER_BASE_URL=https://openrouter.ai/api/v1\nAPP_URL=http://localhost:3000`;
    }

    fs.writeFileSync(envPath, newEnvContent.trim());
    console.log("\n Configuration updated! Reloading...\n");
    rl.close();

    dotenv.config({ path: envPath });
  }
}

function handleCommand(cmd: string, memory: HistoryManager) {
  const parts = cmd.split(" ");
  const command = parts[0];

  switch (command) {
    case "/init":
      (async () => {
        if (contextFileExists()) {
          console.log(
            chalk.yellow(
              "AICODINGAGENT.md already exists at this project root",
            ),
          );
          console.log(chalk.dim("Edit it to customize your agent's context"));
        } else {
          const result = createContextTemplate();
          if (result.success) {
            console.log(
              chalk.green(`Created AICODINGAGENT.md at: ${result.path}`),
            );
            console.log(
              chalk.cyan(
                `Edit this file to define your project's architecture, coding standards, and rules`,
              ),
            );
          } else {
            console.log(chalk.yellow("AICODINGAGENT.md already exists"));
          }
        }
      })();
      break;

    case "/restore-session":
      (async () => {
        try {
          const sessions = await memory.listActiveSessions();
          if (sessions.length === 0) {
            console.log(
              chalk.yellow("No sessions found. Start a new conversation"),
            );
            return;
          }

          const latestSession = sessions[0];
          if (!latestSession) {
            console.log("last session not exist");
            return;
          }

          const currentId = memory.getCurrentSessionId();

          if (currentId === latestSession?.id) {
            console.log(
              chalk.yellow("You're already using the latest session"),
            );
            return;
          }

          await memory.switchSession(latestSession.id);
          console.clear();
          renderDashboard(memory, latestSession?.id);

          const dateStr = new Date(latestSession?.updatedAt).toLocaleString();
          console.log(chalk.green(`Restored latest session`));
          console.log(
            chalk.white(`ID: ${latestSession.id.substring(0, 12)}...`),
          );

          console.log(chalk.dim(`Updated: ${dateStr}`));
          console.log(chalk.dim(`Name: ${latestSession.name}`));
          console.log(chalk.dim(`Messages:  ${latestSession.messageCount}`));
        } catch (error: any) {
          console.error(
            chalk.red("Failed to restore session: "),
            error.message,
          );
        }
      })();
      break;

    default:
      console.log(chalk.red(`Unknown command: ${cmd}`));
      break;
  }
}


async function main() {
  // 1. Safety Check (Must happen before anything else)
  const trusted = await showTrustCheck();
  if (!trusted) {
    console.log(chalk.red("Exiting for safety."));
    process.exit(0);
  }

  // 2. Load and Validate Configuration
  await ensureConfig();

  // 3. Initialize Memory System with environment config
  const memoryConfig = {
    storagePath: process.env.MEMORY_PATH || DEFAULT_MEMORY_CONFIG.storagePath,
    maxMessagesPerSession: process.env.MEMORY_MAX_SESSIONS
      ? parseInt(process.env.MEMORY_MAX_SESSIONS)
      : DEFAULT_MEMORY_CONFIG.maxMessagesPerSession,
    autoSave: true, // always true for CLI
  };
  const memory = new HistoryManager({ config: memoryConfig });
  setGlobalMemory(memory); // Make memory available to planning tools

  // 4. Determine Mode: CLI (args) vs. Dashboard (no args)
  const argsInput = process.argv.slice(2).join(" ").trim();

  if (argsInput) {
    /** * SINGLE COMMAND MODE
     * Runs once and exits. Used for: agenticai "fix the styles"
     */
    console.log(chalk.blue("\n Rock'n rolling..."));
    try {
      const result = await runAgent(argsInput, 100, memory);
      console.log(result);
      process.exit(0);
    } catch (error) {
      console.error(chalk.red("🚨 Execution failed:"), error);
      process.exit(1);
    }
  } else {
    /** * INTERACTIVE DASHBOARD MODE
     * Keeps the session open with the Cat UI.
     */
    console.clear();
    // Ensure a session exists
    await memory.getCurrentSession();
    const currentSessionId = memory.getCurrentSessionId();
    renderDashboard(memory, currentSessionId ?? undefined);

    while (true) {
      try {
        const inputPrompt = new Input({
          message: chalk.blue("❯"),
          // Simple history is built-in; passing a complex object caused the crash
          name: "user_query",
        });

        // FIX: Listen for the 'cancel' event (Ctrl+C / Escape)
        // to exit the process IMMEDIATELY before the error throws
        inputPrompt.on("cancel", () => {
          console.log(chalk.gray("\nSession ended. 🐾"));
          process.exit(0);
        });

        const userInput = await inputPrompt.run();

        // Handle empty input (User just hits Enter)
        if (!userInput || userInput.trim() === "") continue;

        const lowInput = userInput.toLowerCase().trim();

        // Exit commands
        if (lowInput === "exit" || lowInput === "/quit") {
          console.log(chalk.yellow("\nGoodbye! 🐾"));
          // Save session before exit
          await memory.saveCurrentSession();
          process.exit(0);
        }

        // Slash commands (e.g., /clear, /init)
        if (userInput.startsWith("/")) {
          handleCommand(userInput, memory);
          continue;
        }

        // Run the agentic loop
        // FIX: Capture and log the final result
        const finalResponse = await runAgent(userInput, 5, memory);

        // console.log(chalk.green("\n🤖 Result:"));
        console.log(chalk.white(finalResponse));
        console.log("\n"); // Padding
      } catch (err) {
        // This catch block handles cases where the prompt is closed
        // but the 'cancel' event didn't trigger fast enough
        process.exit(0);
      }
    }
  }
}

function mergePanelsRow(
  leftLines: string[],
  rightLines: string[],
  leftWidth: number,
  rightWidth: number,
  gap: number,
): string[] {
  const maxHeight = Math.max(leftLines.length, rightLines.length);
  const separator = colors.dim("|");
  const gapStr = " ".repeat(Math.floor(gap / 2));
  const result: string[] = [];

  for (let i = 0; i < maxHeight; i++) {
    const leftLine = leftLines[i] || "";
    const rightLine = rightLines[i] || "";
    const paddedLeft = fitToWidth(leftLine, leftWidth);
    const paddedRight = fitToWidth(rightLine, rightWidth);

    result.push(`${paddedLeft}${gapStr}${separator}${gapStr}${paddedRight}`);
  }
  return result;
}

function fitToWidth(str: string, width: number): string {
  const stripped = str.replace(/\x1b\[[0-9;]*m/g, "");
  const visibleLenght = stripped.length;

  if (visibleLenght >= width) {
    let result = "";
    let currentWidth = 0;
    let i = 0;

    while (i < str.length && currentWidth < width - 3) {
      if (str[i] === "\x1b") {
        const end = str.indexOf("m", i);
        if (end != -1) {
          result += str.slice(i, end + 1);
          i = end + 1;
          continue;
        }
      }

      result += str[i];
      currentWidth++;
      i++;
    }
    return result + "...";
  }
  return str + " ".repeat(width - visibleLenght);
}
// Frontend
function renderDashboard(memory?: HistoryManager, sessionId?: string): void {
  const version = "v1.0.0"; //update later using package version
  const termWidth = Math.max(
    process.stdout.columns || MIN_TERM_WIDTH,
    MIN_TERM_WIDTH,
  );

  const contentWidth = termWidth - 6;
  const availableWidth = contentWidth - GAP - 1;
  const leftWidth = Math.max(
    Math.floor(availableWidth * 0.48),
    MIN_PANEL_WIDTH,
  );
  const rightWidth = Math.max(availableWidth - leftWidth, MIN_PANEL_WIDTH);

  const header = renderHeader(termWidth);
  const leftPanel = renderLeftPanel(leftWidth);
  const rightPanel = renderRightPanel(rightWidth, memory, sessionId);
  const footer = renderFooter(termWidth);

  let content = "";

  header.forEach((line) => {
    content += line + "\n";
  });

  const mergePanels = mergePanelsRow(
    leftPanel,
    rightPanel,
    leftWidth,
    rightWidth,
    GAP,
  );

  mergePanels.forEach((line) => {
    content += line + "\n";
  });

  footer.forEach((line) => {
    content += line + "\n";
  });

  const dashboard = boxen(content, {
    width: termWidth,
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
    margin: 0,
    borderStyle: "double",
    borderColor: "blue",
    dimBorder: false,
    title: chalk.hex("#d0296c").bold(` AICODINGAGENT CLI ${version} `),
    titleAlignment: "center",
  });

  console.log(dashboard);
}

function renderFooter(termWidth: number): string[] {
  const contentWidth = termWidth - 4;
  const footerText =
    colors.muted("Text a prompt and press") +
    colors.accent("Enter") +
    colors.muted("to start chatting");

  return [divider(contentWidth), centerText(footerText, contentWidth)];
}
function renderRightPanel(
  panelWidth: number,
  memory?: HistoryManager,
  sessionId?: string,
): string[] {
  const lines: string[] = [
    colors.text.bold("- QUICK START"),
    "",
    `${colors.accent(">")} ${colors.accent("/init")} ${colors.muted("Initialize project")}`,
    divider(panelWidth - 2),
    "",
  ];

  if (memory && sessionId) {
    // add more lines here
  }

  lines.push(colors.text.bold("- COMMANDS"));
  lines.push("");
  lines.push(
    `${colors.muted(">")}  ${colors.text("/help")}  ${colors.dim("See commands")}`,
  );
  lines.push();
  return lines;
}
function renderHeader(termWidth: number): string[] {
  const version = "v1.0.0"; // update later
  const contentWidth = termWidth - 4;

  const logo = ["AGENTIC CODING ASSISTANT CLI"];

  const logoColors = [
    colors.primary,
    colors.primary,
    colors.secondary,
    colors.secondary,
    colors.accent,
    colors.accent,
  ];

  const lines: string[] = [""];

  if (contentWidth >= 96) {
    logo.forEach((line, i) => {
      lines.push(centerText(logoColors[i]?.bold(line)!, contentWidth));
    });
  } else {
    const compactLogo =
      colors.primary.bold("AICODINGAGENT") + " " + colors.accent(version);
    lines.push(centerText(compactLogo, contentWidth));
  }
  lines.push("");
  lines.push(divider(contentWidth));
  lines.push("");
  return lines;
}

function renderLeftPanel(panelWidth: number): string[] {
  const model = process.env.MODEL_NAME || "google/gemini-3-flash-preview";
  const version = "V1.0.0";
  const dir = process.cwd();
  const timestamp = new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const statusDot = colors.success("-");
  const modelShort = model.split("/").pop() || model;
  const maxPathLen = panelWidth - 8;
  const displayPath =
    dir.length > maxPathLen ? "..." + dir.slice(-(maxPathLen - 3)) : dir;

  const lines: string[] = [
    colors.text.bold("- SYSTEM STATUS"),
    "",
    `${colors.accent("-")} ${colors.muted("Model")}  ${colors.text(modelShort)}`,
    divider(panelWidth - 2),
    "",
    colors.text.bold("- WORKSPACE"),
    "",
    `${colors.accent(">")} ${colors.muted(displayPath)}`,
    "",
  ];
  return lines;
}

function divider(width: number, char = "--"): string {
  return colors.dim(char.repeat(width));
}

function centerText(text: string, width: number): string {
  const stripped = text.replace(/\x1b\[[0-9;]*m/g, "");
  const visibleLength = stripped.length;
  if (visibleLength >= width) return text;

  const padding = Math.floor((width - visibleLength) / 2);
  return " ".repeat(padding) + text;
}
main();
