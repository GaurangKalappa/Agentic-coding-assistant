// FileSystems functions helpers
import * as fs from "fs";
import * as path from "path";

export interface FileReadResult {
  success: boolean;
  content?: string;
  error?: string;
  path: string;
}
export interface FileWriteResult {
  success: boolean;
  error?: string;
  path: string;
}

export interface FileInfo {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number | undefined;
  modified?: Date | undefined;
}

export async function readFile(filePath: string): Promise<FileReadResult> {
  try {
    const resolvedPath = path.resolve(process.cwd(), filePath);

    if (!resolvedPath.startsWith(process.cwd())) {
      return {
        success: false,
        error:
          "Access denied: Attempt to read a file outside the project directory.",
        path: filePath,
      };
    }
    const content = await fs.promises.readFile(resolvedPath, "utf-8");
    return {
      success: true,
      content,
      path: filePath,
    };
  } catch (error) {
    return {
      success: false,
      error: `Error reading file: ${error instanceof Error ? error.message : String(error)}`,
      path: filePath,
    };
  }
}

export async function writeFile(
  filePath: string,
  content: string,
): Promise<FileWriteResult> {
  try {
    const resolvedPath = path.resolve(process.cwd(), filePath);
    if (!resolvedPath.startsWith(process.cwd())) {
      return {
        success: false,
        error:
          "Access denied: Attempt to write a file outside the project directory.",
        path: filePath,
      };
    }

    await fs.promises.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.promises.writeFile(resolvedPath, content, "utf-8");
    return {
      success: true,
      path: filePath,
    };
  } catch (error) {
    return {
      success: false,
      error: `Error writing file: ${error instanceof Error ? error.message : String(error)}`,
      path: filePath,
    };
  }
}

export async function listFiles(
  dirPath: string = ".",
): Promise<{ success: boolean; files?: FileInfo[]; error?: string }> {
  try {
    const resolvedPath = path.resolve(process.cwd(), dirPath);

    if (!resolvedPath.startsWith(process.cwd())) {
      return {
        success: false,
        error: "Access denied: Path outside project root",
      };
    }

    const entries = await fs.promises.readdir(resolvedPath, {
      withFileTypes: true,
    });
    const files: FileInfo[] = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(resolvedPath, entry.name);

        let stats: fs.Stats | undefined;

        try {
          stats = await fs.promises.stat(fullPath);
        } catch (error) {}

        return {
          name: entry.name,
          path: path.relative(process.cwd(), fullPath),
          isDirectory: entry.isDirectory(),
          size: stats?.size,
          modified: stats?.mtime,
        };
      }),
    );

    return {
      success: true,
      files,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

export async function fileExists(
  filePath: string,
): Promise<{ exists: boolean; path: string }> {
  try {
    const resolvedPath = path.resolve(process.cwd(), filePath);

    if (!resolvedPath.startsWith(process.cwd())) {
      return {
        exists: false,
        path: filePath,
      };
    }

    await fs.promises.access(resolvedPath);
    return { exists: true, path: filePath };
  } catch (error) {
    return {
      exists: false,
      path: filePath,
    };
  }
}

export async function deleteFile(filePath: string): Promise<FileWriteResult> {
  try {
    const resolvedPath = path.resolve(process.cwd(), filePath);

    if (!resolvedPath.startsWith(process.cwd())) {
      return {
        success: false,
        error: "Access denied: Path outside project root",
        path: filePath,
      };
    }
    const stats = await fs.promises.stat(resolvedPath);

    if (stats.isDirectory()) {
      return {
        success: false,
        error: "Cannot delete directory with deleteFile (use deleteDirectory)",
        path: filePath,
      };
    }

    await fs.promises.unlink(resolvedPath);

    return {
      success: true,
      path: filePath,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      path: filePath,
    };
  }
}

