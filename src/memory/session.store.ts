/**
 * Session Store - File-based Persistence
 *
 * Handles reading/writing sessions to disk with atomic operations
 * and index management for fast session listing.
 */

import * as fsp from "fs/promises";
import * as path from "path";
import {
  type Session,
  type SessionSummary,
  deserializeSession,
  serializeSession,
} from "./type.js";

export interface SessionStoreOptions {
  storagePath: string;
}

export class SessionStore {
  private basePath: string;
  private sessionsPath: string;
  private indexPath: string;
  private indexWriteQueue: Promise<void> = Promise.resolve(); // Serialize index writes

  constructor(options: SessionStoreOptions) {
    this.basePath = path.resolve(process.cwd(), options.storagePath);
    this.sessionsPath = path.join(this.basePath, "sessions");
    this.indexPath = path.join(this.sessionsPath, "index.json");
  }

  /**
   * Ensure the storage directory structure exists.
   */
  async initialize(): Promise<void> {
    try {
      await fsp.mkdir(this.sessionsPath, { recursive: true });
    } catch (error: any) {
      console.error("Failed to create memory directory:", error);
      throw error;
    }
  }

  /**
   * Load a full session by ID.
   */
  async loadSession(sessionId: string): Promise<Session | null> {
    try {
      const filePath = path.join(this.sessionsPath, `${sessionId}.json`);
      const data = await fsp.readFile(filePath, "utf-8");
      const parsed = JSON.parse(data);
      return deserializeSession(parsed);
    } catch (error: any) {
      // File doesn't exist or is corrupt
      if (error.code === "ENOENT") {
        return null;
      }
      console.error(`Failed to load session ${sessionId}:`, error.message);
      return null;
    }
  }

  /**
   * Save a session atomically.
   * Writes to temp file first, then renames to prevent corruption.
   * Keeps a backup of the previous version if it exists.
   */
  async saveSession(session: Session): Promise<void> {
    try {
      await this.initialize();

      const filePath = path.join(this.sessionsPath, `${session.id}.json`);
      const tempPath = `${filePath}.tmp`;
      const backupPath = `${filePath}.bak`;

      const serialized = JSON.stringify(serializeSession(session), null, 2);

      // Create backup of existing file if it exists
      try {
        await fsp.access(filePath);
        await fsp.copyFile(filePath, backupPath);
      } catch {
        // No existing file to backup, continue
      }

      // Write to temp file (ensure directory exists)
      await fsp.mkdir(path.dirname(tempPath), { recursive: true });
      await fsp.writeFile(tempPath, serialized, "utf-8");

      // Atomic rename (temp → target)
      // On Windows, rename can fail due to permissions or cross-device links. Use copy+unlink fallback.
      try {
        await fsp.rename(tempPath, filePath);
      } catch (renameError: any) {
        // Common fallback scenarios: EXIST, EXDEV, EPERM, EACCES
        if (["EXIST", "EXDEV", "EPERM", "EACCES"].includes(renameError.code)) {
          await fsp.copyFile(tempPath, filePath);
          await fsp.unlink(tempPath);
        } else {
          throw renameError;
        }
      }

      // Update index
      await this.updateIndex(session);
    } catch (error: any) {
      console.error(`Failed to save session ${session.id}:`, error.message);
      throw error;
    }
  }

  /**
   * Delete a session by ID.
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    try {
      const filePath = path.join(this.sessionsPath, `${sessionId}.json`);
      await fsp.unlink(filePath);
      await this.removeFromIndex(sessionId);
      return true;
    } catch (error: any) {
      if (error.code === "ENOENT") {
        return false;
      }
      console.error(`Failed to delete session ${sessionId}:`, error.message);
      throw error;
    }
  }

  /**
   * List all sessions (lightweight summaries from index).
   * Returns sessions sorted by updatedAt descending (most recent first).
   */
  async listSessions(): Promise<SessionSummary[]> {
    try {
      await this.initialize();

      try {
        const indexData = await fsp.readFile(this.indexPath, "utf-8");
        const index = JSON.parse(indexData);
        return index.sessions || [];
      } catch {
        // Index doesn't exist or is corrupt, rebuild it
        return await this.rebuildIndex();
      }
    } catch (error: any) {
      console.error("Failed to list sessions:", error.message);
      return [];
    }
  }

  /**
   * List all sessions actives.
   * Returns sessions sorted by updatedAt descending (most recent first).
   */

  async listActiveSessions(): Promise<SessionSummary[]> {
    try {
      // We reuse the logic from listSessions to get the full array first
      const allSessions = await this.listSessions();

      // Filter to return only sessions where messageCount is greater than 0
      return allSessions.filter((session) => session.messageCount > 0);
    } catch (error: any) {
      console.error("Failed to list active sessions:", error.message);
      return [];
    }
  }
  /**
   * Get a preview of a session without loading full message history.
   * Useful for quick display in session lists.
   */
  async getSessionPreview(sessionId: string): Promise<SessionSummary | null> {
    const sessions = await this.listSessions();
    return sessions.find((s) => s.id === sessionId) || null;
  }

