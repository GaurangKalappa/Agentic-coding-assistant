export type MessageRole = "system" | "user" | "assistant" | "tool";
export interface Message {
  role: MessageRole;
  content: string;
  timestamp: number;
  toolCallId?: string | undefined;
  toolName?: string | undefined;
}

export interface ExecutionPlan {} //empty for now
export interface Action {
  id: string;
  toolName: string;
  input: Record<string, any>;
  output: string;
  timestamp: number;
  duration?: number | undefined;
  success: boolean;
  error?: string | undefined;
}
export interface Session {
  id: string;
  name?: string | undefined;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  actions: Action[];
  metadata: {
    model?: string;
    totalIterations?: number;
    tags?: string[];
    projectRoot?: string | undefined;
    plan?: ExecutionPlan;
    currentStep?: number;
  };
}

export interface MemoryConfig {
  storagePath: string;
  maxMessagesPerSession?: number;
  autoSave?: boolean;
  enableVectorStore?: boolean;
}

export function deserializeSession(data: {
  session: Session;
  version: string;
}): Session | null {
  try {
    if (!data.session?.id || !Array.isArray(data.session.messages)) {
      return null;
    }
    return data.session;
  } catch {
    return null;
  }
}

export const DEFAULT_MEMORY_CONFIG: Required<
  Omit<MemoryConfig, "enableVectorStore">
> & {
  enableVectorStore: boolean;
} = {
  storagePath: ".aicodingagent/memory",
  maxMessagesPerSession: 1000,
  autoSave: true,
  enableVectorStore: false,
};

export function createSession(name?: string, projectRoot?: string): Session {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    messages: [],
    actions: [],
    metadata: {
      projectRoot,
    },
  };
}

export function serializeSession(session: Session): {
  session: Session;
  version: string;
} {
  return {
    session: {
      ...session,
      updatedAt: Date.now(),
    },
    version: "1.0.0",
  };
}
export interface SessionSummary {
  id: string;
  name?: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  actionCount: number;
  projectRoot?: string;
}

export interface Message {
  role: MessageRole;
  content: string;
  timestamp: number;
  toolCallId?: string;
  toolName?: string;
}

export interface Action {
  id: string;
  toolName: string;
  input: Record<string, any>;
  output: string;
  timestamp: number;
  duration?: number;
  success: boolean;
  error?: string;
}

export function createMessage(
  role: MessageRole,
  content: string,
  options?: {
    toolCallId?: string;
    toolName?: string;
  },
): Message {
  return {
    role,
    content,
    timestamp: Date.now(),
    toolCallId: options?.toolCallId,
    toolName: options?.toolName,
  };
}
export function createAction(
  toolName: string,
  input: Record<string, any>,
  output: string,
  options?: {
    duration?: number;
    success?: boolean;
    error?: string;
  },
): Action {
  return {
    id: crypto.randomUUID(),
    toolName,
    input,
    output,
    timestamp: Date.now(),
    duration: options?.duration,
    success: options?.success ?? true,
    error: options?.error,
  };
}
