// Helpers functions for safety checks
import chalk from "chalk";
import Enquirer from "enquirer";
import * as fs from "fs";
import * as path from "path";
import { getGlobalSettings } from "../config/singleton.js";
import { deleteFile, readFile, writeFile } from "../tools/fileSystem.js";
import { executeCommand } from "./terminal.js";
const { Select } = Enquirer as any;

export interface SafetyContext {
  projectRoot: string;
  allowedPaths: string[];
  blockedPatterns: RegExp[];
  requiresConfirmation: boolean;
}

const DEFAULT_CONTEXT: SafetyContext = {
  projectRoot: process.cwd(),
  allowedPaths: [process.cwd()],
  blockedPatterns: [/node_modules/, /\.env/, /\.git/, /dist/],
  requiresConfirmation: true,
};

export function isPathAllowed(
  filePath: string,
  context: SafetyContext,
): boolean {
  try {
    const resolvedPath = path.resolve(context.projectRoot, filePath);

    if (!resolvedPath.startsWith(context.projectRoot)) {
      return false;
    }

    const relativePath = path.relative(context.projectRoot, resolvedPath);
    if (
      relativePath &&
      context.blockedPatterns.some((pattern) => pattern.test(relativePath))
    ) {
      return false;
    }

    return context.allowedPaths.some((allowed) =>
      resolvedPath.startsWith(path.resolve(context.projectRoot, allowed)),
    );
  } catch (error) {
    return false;
  }
}

async function fileExists(
  filePath: string,
): Promise<{ exists: boolean; path: string }> {
  try {
    const resolvedPath = path.resolve(process.cwd(), filePath);
    await fs.promises.access(resolvedPath);
    return { exists: true, path: filePath };
  } catch (error) {
    return { exists: false, path: filePath };
  }
}

export async function validateFileOperation(
  operation: "read" | "write" | "delete",
  filePath: string,
  context: SafetyContext = DEFAULT_CONTEXT,
): Promise<{ safe: boolean; reason?: string }> {
  if (!isPathAllowed(filePath, context)) {
    return {
      safe: false,
      reason: `Operation "${operation}" on path "${filePath}" is not allowed due to safety restrictions.`,
    };
  }

  // Additional checks
  if (operation === "delete") {
    const existsResult = await fileExists(filePath);
    if (!existsResult.exists) {
      return {
        safe: false,
        reason: `File "${filePath}" does not exist and cannot be deleted.`,
      };
    }

    const criticalFiles = [
      "package.json",
      "package-lock.json",
      "yarn.lock",
      "tsconfig.json",
      "README.md",
      "AI_CODING_AGENT.md", // this is the command line tool main file, replace this by your own name
    ];
    if (criticalFiles.includes(path.basename(filePath))) {
      return {
        safe: false,
        reason: `File "${filePath}" is considered critical and cannot be deleted.`,
      };
    }
  }

  // Additional check for write
  if (operation === "write") {
    const ext = path.extname(filePath).toLowerCase();
    const binaryExtensions = [
      ".exe",
      ".ddl",
      ".bin",
      ".sh",
      ".bat",
      ".o",
      ".so",
    ];
    if (binaryExtensions.includes(ext)) {
      return {
        safe: false,
        reason: `Writing to files with extension "${ext}" is not allowed for safety reasons.`,
      };
    }
  }

  return { safe: true };
}

export async function safeReadFile(
  filePath: string,
): Promise<ReturnType<typeof readFile>> {
  const validation = await validateFileOperation("read", filePath);
  if (!validation.safe) {
    return {
      success: false,
      error: `Safety violation: ${validation.reason}`,
      path: filePath,
    };
  }
  return readFile(filePath);
}

