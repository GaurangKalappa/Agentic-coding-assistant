import * as fs from "fs";
import * as path from "path";
import { readFile } from "./fileSystem.js";

export interface SearchOptions {
  pattern: string;
  path?: string;
  filePattern?: string | undefined;
  caseSensitive?: boolean;
  lineNumber?: boolean;
  maxResults?: number | undefined;
  includeBinary?: boolean;
}

export interface SearchResult {
  file: string;
  line: number;
  column: number;
  match: string;
  context: string;
}

async function getFilesToSearch(
  searchPath: string,
  filePattern?: string,
): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (
            entry.name.startsWith(".") ||
            entry.name === "node_modules" ||
            entry.name === "dist"
          ) {
            continue;
          }
          await walk(fullPath);
        } else if (entry.isFile()) {
          if (filePattern) {
            const ext = path.extname(entry.name).toLowerCase();
            const baseName = path.basename(entry.name);

            const patternRegex = new RegExp(
              `^${filePattern.replace(/\*/g, ".*").replace(/\?/g, ".")}$`,
            );
            if (
              !patternRegex.test(entry.name) &&
              !patternRegex.test(baseName)
            ) {
              continue;
            }
          }
          files.push(fullPath);
        }
      }
    } catch (error) {
      //skip directories we cannot read
    }
  }
  await walk(searchPath);
  return files;
}

async function searchInFile(
  filePath: string,
  pattern: RegExp,
  options: SearchOptions,
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];

  try {
    const readResult = await readFile(filePath);
    if (!readResult.success || !readResult.content) return results;

    const content = readResult.content;
    const lines = content.split("\n");

    lines.forEach((line: string, index: number) => {
      const matches = [...line.matchAll(pattern)];
      matches.forEach((match: RegExpMatchArray) => {
        if (match.index !== undefined) {
          results.push({
            file: filePath,
            line: index + 1,
            column: match.index + 1,
            match: match[0],
            context: line.trim(),
          });

          if (options.maxResults && results.length >= options.maxResults) {
            return false;
          }
        }
      });
    });
  } catch {
    // skip files
  }

  return results;
}

export async function searchFiles(
  options: SearchOptions,
): Promise<SearchResult[]> {
  const {
    pattern,
    path: searchPath = ".",
    filePattern,
    caseSensitive = false,
    maxResults,
  } = options;

  if (!pattern) {
    throw new Error("Pattern  is required");
  }

  const flags = caseSensitive ? "g" : "gi";
  let regex: RegExp;

  try {
    regex = new RegExp(pattern, flags);
  } catch {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    regex = new RegExp(escaped, flags);
  }

  const files = await getFilesToSearch(searchPath, filePattern);
  const allResults: SearchResult[] = [];

  for (const file of files) {
    const results = await searchInFile(file, regex, { ...options, maxResults });
    allResults.push(...results);

    if (maxResults && allResults.length >= maxResults) {
      break;
    }
  }

  return allResults;
}
