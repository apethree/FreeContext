import type { GatewayChatAttachment } from '@/gateway/demoTypes';

export type ChatRuntime = 'local' | 'cloud' | 'auto';
export type ChatProvider = 'openai' | 'anthropic' | 'gemini';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  attachments?: GatewayChatAttachment[];
  timestampMs: number;
  isError?: boolean;
};

export type ChatSessionStatus = 'idle' | 'waiting' | 'streaming' | 'error';

export type PreflightStatus =
  | { state: 'unknown' }
  | { state: 'checking' }
  | { state: 'ready'; local: boolean; cloud: boolean; healed: boolean }
  | { state: 'blocked'; reason: string; blockedBy: 'no-token' | 'no-cloud-token' | 'not-connected' };
