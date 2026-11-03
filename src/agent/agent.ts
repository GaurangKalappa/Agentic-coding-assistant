import { ChatOpenAI } from "@langchain/openai";
import chalk from "chalk";
import * as dotenv from "dotenv";
import ora from "ora";
import * as path from "path";
import {
  createAction,
  createMessage,
  HistoryManager,
} from "../memory/index.js";

dotenv.config({ path: path.join(process.cwd(), ".env") });
const spinnerTypes = ["dots", "line", "arc", "bouncingBar"];

function parseToolCall(
  content: string,
): { toolName: string; input: Record<string, any> } | null {
  // console.log("🔍 Parsing content for tool calls...");

  // 1. Try ReAct format (greedy to match nested braces)
  const reactMatch = content.match(
    /Action:\s*(\w+)\s*\nInput:\s*(\{[\s\S]*\})/,
  );
  if (reactMatch) {
    try {
      return {
        toolName: reactMatch[1]!,
        input: JSON.parse(reactMatch[2]!.trim()),
      };
    } catch (e) {
      console.log("ReAct parse error", e);
    }
  }

  // 2. Improved XML Parsing
  // Matches <function=NAME> or <function-NAME> or <function name="NAME">
  const funcMatch = content.match(
    /<function[=-]([\w_]+)>([\s\S]*?)<\/function/i,
  );
  if (!funcMatch) return null;

  const toolName = funcMatch[1];
  if (!toolName) return null;
  const inner = funcMatch[2];
  const input: Record<string, any> = {};

  // 3. Extract parameters (HYBRID: Handles - or =)
  const paramRegex =
    /<parameter[=-]([\w_]+)>([\s\S]*?)(?:<\/parameter[=-]\1>|<\/parameter>|(?=<parameter[=-])|$)/gi;

  let paramMatch;
  while ((paramMatch = paramRegex.exec(inner!)) !== null) {
    const paramName = paramMatch[1];
    let paramValue = paramMatch[2]!.trim();
    try {
      input[paramName!] = JSON.parse(paramValue);
    } catch {
      input[paramName!] = paramValue;
    }
  }

  return { toolName, input };
}


