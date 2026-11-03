import { exec } from "child_process";
import { promisify } from "util";
export interface TerminalResult {
  success: boolean;
  stdout?: string;
  stderr?: string;
  error?: string;
  command: string;
  exitCode?: number;
}
const DANGEROUS_COMMANDS = [
  "rm -rf",
  "rmdir /s",
  "del /f /s /q",
  "format",
  "dd",
  "mkfs",
  ":(){ :|:&};:",
  "chomd -R",
  "chown -R",
];

const ALLOWED_COMMANDS: string[] = [];
const execAsync = promisify(exec);
function isCommandSafe(command: string): { safe: boolean; reason?: string } {
  const trimmed = command.trim().toLowerCase();

  for (const dangerous of DANGEROUS_COMMANDS) {
    if (trimmed.includes(dangerous.toLowerCase())) {
      return {
        safe: false,
        reason: `Command contains dangerous pattern: ${dangerous}`,
      };
    }
  }

  if (trimmed.includes("cd") && !trimmed.startsWith("cd")) {
    return { safe: false, reason: "Invalid cd command format" };
  }

  if (ALLOWED_COMMANDS.length > 0) {
    const firstWord = trimmed.split("")[0];

    if (!ALLOWED_COMMANDS.includes(firstWord!)) {
      return {
        safe: false,
        reason: `Command no tin allowed list. Allowed: ${ALLOWED_COMMANDS.join(", ")}`,
      };
    }
  }

  return { safe: true };
}

export async function executeCommand(command: string): Promise<TerminalResult> {
  const safetyCheck = isCommandSafe(command);
  if (!safetyCheck.safe) {
    return {
      success: false,
      error: `Safety violation: ${safetyCheck.reason}`,
      command,
    };
  }

  try {
    const cwd = process.cwd();
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });

    return {
      success: true,
      stdout: stdout.trim(),
      stderr: stderr.trim() || "",
      command,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      stderr: error.stderr?.toString()?.trim() || "",
      command,
      exitCode: error.code,
    };
  }
}
