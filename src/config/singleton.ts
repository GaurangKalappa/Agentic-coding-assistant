import { SettingsManager } from "./settings.js";

let globalSettings: SettingsManager | null = null;

export function getGlobalSettings(): SettingsManager | null {
  return globalSettings;
}

export function isCommandAllowed(command: string): boolean {
  return globalSettings?.isCommandAllowed(command) || false;
}

export function isFileAllowed(filePath: string, operation: 'write' | 'delete'): boolean {
    return globalSettings?.isFileAllowed(filePath, operation) || false;
}
