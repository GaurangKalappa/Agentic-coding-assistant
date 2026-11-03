/**
 * History Manager - In-memory coordinator for session memory.
 *
 * Provides caching, lazy loading, and change tracking.
 * This is the main interface the agent and CLI use.
 */

import { SessionStore } from "./session.store.js";
import {
  type Action,
  type MemoryConfig,
  type Message,
  type Session,
  type SessionSummary,
  DEFAULT_MEMORY_CONFIG,
  createSession,
} from "./type.js";

interface HistoryManagerOptions {
  config?: Partial<MemoryConfig>;
}

export class HistoryManager {
  private store: SessionStore;
  private config: Required<Omit<MemoryConfig, "enableVectorStore">> & {
    enableVectorStore: boolean;
  };
  private cache: Map<string, Session> = new Map();
  private currentSessionId: string | null = null;
  private dirty: Set<string> = new Set(); // Session IDs with unsaved changes
  private accessOrder: string[] = []; // For LRU eviction
  private maxCachedSessions: number = 10;
  private saveQueue: Map<string, Promise<void> | null> = new Map(); // Serialize saves per session

  constructor(options: HistoryManagerOptions = {}) {
    this.config = {
      ...DEFAULT_MEMORY_CONFIG,
      ...options.config,
    };
    this.store = new SessionStore({ storagePath: this.config.storagePath });
    this.maxCachedSessions = 10;
  }

  /**
   * Get the currently active session.
   * Creates a new one if none exists.
   */
  async getCurrentSession(): Promise<Session> {
    if (this.currentSessionId) {
      const cached = this.cache.get(this.currentSessionId);
      if (cached) {
        this.touchAccess(this.currentSessionId);
        return { ...cached }; // Return copy to prevent accidental mutation
      }

      // Not in cache, load from disk
      const loaded = await this.store.loadSession(this.currentSessionId);
      if (loaded) {
        this.setCache(this.currentSessionId, loaded);
        return { ...loaded };
      }

      // Session file missing, treat as no current session
      this.currentSessionId = null;
    }

    // Create new session
    return await this.createSession();
  }

  /**
   * Create a new session and make it current.
   */
  async createSession(name?: string, projectRoot?: string): Promise<Session> {
    const session = createSession(name, projectRoot);
    this.setCache(session.id, session);
    this.currentSessionId = session.id;
    this.markDirty(session.id);

    // Auto-save if enabled (async, non-blocking)
    if (this.config.autoSave) {
      this.saveAsync(session.id);
    }

    return { ...session };
  }

  /**
   * Switch to an existing session by ID.
   */
  async switchSession(sessionId: string): Promise<Session> {
    const session = await this.store.loadSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    this.setCache(session.id, session);
    this.currentSessionId = session.id;

    return { ...session };
  }

  /**
   * Add a message to the current session.
   */
  async addMessage(message: Omit<Message, "timestamp">): Promise<void> {
    const session = await this.getCurrentSession();
    const fullMessage: Message = {
      ...message,
      timestamp: Date.now(),
    };

    session.messages.push(fullMessage);
    session.updatedAt = Date.now();

    // Enforce max messages limit
    if (session.messages.length > this.config.maxMessagesPerSession) {
      // Remove oldest messages (keep most recent)
      const excess =
        session.messages.length - this.config.maxMessagesPerSession;
      session.messages = session.messages.slice(excess);
    }

    this.setCache(session.id, session);
    this.markDirty(session.id);

    if (this.config.autoSave) {
      this.saveAsync(session.id);
    }
  }

  /**
   * Add an action record to the current session.
   */
  async addAction(action: Omit<Action, "id" | "timestamp">): Promise<void> {
    const session = await this.getCurrentSession();
    const fullAction: Action = {
      ...action,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    };

    session.actions.push(fullAction);
    session.updatedAt = Date.now();
    session.metadata.totalIterations =
      (session.metadata.totalIterations || 0) + 1;

    this.setCache(session.id, session);
    this.markDirty(session.id);

    if (this.config.autoSave) {
      this.saveAsync(session.id);
    }
  }

  /**
   * Get recent messages from the current session (without loading full context).
   */
  getRecentMessages(count: number = 10): Message[] {
    if (!this.currentSessionId) return [];

    const session = this.cache.get(this.currentSessionId);
    if (!session) return [];

    const start = Math.max(0, session.messages.length - count);
    return session.messages.slice(start).map((m) => ({ ...m }));
  }

  /**
   * Get all messages from current session (caller should not mutate).
   * Converts legacy 'tool' role messages to 'user' with "Observation: " prefix
   * to maintain compatibility with correct format.
   */
  getAllMessages(): Message[] {
    if (!this.currentSessionId) return [];
    const session = this.cache.get(this.currentSessionId);
    if (!session) return [];

    return session.messages.map((m) => {
      if (m.role === "tool") {
        // Migrate old format to standard Observation format
        const content = m.content.startsWith("Observation: ")
          ? m.content
          : `Observation: ${m.content}`;
        return {
          role: "user" as const,
          content,
          timestamp: m.timestamp,
          toolName: m.toolName,
        };
      }
      return { ...m };
    });
  }

