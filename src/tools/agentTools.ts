import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  guardedExecuteCommand,
  guardedWriteFile,
  safeDeleteFile,
  safeReadFile,
} from "../safety/index.js";
import { replaceText } from "./editWithDiff.js";
import { fileExists, listFiles } from "./fileSystem.js";
import { searchFiles } from "./search.js";

// First tool: Reading a file from the file system
export class ReadFileTool extends StructuredTool {
  //name of the tool
  name = "read_file";
  description = "Reads the content of a file from the file system.";

  //input schema for the tool
  schema = z.object({
    path: z
      .string()
      .describe("Path to the file (relative to the project root)"),
  });

  //function to execute the tool
  async _call({ path }: { path: string }): Promise<string> {
    const result = await safeReadFile(path);
    if (!result.success) {
      return `Error reading file: ${result.error}`;
    }
    return result.content || "";
  }
}

// Tool for writing files
export class WriteFileTool extends StructuredTool {
  name = "write_file";
  description = "Writes content to a file in the file system.";

  schema = z.object({
    path: z.string().describe("Path to the file (relative to  project root)"),
    content: z.string().describe("Content to write to the file"),
  });

  async _call({
    path,
    content,
  }: {
    path: string;
    content: string;
  }): Promise<string> {
    const result = await guardedWriteFile(path, content);
    if (!result.success) {
      return `Error writing file: ${result.error}`;
    }

    return `Successfully wrote ${content.length} bytes to ${path}`;
  }
}

// Tool for listing directory contents
export class ListFilesTool extends StructuredTool {
  name = "list_files";
  description = "List files in a directory.";

  schema = z.object({
    path: z.string().describe("Directory path (relative to project )"),
  });

  async _call({ path = "." }: { path?: string }): Promise<string> {
    const result = await listFiles(path);
    if (!result.success) {
      return `Error listing files: ${result.error}`;
    }
    if (!result.files || result.files.length === 0) {
      return `Directory is empty: ${path}`;
    }
    const output = result.files
      .map((file) => {
        const icon = file.isDirectory ? "📁" : "🗎";
        const size = file.size ? `(${file.size} bytes)` : "";
        return `${icon} ${file.path}${size}`;
      })
      .join("\n");

    return `Contents of ${path}:\n${output}`;
  }
}

// Tool for checking if a file exists
export class FileExistsTool extends StructuredTool {
  name = "file_exists";
  description = "Check if a file or directory exists";

  schema = z.object({
    path: z.string().describe("Path toc check  (relative to project root)"),
  });

  async _call({ path }: { path: string }): Promise<string> {
    const result = await fileExists(path);
    return result.exists
      ? `File exists:  ${path}`
      : `File does not exists ${path}`;
  }
}

// Tool for deleting a file
export class DeleteFileTool extends StructuredTool {
  name = "delete";
  description =
    "Delete a file. cannot delete critical files (package.json, tsconfig.json, etc.) or directories";
  schema = z.object({
    path: z
      .string()
      .describe("Path to the file to delete (relative to project root)"),
  });

  async _call({ path }: { path: string }): Promise<string> {
    const result = await safeDeleteFile(path);
    if (!result.success) {
      return ` Error deleting file: ${result.error}`;
    }

    return `Successfully deleted: ${path}`;
  }
}

// Tool for searching file contents (greq-like)
export class SearchFilesTool extends StructuredTool {
  name = "search_files";
  description =
    "Search for a pattern across files. Returns matching lines with context";

  schema = z.object({
    pattern: z.string().describe("Search pattern (regex or plain text)"),
    path: z
      .string()
      .describe('Directory to search in (default: ".")')
      .optional(),
    file_pattern: z
      .string()
      .describe('File pattern like "*.ts" or "*.{js,ts}"')
      .optional(),
    case_sensitive: z.string().describe("Case-sensitive search").optional(),
  });

  async _call({
    pattern,
    path = ".",
    file_pattern,
    case_sensitive = false,
  }: {
    pattern: string;
    path?: string;
    file_pattern?: string;
    case_sensitive?: boolean;
  }): Promise<string> {
    const results = await searchFiles({
      pattern,
      path,
      filePattern: file_pattern,
      caseSensitive: case_sensitive,
      maxResults: 100,
    });

    if (results.length === 0) {
      return `No matches found for pattern: ${pattern}`;
    }

    const formatted = results
      .map(
        (r) =>
          `${r.file}:${r.line}:${r.column}:${r.context}\n |_ Match: ${r.match}`,
      )
      .join("\n");
    return `Found ${results.length} match(es):\n\n${formatted}`;
  }
}

// Tool for editing files
export class EditFileTool extends StructuredTool {
  name = "edit_file";
  description = "Replace text in a file. Uses atomic operations with backups.";

  schema = z.object({
    path: z.string().describe("Path to the file (relative to project root)"),
    old_string: z.string().describe("Text to search for"),
    new_string: z.string().describe("Replacement text"),
  });

  async _call({
    path,
    old_string,
    new_string,
  }: {
    path: string;
    old_string: string;
    new_string: string;
  }): Promise<string> {
    const result = await replaceText(path, old_string, new_string);
    if (!result.success) {
      return `Error Editing file: ${result.message}`;
    }

    const output = `Successfummy edited ${path}\n`;
    return output + (result.diff ? `\nDiff:\n${result.diff}` : "");
  }
}

// Tool for executing shell commands
export class ExecuteCommandTool extends StructuredTool {
  name = "execute_command";
  description =
    "Execute a shell command in the project directory. Safety: dangerous command are blocked";

  schema = z.object({
    command: z.string().describe("Shell command to execute"),
  });

  async _call({ command }: { command: string }): Promise<string> {
    const result = await guardedExecuteCommand(command);

    if (!result.success) {
      return `Error executing command:\n${result.error}\nstderr: ${result.stderr || ""}`;
    }

    const output =
      result.stdout ||
      result.stderr ||
      "Command executed successfully (no output)";
    return `Command: ${command}\nExit code: ${result.exitCode || 0}\nOutput:\n${output}`;
  }
}

export function getAgentTools(): StructuredTool[] {
  return [
    //tools here
    new ReadFileTool(),
    new WriteFileTool(),
    new ListFilesTool(),
    new FileExistsTool(),
    new DeleteFileTool(),
    new SearchFilesTool(),
    new EditFileTool(),
    new ExecuteCommandTool(),
  ];
}
