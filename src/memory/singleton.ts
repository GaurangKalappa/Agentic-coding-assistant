// Allow any module to access the globa history manager without explicit dependency injection
import { HistoryManager } from "./history.js";
let globalMemory: HistoryManager | null = null;

export function setGlobalMemory(memory: HistoryManager): void {
  globalMemory = memory;
}

export function getGlobalMemory(): HistoryManager | null {
  return globalMemory;
}
