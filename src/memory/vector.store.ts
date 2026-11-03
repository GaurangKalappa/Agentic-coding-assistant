export interface VectorDocument {
  id: string;
  content: string;
  embedding?: number[];
  metadata?:
    | {
        sessionId?: string;
        messageRole?: string;
        timestamp?: number;
        [key: string]: any;
      }
    | undefined;
}
export interface VectorStore {
  addText(text: string, metadata?: VectorDocument["metadata"]): Promise<void>;
  search(query: string, limit?: number): Promise<VectorDocument[]>;
  clear(): Promise<void>;
}
export class InMemoryVectorStore implements VectorStore {
  private documents: VectorDocument[] = [];
  async search(query: string, limit?: number): Promise<VectorDocument[]> {
    const lowerQuery = query.toLowerCase();
    const results = this.documents.filter((doc) =>
      doc.content.toLowerCase().includes(lowerQuery),
    );
    return limit ? results.slice(0, limit) : results;
  }
  async clear(): Promise<void> {
    this.documents = [];
  }

  async addText(
    text: string,
    metadata?: VectorDocument["metadata"],
  ): Promise<void> {
    const doc: VectorDocument = {
      id: crypto.randomUUID(),
      content: text,
      metadata: metadata ? { ...metadata } : undefined,
    };
    this.documents.push(doc);
  }

  getDocumentCount(): number {
    return this.documents.length;
  }
}
