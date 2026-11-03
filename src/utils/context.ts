import * as fs from "fs";
import * as path from "path";

const CONTEXT_FILENAME = "AICODINGAGENT.md";
export function contextFileExists(projectRoot?: string) {
  const root = projectRoot || process.cwd();
  const filePath = path.resolve(root, CONTEXT_FILENAME);
  return fs.existsSync(filePath);
}

export function createContextTemplate(projectRoot?: string): {
  success: boolean;
  path: string;
} {
  const root = projectRoot || process.cwd();
  const filePath = path.resolve(root, CONTEXT_FILENAME);

  if (fs.existsSync(filePath)) {
    return { success: false, path: filePath };
  }

  const template = `# AICODINGAGENT.md

    ## Architecture

    **Project Overview**
    - Brief description of the project
    - Main components and their responsibilities
    - Data flow and architecture patterns

    **Key Design Decisions**

    ## Tech Stack


    ## Coding standards



    ## Hard Rules ( Do not violate )

    **Safety:**
    - X NEVER execute destructive commands (rm -rf, force pushes)
    `;

  try {
    fs.writeFileSync(filePath, template, "utf-8");
    return { success: true, path: filePath };
  } catch (error) {
    console.error(`Failed to create ${CONTEXT_FILENAME}:`, error);
    return { success: false, path: filePath };
  }
}
