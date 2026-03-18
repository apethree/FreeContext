import { Copy } from '@hugeicons/core-free-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { HugeiconsIcon } from '@/components/ui/hugeicons-icon';
import { Input } from '@/components/ui/input';
import { PROVIDER_CATALOG } from '@/features/chat/providerCatalog';
import { useChatSession } from '@/features/chat/useChatSession';
import type { ChatProvider, ChatRuntime } from '@/features/chat/types';

export function ChatSurface() {
  const [provider, setProvider] = useState<ChatProvider>('openai');
  const [runtime, setRuntime] = useState<ChatRuntime>('auto');
  const [model, setModel] = useState(PROVIDER_CATALOG.openai.models[0]?.id ?? 'gpt-4o');
  const [providerModels, setProviderModels] = useState(PROVIDER_CATALOG.openai.models);
  const [input, setInput] = useState('');
  const [sessionId] = useState(() => `chat-${crypto.randomUUID()}`);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  const models = providerModels.length > 0 ? providerModels : PROVIDER_CATALOG[provider].models;
  const activeModel = useMemo(() => (
    models.some((entry) => entry.id === model) ? model : (models[0]?.id ?? '')
  ), [model, models]);

  const chat = useChatSession({
    sessionId,
    provider,
    runtime,
    model: activeModel,
  });

  const sendDisabled = chat.preflight.state !== 'ready' || chat.status === 'waiting' || !input.trim();

  useEffect(() => {
    let cancelled = false;
    const fallback = PROVIDER_CATALOG[provider].models;
    setProviderModels(fallback);
    void window.appShell.pipelineListProviderModels({ provider }).then((result) => {
      if (cancelled) return;
      if (Array.isArray(result.models) && result.models.length > 0) {
        setProviderModels(result.models);
      }
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [provider]);
  const copyMessage = useCallback((messageId: string, text: string) => {
    if (!text) return;
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedMessageId(messageId);
      setTimeout(() => {
        setCopiedMessageId((current) => (current === messageId ? null : current));
      }, 1200);
    }).catch(() => undefined);
  }, []);

  return (
    <Card className="border-border/70 bg-card/85 shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Chat Sandbox</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 md:grid-cols-4">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Provider</div>
            <select
              value={provider}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              onChange={(event) => {
                const next = event.target.value as ChatProvider;
                setProvider(next);
                setModel(PROVIDER_CATALOG[next].models[0]?.id ?? '');
              }}
            >
              {Object.entries(PROVIDER_CATALOG).map(([value, entry]) => (
                <option key={value} value={value}>{entry.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Model</div>
            <select
              value={activeModel}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              onChange={(event) => setModel(event.target.value)}
            >
              {models.map((entry) => (
                <option key={entry.id} value={entry.id}>{entry.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Runtime</div>
            <div className="flex gap-1">
              {(['auto', 'cloud', 'local'] as ChatRuntime[]).map((value) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={runtime === value ? 'default' : 'outline'}
                  onClick={() => setRuntime(value)}
                >
                  {value}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Preflight</div>
            <div className="flex items-center gap-2">
              <Badge variant={chat.preflight.state === 'ready' ? 'success' : chat.preflight.state === 'blocked' ? 'warning' : 'info'}>
                {chat.preflight.state}
              </Badge>
              <Button type="button" variant="outline" size="sm" onClick={() => void chat.refreshPreflight()}>
                Recheck
              </Button>
            </div>
          </div>
        </div>

        <div className="rounded-md border border-border/70 bg-background/40 p-2 text-xs text-muted-foreground">
          {chat.preflightLabel}
          {' • '}
          session:
          {' '}
          <code>{sessionId}</code>
        </div>

        <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border border-border/70 bg-background/30 p-3">
          {chat.messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No messages yet.</p>
          ) : (
            chat.messages.map((message) => (
              <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-md px-3 py-2 text-sm ${
                  message.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-foreground'
                }`}
                >
                  <div className="select-text whitespace-pre-wrap break-words">{message.text}</div>
                  <div className="mt-2 flex justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[11px]"
                      title={copiedMessageId === message.id ? 'Copied' : 'Copy message'}
                      onClick={() => copyMessage(message.id, message.text)}
                    >
                      <HugeiconsIcon icon={Copy} className="mr-1 h-[var(--app-icon-size)] w-[var(--app-icon-size)]" />
                      {copiedMessageId === message.id ? 'Copied' : 'Copy'}
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask something..."
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey) return;
              event.preventDefault();
              if (sendDisabled) return;
              const message = input.trim();
              setInput('');
              void chat.send(message);
            }}
          />
          <Button
            type="button"
            disabled={sendDisabled}
            onClick={() => {
              const message = input.trim();
              if (!message) return;
              setInput('');
              void chat.send(message);
            }}
          >
            Send
          </Button>
        </div>
        {chat.error ? (
          <div
            className="group relative cursor-pointer select-text rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/40"
            title="Click to copy"
            onClick={() => void navigator.clipboard.writeText(chat.error!)}
          >
            <span className="font-semibold">Error:</span>
            {' '}
            <code className="break-all">{chat.error}</code>
            <span className="ml-2 hidden text-[10px] opacity-60 group-hover:inline">(click to copy)</span>
          </div>
        ) : null}
        {!chat.error && chat.preflight.state === 'blocked' ? (() => {
          const reason = chat.preflight.reason;
          return (
            <div
              className="group relative cursor-pointer select-text rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/40"
              title="Click to copy"
              onClick={() => void navigator.clipboard.writeText(reason)}
            >
              <span className="font-semibold">Preflight blocked:</span>
              {' '}
              <code className="break-all">{reason}</code>
              <span className="ml-2 hidden text-[10px] opacity-60 group-hover:inline">(click to copy)</span>
            </div>
          );
        })() : null}
      </CardContent>
    </Card>
  );
}
