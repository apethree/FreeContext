import type { ChatProvider } from '@/features/chat/types';

export type ProviderModel = {
  id: string;
  label: string;
};

export const PROVIDER_CATALOG: Record<ChatProvider, { label: string; models: ProviderModel[] }> = {
  openai: {
    label: 'OpenAI',
    models: [
      { id: 'gpt-5.2', label: 'GPT-5.2' },
      { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' },
      { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
    ],
  },
  anthropic: {
    label: 'Anthropic',
    models: [
      { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    ],
  },
  gemini: {
    label: 'Gemini',
    models: [
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
      { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    ],
  },
};