export async function runAgent(
  userInput: string,
  maxIterations: number,
  memory?: HistoryManager,
): Promise<string> {
  // Configuration for OpenRouter
  const apiKey = process.env.OPENROUTER_API_KEY;
  const modelName = process.env.MODEL_NAME;
  const baseURL = process.env.OPENROUTER_BASE_URL;
  const appUrl = process.env.APP_URL;

  console.log(`Calling OpenRouter with model: ${modelName}...`);

  if (!apiKey || !modelName || !baseURL || !appUrl) {
    throw new Error(
      "One or more required environment variables are not defined.",
    );
  }

  const llm = new ChatOpenAI({
    modelName: modelName,
    apiKey: apiKey,
    temperature: 0.2,
    maxTokens: 4096,
    configuration: {
      baseURL: baseURL,
      defaultHeaders: {
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": appUrl,
        "X-Title": "My RAG App",
      },
    },
  });

  const { getAgentTools } = await import("../tools/agentTools.js");
  const tools = getAgentTools();

  const random = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];

  const colorMap = {
    cyan: chalk.cyan,
    green: chalk.green,
    yellow: chalk.yellow,
    blue: chalk.blue,
    magenta: chalk.magenta,
  };
  const messagesList = [
    "Analysing...",
    "Running...",
    "Agenting...",
    "Processing...",
  ];
  const chosenColor = random(Object.keys(colorMap)) as keyof typeof colorMap;

  const text = colorMap[chosenColor](random(messagesList));

  // ✅ Spinner replaces console.log
  const spinner = ora({
    text: text,
    spinner: random(spinnerTypes) as any,
    color: chosenColor as any,
  }).start();

  try {
    const toolsDesc = tools
      .map((t) => `- ${t.name}: ${t.description}`)
      .join("\n");

    // Inject SYLVAINCODES.md context if available (using versioned system prompt)
    // The system prompt is loaded from .sylvaincodes/prompts/system/ (with {tools_list} placeholder)
    const systemPrompt = `You are a senior software engineer assistant. You help with coding tasks by reading, writing, and modifying files safely.

Available tools:
{tools_list}

You can use tools in two formats:

Format 1 (ReAct):
Thought: I need to inspect the project structure.
Action: list_files
Input: {"path": "."}

Format 2 (XML):
<function=list_files>
<parameter-path>.</parameter-path>
</function=list_files>

Guidelines:
- Always read files before modifying them
- Use write_file to create or update files
- Use list_files to explore directories
- Use file_exists to check before operations
- Use delete_file carefully

Begin!`;

    // --- Message & Memory Setup ---
    let messages: Array<{ role: string; content: string }>;

    if (memory) {
      // Memory mode: ensure we have a session
      await memory.getCurrentSession();

      // If this is a brand new session (no messages yet), add the system prompt
      const existingMessages = memory.getAllMessages();
      if (existingMessages.length === 0) {
        await memory.addMessage({
          role: "system",
          content: systemPrompt,
        });
      }

      // Add the current user input to memory
      await memory.addMessage({
        role: "user",
        content: userInput,
      });

      // Load all messages (including system, previous exchanges, and this user input)
      const allMemMessages = memory.getAllMessages();
      messages = allMemMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
    } else {
      // Volatile mode (no memory)
      messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userInput },
      ];
    }

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      // console.log(`\n--- Iteration ${iteration + 1} ---`);
      spinner.text = colorMap[chosenColor](
        `Thinking... (step ${iteration + 1})`,
      );

      const response = await llm.invoke(messages);
      const content = String(response.content).trim();
      // console.log("Agent output:\n", content);

      // Check for final answer (no tool call)
      if (!content.includes("<function") && !content.includes("Action:")) {
        // Record assistant's final response to memory
        if (memory) {
          await memory.addMessage(createMessage("assistant", content));
          await memory.saveCurrentSession();
        }
        return content;
      }

      // Parse tool call
      const toolCall = parseToolCall(content);
      if (!toolCall) {
        // Could not parse, treat as final response
        if (memory) {
          await memory.addMessage(createMessage("assistant", content));
          await memory.saveCurrentSession();
        }
        return content;
      }

      const { toolName, input } = toolCall;

      spinner.text = colorMap[chosenColor](`Executing... ${toolName}...`);

      // --- GLOBAL PARAMETER NORMALIZER ---
      // LLMs love 'file_path', but our tools use 'path'. This fixes it for ALL tools.
      if (input.file_path && !input.path) {
        input.path = input.file_path;
      }

      // Some LLMs also use 'directory' or 'dir' instead of 'path' for list_files
      if (input.directory && !input.path) {
        input.path = input.directory;
      }
      // ----------------------------------

      const tool = tools.find((t) => t.name === toolName);

      if (!tool) {
        const errorMsg = `Unknown tool: ${toolName}`;
        console.error(errorMsg);
        messages.push({ role: "assistant", content });
        messages.push({ role: "user", content: `Error: ${errorMsg}` });
        continue;
      }

      // Execute the tool
      // console.log(`\n🔧 Executing tool: ${toolName}`);
      // console.log(`   Args:`, input);
      let result: string;
      try {
        result = await tool.call(input);
      } catch (error: any) {
        result = `Tool error: ${error.message}`;
      }
      // console.log(
      //   `   Result: ${result.substring(0, 200)}${result.length > 200 ? "..." : ""}`,
      // );

      // Check for user cancellation (special marker from guarded functions)
      const isUserCancellation = result.includes("Operation cancelled by user");

      // Record action to memory
      if (memory) {
        await memory.addAction(
          createAction(toolName, input, result, {
            success: !result.startsWith("Tool error") && !isUserCancellation,
          }),
        );
        // Record assistant message (with tool call)
        await memory.addMessage(createMessage("assistant", content));
        // Record tool result as 'user' role message (Observation format)
        // Store WITH "Observation: " prefix to maintain format for LLM context
        await memory.addMessage(
          createMessage("user", `Observation: ${result}`),
        );
      }

      // Append to conversation for LLM
      messages.push({ role: "assistant", content });
      messages.push({ role: "user", content: `Observation: ${result}` });

      // If user cancelled the operation, stop the agent loop immediately
      if (isUserCancellation) {
        if (memory) {
          await memory.saveCurrentSession();
        }
        return "Operation cancelled by user. You can start a new task.";
      }
    }

    // Save session before returning max iterations message
    if (memory) {
      await memory.saveCurrentSession();
    }
    return "Maximum iterations reached without a final answer. Could you please rephrase or provide more specific instructions?";
  } finally {
    if (spinner.isSpinning) {
      spinner.stop();
    }
  }
}
