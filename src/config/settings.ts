import * as fsp from "fs/promises";
import * as path from "path";

export interface AllowlistRule {
  path?: string; // Exact path to allow
  command?: string;
  operation?: "read" | "delete" | "execute" | "write"; // For file rules, specify the operation
  addedAt: number;
}
export interface Settings {
  version: string;
  allowlist: {
    files: AllowlistRule[];
    commands: AllowlistRule[];
  };
  preferences: {
    confirmationMode: "manual" | "auto";
    autoConfirmNonInteractive: boolean;
  };
}
const DEFAULT_SETTINGS: Settings = {
  version: "1.0",
  allowlist: {
    files: [],
    commands: [],
  },
  preferences: {
    confirmationMode: "manual",
    autoConfirmNonInteractive: true,
  },
};

export class SettingsManager {
  private settings: Settings;
  private dirty: boolean = false;
  private settingsPath: string;

  constructor(projectRoot?: string) {
    const root = projectRoot || process.cwd();
    this.settings = { ...DEFAULT_SETTINGS };
    this.settingsPath = path.resolve(
      root,
      ".aicodingagent",
      "settings.local.json",
    );
  }

  //Methods
  getSettings(): Settings {
    return this.settings;
  }

  isCommandAllowed(command: string): boolean {
    const rules = this.settings.allowlist.commands;
    return rules.some((rule) => {
      if (!rule.command) return false;
      return command.startsWith(rule.command) || command.includes(rule.command);
    });
  }

  isFileAllowed(filePath: string, operation: "write" | "delete"): boolean {
    const rules = this.settings.allowlist.files;
    return rules.some((rule) => {
      if (
        rule.path === filePath &&
        (rule.operation === operation || rule.operation === "write")
      ) {
        return true;
      }
      return false;
    });
  }

  async addCommandToAllowlist(command: string): Promise<void> {
    const exists = this.settings.allowlist.commands.some(
      (r) => r.command === command,
    );
    if (exists) return;

    this.settings.allowlist.commands.push({
      command,
      addedAt: Date.now(),
    });

    this.dirty = true;
    await this.save();
  }

  async save(): Promise<void> {
    if (!this.dirty) return;

    try {
      await this.ensureDirectory();
      const tempPath = ` ${this.settingsPath}.tmp`;
      const data = JSON.stringify(this.settings, null, 2);

      await fsp.writeFile(tempPath, data, "utf-8");
      await fsp.rename(tempPath, this.settingsPath);

      this.dirty = false;
    } catch (error) {
      console.log(`Error to save settings`);
      throw error;
    }
  }

  async addFileToAllowlist(
    filePath: string,
    operation: "write" | "delete",
  ): Promise<void> {
    const exists = this.settings.allowlist.files.some(
      (r) => r.path === filePath && r.operation === operation,
    );

    if (exists) return;

    this.settings.allowlist.files.push({
      path: filePath,
      operation,
      addedAt: Date.now(),
    });

    this.dirty = true;
    await this.save();
  }

  private async ensureDirectory(): Promise<void> {
    const dir = path.dirname(this.settingsPath);
  }
}
