import { createPatch } from "diff";

export interface DiffResult {
  patch: string;
  original: string;
  modified: string;
  fileName: string;
}

export function generateDiff(
  fileName: string,
  original: string,
  modified: string,
  contextLines: number = 3,
): DiffResult {
  const patch = createPatch(
    fileName,
    original,
    modified,
    `--- ${fileName}`,
    `+++ ${fileName}`,
    { context: contextLines },
  );

  return {
    patch,
    original,
    modified,
    fileName,
  };
}