export async function requestConfirmation(
  operation: "write" | "delete" | "execute",
  target: string,
  details?: string,
): Promise<{ approved: boolean; remember?: boolean }> {
  const settings = getGlobalSettings();
  if (settings) {
    if (operation === "execute") {
      if (settings.isCommandAllowed(target)) {
        return { approved: true };
      }
    } else {
      if (settings.isFileAllowed(target, operation)) {
        return { approved: true };
      }
    }
  }

  const isInteractive = process.stdin.isTTY;
  if (!isInteractive) {
    const settingsObj = settings?.getSettings();
    const autoConfirm =
      settingsObj?.preferences.autoConfirmNonInteractive || false;
    const allowed =
      operation === "execute"
        ? settings?.isCommandAllowed(target)
        : settings?.isFileAllowed(target, operation);

    if (autoConfirm || allowed) {
      if (allowed) {
        console.log(
          `Auto-approving ${operation} operation on "${target}" based on allowlist settings.`,
        );
      } else {
        console.log(
          `Auto-approving ${operation} operation on "${target}" in non-interactive mode.`,
        );
      }
      return { approved: true };
    }

    console.log(`\n Non Interactive mode: operation not allowed`);
    console.log(`Operation: ${operation}`);
    console.log(`Target: ${target}`);
    console.log(
      `Add to allowlist with /allowlist-add command in interactive mode`,
    );

    return { approved: false };
  }

  const settingsObj = settings?.getSettings();
  const confirmationMode =
    settingsObj?.preferences.confirmationMode || "manual";

  if (confirmationMode === "auto") {
    console.log(
      `Auto-approving ${operation} operation on "${target}" based on settings.`,
    );
  }
  const targetType = operation === "execute" ? "command" : "file";

  const yesChoice = "1) Yes";
  const yesRememberChoice = `2) yesChoice, don't ask again for this ${targetType}`;
  const noChoice = "3) No";

  const prompt = new Select({
    name: "confirm",
    message: `Allow ${operation} on ${target}?`,
    choices: [yesChoice, yesRememberChoice, noChoice],
  });

  console.log();
  console.log(chalk.yellow.bold("Confirmation required"));
  console.log(chalk.dim("-----------------------"));

  console.log(`${chalk.cyan("Operation")} ${operation}`);
  console.log(`${chalk.cyan("Target")} ${target}`);

  if (details) {
    console.log(`${chalk.cyan("Details")}  ${chalk.dim(details)}`);
  }

  console.log(chalk.dim("--------------------------"));
  console.log();

  try {
    const anwser = await prompt.run();
    if (anwser === yesChoice) {
      return { approved: true };
    } else if (anwser === yesRememberChoice) {
      if (settings) {
        if (operation === "execute") {
          await settings.addCommandToAllowlist(target);
        } else {
          await settings.addFileToAllowlist(target, operation);
        }
        console.log(`Added to allowlist`);
      }
      return { approved: true, remember: true };
    } else {
      return { approved: false };
    }
  } catch (error) {
    return { approved: false };
  }
}

export async function guardedWriteFile(
  filePath: string,
  content: string,
  requireConfirmation?: boolean,
): Promise<ReturnType<typeof writeFile>> {
  const validation = await validateFileOperation("write", filePath);

  if (!validation.safe) {
    return {
      success: false,
      error: `Safety violation: ${validation.reason}`,
      path: filePath,
    };
  }

  let needConfirmation = requireConfirmation;
  if (needConfirmation === undefined) {
    const settings = getGlobalSettings();
    const settingsObj = settings?.getSettings();
    const mode = settingsObj?.preferences.confirmationMode || "manual";
    needConfirmation = mode === "manual";
  }

  if (needConfirmation) {
    const { approved } = await requestConfirmation(
      "write",
      filePath,
      `${content.length} bytes`,
    );
    if (!approved) {
      return {
        success: false,
        error: "Operation cancelled by user",
        path: filePath,
      };
    }
  }

  return writeFile(filePath, content);
}

export async function safeDeleteFile(
  filePath: string,
): Promise<ReturnType<typeof deleteFile>> {
  const validation = await validateFileOperation("delete", filePath);
  if (!validation.safe) {
    return {
      success: false,
      error: `Safety violation: ${validation.reason}`,
      path: filePath,
    };
  }
  return deleteFile(filePath);
}

export async function guardedExecuteCommand(
  command: string,
  requireConfirmation?: boolean,
): Promise<ReturnType<typeof executeCommand>> {
  let needsConfirmation = requireConfirmation;
  if (needsConfirmation === undefined) {
    const settings = getGlobalSettings();
    const settingsObj = settings?.getSettings();

    const mode = settingsObj?.preferences?.confirmationMode ?? "manual";
    needsConfirmation = mode === "manual";
  }

  if (needsConfirmation) {
    const { approved, remember } = await requestConfirmation(
      "execute",
      command,
    );
    if (!approved) {
      return {
        success: false,
        error: "Operation cancelled by user",
        command,
        stdout: "",
        stderr: "",
      };
    }
  }

  return executeCommand(command);
}
