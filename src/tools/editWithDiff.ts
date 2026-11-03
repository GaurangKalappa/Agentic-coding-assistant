import { generateDiff } from "../diff/index.js";
import { guardedWriteFile } from "../safety/index.js";
import { readFile } from "./fileSystem.js";

export interface EditResult {
  success: boolean;
  filePath: string;
  operation: string;
  diff?: string;
  message: string;
  backupCreated?: boolean;
  hunksApplied?: number;
}

export async function replaceText(
  filePath: string,
  oldText: string,
  newText: string,
  occurence: number = 0,
): Promise<EditResult> {
  try {
    const readResult = await readFile(filePath);
    if (!readResult.success || !readResult.content) {
      return {
        success: false,
        filePath,
        operation: "replace",
        message: `Cannot read file: ${readResult.error || "File empty"}`,
      };
    }

    if (!readResult.content.includes(oldText)) {
      return {
        success: false,
        filePath,
        operation: "replace",
        message: `Text not found: ${oldText.substring(0, 50)}...`,
      };
    }

    const lines = readResult.content.split("\n");
    let modified = false;

    if (occurence === 0 || occurence > 0) {
      let count = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]?.includes(oldText)) {
          if (occurence === 0 && count === 0) {
            lines[i] = lines[i]!.replace(oldText, newText);
            modified = true;
            break;
          } else if (occurence > 0 && count === occurence - 1) {
            lines[i] = lines[i]!.replace(oldText, newText);
            modified = true;
            break;
          }
          count++;
        }
      }
    } else if (occurence === -1) {
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i]?.includes(oldText)) {
          lines[i] = lines[i]!.replace(oldText, newText);
          modified = true;
          break;
        }
      }
    }

    if (!modified) {
      return {
        success: false,
        filePath,
        operation: "replace",
        message: "No matching text found for replacement",
      };
    }

    const newContent = lines.join("\n");

    const diffResult = generateDiff(filePath, readResult.content, newContent);
    const writeResult = await guardedWriteFile(filePath, newContent);

    return {
      success: writeResult.success,
      filePath,
      operation: "replace",
      diff: diffResult.patch,
      message: writeResult.success
        ? `Successfully replaced text in ${filePath}`
        : `Failed: ${writeResult.error}`,
      backupCreated: writeResult.success,
    };
  } catch (error: any) {
    return {
      success: false,
      filePath,
      operation: "replace",
      message: error.message,
    };
  }
}