  /**
   * Search sessions by name or content keywords.
   * Currently does prefix matching on session name from index.
   */
  async searchSessions(query: string): Promise<SessionSummary[]> {
    const sessions = await this.listSessions();
    const lowerQuery = query.toLowerCase();

    return sessions.filter((session) => {
      // Search in name
      if (session.name?.toLowerCase().includes(lowerQuery)) {
        return true;
      }
      // Search in projectRoot path
      if (session.projectRoot?.toLowerCase().includes(lowerQuery)) {
        return true;
      }
      return false;
    });
  }

  /**
   * Update the index file with session metadata.
   * Called after every session save.
   */
  private async updateIndex(session: Session): Promise<void> {
    try {
      const sessions = await this.listSessions();

      // Remove existing entry for this session if present
      const filtered = sessions.filter((s) => s.id !== session.id);

      // Create new summary
      const summary: SessionSummary = {
        id: session.id,
        name: session.name!,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: session.messages.length,
        actionCount: session.actions.length,
        projectRoot: session.metadata.projectRoot!,
      };

      // Add and sort by updatedAt desc
      filtered.push(summary);
      filtered.sort((a, b) => b.updatedAt - a.updatedAt);

      await this.writeIndexQueued({ sessions: filtered });
    } catch (error: any) {
      console.error("Failed to update index:", error.message);
      // Don't throw - index failures shouldn't break session saves
    }
  }

  /**
   * Remove a session from the index.
   */
  private async removeFromIndex(sessionId: string): Promise<void> {
    try {
      const sessions = await this.listSessions();
      const filtered = sessions.filter((s) => s.id !== sessionId);
      await this.writeIndexQueued({ sessions: filtered });
    } catch (error: any) {
      console.error("Failed to remove from index:", error.message);
    }
  }

  /**
   * Write the index file atomically (internal - NOT queued).
   * Use writeIndexQueued() to avoid concurrent writes.
   */
  private async writeIndex(index: {
    sessions: SessionSummary[];
  }): Promise<void> {
    const tempPath = `${this.indexPath}.tmp`;
    const data = JSON.stringify(index, null, 2);

    await fsp.writeFile(tempPath, data, "utf-8");

    // Windows-friendly atomic update with fallback
    try {
      await fsp.rename(tempPath, this.indexPath);
    } catch (renameError: any) {
      // Common fallback scenarios: EXIST, EXDEV, EPERM, EACCES
      if (["EXIST", "EXDEV", "EPERM", "EACCES"].includes(renameError.code)) {
        await fsp.copyFile(tempPath, this.indexPath);
        await fsp.unlink(tempPath);
      } else {
        throw renameError;
      }
    }
  }

  /**
   * Write the index file with queuing to prevent concurrent access.
   */
  private async writeIndexQueued(index: {
    sessions: SessionSummary[];
  }): Promise<void> {
    // Chain to existing queue
    this.indexWriteQueue = (this.indexWriteQueue ?? Promise.resolve())
      .then(() => this.writeIndex(index))
      .catch((err) => {
        console.error("Index write failed:", err.message);
      });
    await this.indexWriteQueue;
  }

  /**
   * Rebuild the index by scanning all session files.
   * Used when the index is missing or corrupt.
   */
  private async rebuildIndex(): Promise<SessionSummary[]> {
    try {
      const files = await fsp.readdir(this.sessionsPath);

      const sessionFiles = files
        .filter(
          (f) =>
            f.endsWith(".json") && f !== "index.json" && !f.endsWith(".bak"),
        )
        .map((f) => path.join(this.sessionsPath, f));

      const summaries: SessionSummary[] = [];

      for (const file of sessionFiles) {
        try {
          const data = await fsp.readFile(file, "utf-8");
          const parsed = JSON.parse(data);
          const session = deserializeSession(parsed);

          if (session) {
            summaries.push({
              id: session.id,
              name: session.name!,
              createdAt: session.createdAt,
              updatedAt: session.updatedAt,
              messageCount: session.messages.length,
              actionCount: session.actions.length,
              projectRoot: session.metadata.projectRoot!,
            });
          }
        } catch {
          // Skip corrupt files
          continue;
        }
      }

      summaries.sort((a, b) => b.updatedAt - a.updatedAt);
      await this.writeIndexQueued({ sessions: summaries });

      return summaries;
    } catch (error: any) {
      console.error("Failed to rebuild index:", error.message);
      return [];
    }
  }

  /**
   * Clean up temp and backup files (maintenance operation).
   */
  async cleanup(): Promise<void> {
    try {
      const files = await fsp.readdir(this.sessionsPath);

      for (const file of files) {
        if (file.endsWith(".tmp") || file.endsWith(".bak")) {
          const filePath = path.join(this.sessionsPath, file);
          await fsp.unlink(filePath).catch(() => {});
        }
      }
    } catch (error: any) {
      console.error("Cleanup failed:", error.message);
    }
  }
}