  /**
   * Get session summary (metadata only).
   */
  async getSessionPreview(sessionId: string): Promise<SessionSummary | null> {
    if (sessionId === this.currentSessionId) {
      const session = await this.getCurrentSession();
      return {
        id: session.id,
        name: session.name!,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: session.messages.length,
        actionCount: session.actions.length,
        projectRoot: session.metadata.projectRoot!,
      };
    }

    return await this.store.getSessionPreview(sessionId);
  }

  /**
   * List all sessions.
   */
  async listSessions(): Promise<SessionSummary[]> {
    return await this.store.listSessions();
  }

  async listActiveSessions(): Promise<SessionSummary[]> {
    return await this.store.listActiveSessions();
  }

  /**
   * Get the current session ID (if any).
   */
  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * Explicitly save the current session (auto-save usually handles this).
   * Waits for any pending auto-saves to complete first.
   */
  async saveCurrentSession(): Promise<void> {
    if (!this.currentSessionId) return;
    await this.saveAsync(this.currentSessionId);
  }

  /**
   * Rename the current session.
   */
  async renameCurrentSession(name: string): Promise<void> {
    if (!this.currentSessionId) {
      throw new Error("No active session");
    }

    const session = this.cache.get(this.currentSessionId);
    if (!session) {
      throw new Error("Current session not in cache");
    }

    session.name = name;
    session.updatedAt = Date.now();
    this.markDirty(this.currentSessionId);

    if (this.config.autoSave) {
      this.saveAsync(this.currentSessionId);
    }
  }

  /**
   * Load a session by ID (without switching).
   */
  async loadSession(sessionId: string): Promise<Session | null> {
    return await this.store.loadSession(sessionId);
  }

  /**
   * Get the store instance (for advanced operations).
   */
  getStore(): SessionStore {
    return this.store;
  }

  /**
   * Set a session in the cache with LRU management.
   */
  private setCache(id: string, session: Session): void {
    // Evict oldest if cache is full and adding new key
    if (!this.cache.has(id) && this.cache.size >= this.maxCachedSessions) {
      const lruKey = this.accessOrder.shift();
      if (lruKey) {
        // If not dirty, evict from cache
        if (!this.dirty.has(lruKey)) {
          this.cache.delete(lruKey);
        } else {
          // Dirty session stays in cache but we move its LRU entry to end
          // Actually we removed it from order, so we need to keep it
          // Let's not evict dirty sessions and simplify: skip
          this.accessOrder.unshift(lruKey); // Put it back
        }
      }
    }

    this.cache.set(id, { ...session });
    this.touchAccess(id);
  }

  /**
   * Update LRU access order.
   */
  private touchAccess(id: string): void {
    const index = this.accessOrder.indexOf(id);
    if (index !== -1) {
      this.accessOrder.splice(index, 1);
    }
    this.accessOrder.push(id);
  }

  /**
   * Mark a session as having unsaved changes.
   */
  private markDirty(id: string): void {
    this.dirty.add(id);
  }

  /**
   * Clear dirty flag after save.
   */
  private markClean(id: string): void {
    this.dirty.delete(id);
  }

  /**
   * Async save (non-blocking, called during operations).
   * Serializes saves per session to avoid race conditions.
   * Returns a promise that resolves when the save is complete.
   */
  private saveAsync(id: string): Promise<void> {
    const existing = this.saveQueue.get(id);
    const savePromise = (existing ?? Promise.resolve())
      .then(async () => {
        await this.saveNow(id);
      })
      .catch((err) => {
        console.error(`Async save failed for session ${id}:`, err);
      })
      .finally(() => {
        this.saveQueue.delete(id);
      });
    this.saveQueue.set(id, savePromise);
    return savePromise;
  }

  /**
   * Save a session immediately (blocking).
   */
  private async saveNow(id: string): Promise<void> {
    const session = this.cache.get(id);
    if (!session) return;

    try {
      await this.store.saveSession(session);
      this.markClean(id);
    } catch (error) {
      console.error(`Failed to save session ${id}:`, error);
    }
  }

  /**
   * Flush all dirty sessions (call on shutdown).
   */
  async flush(): Promise<void> {
    const dirtyIds = Array.from(this.dirty);
    for (const id of dirtyIds) {
      await this.saveNow(id);
    }
  }

  /**
   * Get the current step index (0-based).
   */
  getCurrentStepIndex(): number {
    if (!this.currentSessionId) return -1;
    const session = this.cache.get(this.currentSessionId);
    if (!session) return -1;
    return session.metadata.currentStep ?? -1;
  }

  /**
   * Set the current step index.
   */
  async setCurrentStepIndex(index: number): Promise<void> {
    const session = await this.getCurrentSession();
    session.metadata.currentStep = index;
    this.setCache(session.id, session);
    this.markDirty(session.id);
    if (this.config.autoSave) this.saveAsync(session.id);
  }
}
