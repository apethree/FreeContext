import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
} from '@assistant-ui/react';
import { Thread } from '@/components/assistant-ui/thread';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ImageAttachmentAdapter } from '@/features/assistant-chat/ImageAttachmentAdapter';
import { SpeechToTextDictationAdapter } from '@/features/assistant-chat/SpeechToTextDictationAdapter';
import { useAssistantActionQueueStore } from '@/features/assistant-chat/useAssistantActionQueueStore';
import { useAudioCapture } from '@/features/assistant-chat/useAudioCapture';
import { useSttStatus } from '@/features/assistant-chat/useSttStatus';
import { useChatSession } from '@/features/chat/useChatSession';
import { PROVIDER_CATALOG, type ProviderModel } from '@/features/chat/providerCatalog';
import type { ChatProvider, ChatRuntime } from '@/features/chat/types';
import { MODE_CONFIG, MODE_ORDER } from '@/features/app/modeConfig';
import type { AppMode, AssistantScope } from '@/features/app/types';
import { useAppShellContext } from '@/features/app/AppShellContext';
import type { GatewayChatAttachment } from '@/gateway/demoTypes';
import { HugeiconsIcon } from '@/components/ui/hugeicons-icon';
import { useSyncCollections } from '@/shared/collections/SyncCollectionsProvider';
import { ensureProviderPreflight } from '@/shared/hooks/providerReadiness';
import {
  AlertCircleIcon,
  ArrowDown01Icon,
  Cancel01Icon,
  ChatEdit01Icon,
  ClipboardList,
  Clock03Icon,
  RefreshIcon,
  TaskDone01Icon,
} from '@hugeicons/core-free-icons';
import { getAppCapabilities } from '@/lib/appCapabilities';

type ProviderSelection = ChatProvider | 'auto';

type StatusModeRow = {
  mode: AppMode;
  ready: boolean;
  reason?: string;
};

const PROVIDER_ORDER = Object.keys(PROVIDER_CATALOG) as ChatProvider[];
const DEFAULT_PROVIDER: ChatProvider = PROVIDER_ORDER.includes('anthropic')
  ? 'anthropic'
  : (PROVIDER_ORDER[0] ?? 'openai');
const SLASH_COMMANDS = [
  { command: '/status', description: 'Show thread id, context usage, and mode health.' },
  { command: '/review', description: 'Open pending human review tasks.' },
  { command: '/actions', description: 'Open actions queue.' },
  { command: '/work', description: 'Open status drawer filtered to work mode.' },
  { command: '/finance', description: 'Open status drawer filtered to finance mode.' },
  { command: '/social', description: 'Open status drawer filtered to social mode.' },
  { command: '/health', description: 'Open status drawer filtered to health mode.' },
  { command: '/chats', description: 'Open status drawer filtered to chats mode.' },
  { command: '/mail', description: 'Open status drawer filtered to mail mode.' },
] as const;

function buildProviderModelsByProvider() {
  return PROVIDER_ORDER.reduce((accumulator, provider) => {
    accumulator[provider] = PROVIDER_CATALOG[provider].models;
    return accumulator;
  }, {} as Record<ChatProvider, ProviderModel[]>);
}

function buildDefaultModelByProvider() {
  return PROVIDER_ORDER.reduce((accumulator, provider) => {
    accumulator[provider] = PROVIDER_CATALOG[provider].models[0]?.id ?? '';
    return accumulator;
  }, {} as Record<ChatProvider, string>);
}

function toGatewayAttachment(part: { image?: string; filename?: string }): GatewayChatAttachment | null {
  if (typeof part.image !== 'string') return null;
  const match = /^data:([^;]+);base64,(.+)$/.exec(part.image.trim());
  if (!match) return null;
  return {
    type: 'image',
    mimeType: match[1],
    content: match[2],
    fileName: part.filename,
  };
}

function parseModeCommand(input: string): AppMode | null {
  const cmd = input.trim().toLowerCase().split(/\s+/)[0] ?? '';
  if (cmd === '/work') return 'work';
  if (cmd === '/finance') return 'finance';
  if (cmd === '/social') return 'social';
  if (cmd === '/health') return 'health';
  if (cmd === '/chats') return 'chats';
  if (cmd === '/mail') return 'mail';
  return null;
}

function scopeLabel(scope: AssistantScope): string {
  if (scope === 'all') return 'One Shot';
  return MODE_CONFIG[scope].label;
}

export function GlobalAssistantPage() {
  const capabilities = useMemo(() => getAppCapabilities(), []);
  const { getAuthToken } = useSyncCollections();
  const {
    assistantWorkspace,
  } = useAppShellContext();

  const [providerSelection, setProviderSelection] = useState<ProviderSelection>(DEFAULT_PROVIDER);
  const [runtime, setRuntime] = useState<ChatRuntime>('auto');
  const [providerModelsByProvider, setProviderModelsByProvider] = useState<Record<ChatProvider, ProviderModel[]>>(
    () => buildProviderModelsByProvider(),
  );
  const [modelByProvider, setModelByProvider] = useState<Record<ChatProvider, string>>(
    () => buildDefaultModelByProvider(),
  );
  const [statusRows, setStatusRows] = useState<StatusModeRow[]>([]);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusDetail, setStatusDetail] = useState<string>('');
  const [statusRefreshTick, setStatusRefreshTick] = useState(0);
  const sttStatus = useSttStatus();

  const availableProviders = useMemo(
    () => PROVIDER_ORDER.filter((provider) => (providerModelsByProvider[provider]?.length ?? 0) > 0),
    [providerModelsByProvider],
  );
  const effectiveProvider = useMemo<ChatProvider>(
    () => (providerSelection === 'auto' ? (availableProviders[0] ?? DEFAULT_PROVIDER) : providerSelection),
    [availableProviders, providerSelection],
  );

  const models = useMemo(
    () => {
      const fromGateway = providerModelsByProvider[effectiveProvider] ?? [];
      return fromGateway.length > 0 ? fromGateway : PROVIDER_CATALOG[effectiveProvider].models;
    },
    [effectiveProvider, providerModelsByProvider],
  );

  const activeModel = useMemo(
    () => {
      const selected = modelByProvider[effectiveProvider];
      if (selected && models.some((entry) => entry.id === selected)) {
        return selected;
      }
      return models[0]?.id ?? '';
    },
    [effectiveProvider, modelByProvider, models],
  );

  const providerSelectionLabel = providerSelection === 'auto'
    ? `Auto -> ${PROVIDER_CATALOG[effectiveProvider].label}`
    : PROVIDER_CATALOG[providerSelection].label;

  const sessionId = assistantWorkspace.selectedSessionId;

  const chat = useChatSession({
    sessionId,
    provider: effectiveProvider,
    runtime,
    model: activeModel,
  });

  const actionQueueScope = assistantWorkspace.drawerKind === 'review'
    ? assistantWorkspace.drawerModeFilter
    : assistantWorkspace.activeScope;

  const actionQueue = useAssistantActionQueueStore({ scope: actionQueueScope });

  const imageAttachmentAdapter = useMemo(() => new ImageAttachmentAdapter(), []);
  const audioCapture = useAudioCapture();
  const dictationAdapter = useMemo(
    () => (
      capabilities.speechToText
        ? new SpeechToTextDictationAdapter({
          startCapture: audioCapture.start,
          stopCapture: audioCapture.stop,
        })
        : undefined
    ),
    [audioCapture.start, audioCapture.stop, capabilities.speechToText],
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      PROVIDER_ORDER.map(async (provider) => {
        try {
          const result = await window.appShell.pipelineListProviderModels({ provider });
          if (!Array.isArray(result.models) || result.models.length === 0) {
            return null;
          }
          return { provider, models: result.models as ProviderModel[] };
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      const availableEntries = entries.filter(
        (entry): entry is { provider: ChatProvider; models: ProviderModel[] } => Boolean(entry),
      );
      if (availableEntries.length === 0) return;

      setProviderModelsByProvider((previous) => {
        const next = { ...previous };
        for (const entry of availableEntries) {
          next[entry.provider] = entry.models;
        }
        return next;
      });

      setModelByProvider((previous) => {
        let changed = false;
        const next = { ...previous };
        for (const entry of availableEntries) {
          const currentSelection = next[entry.provider];
          if (!currentSelection || !entry.models.some((model) => model.id === currentSelection)) {
            next[entry.provider] = entry.models[0]?.id ?? '';
            changed = true;
          }
        }
        return changed ? next : previous;
      });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (assistantWorkspace.drawerKind !== 'status') return;
    let cancelled = false;
    setStatusLoading(true);

    const scopedModes = assistantWorkspace.drawerModeFilter === 'all'
      ? MODE_ORDER
      : [assistantWorkspace.drawerModeFilter];

    void ensureProviderPreflight(getAuthToken, {
      provider: effectiveProvider,
      runtime,
      capabilityProbe: true,
      model: activeModel,
      localRuntimeAvailable: capabilities.platform === 'desktop',
    }).then(async (ready) => {
      if (cancelled) return;
      setStatusRows(scopedModes.map((mode) => ({
        mode,
        ready: Boolean(ready.ready),
        reason: ready.reason,
      })));
      const gateway = await window.appShell.gatewayGetState();
      if (cancelled) return;
      setStatusDetail(`${gateway.connectionStatus} · ${gateway.connectionMode}`);
    }).catch(() => {
      if (cancelled) return;
      setStatusRows([]);
      setStatusDetail('status unavailable');
    }).finally(() => {
      if (!cancelled) {
        setStatusLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    activeModel,
    assistantWorkspace.drawerKind,
    assistantWorkspace.drawerModeFilter,
    capabilities.platform,
    effectiveProvider,
    getAuthToken,
    runtime,
    statusRefreshTick,
  ]);

  useEffect(() => {
    if (assistantWorkspace.drawerKind === 'none') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        assistantWorkspace.closeDrawer();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [assistantWorkspace]);

  const onNew = useCallback(
    async (message: {
      content: ReadonlyArray<{ type: string; text?: string; image?: string; filename?: string }>;
      attachments?: ReadonlyArray<{ content?: ReadonlyArray<{ type: string; image?: string; filename?: string }> }>;
    }) => {
      const text = message.content
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('\n');

      const inlineImages = message.content
        .filter((part): part is { type: 'image'; image: string; filename?: string } => part.type === 'image' && typeof part.image === 'string');

      const attachmentImages = (message.attachments ?? []).flatMap((attachment) =>
        (attachment.content ?? []).filter(
          (part): part is { type: 'image'; image: string; filename?: string } =>
            part.type === 'image' && typeof (part as { image?: string }).image === 'string',
        ),
      );

      const gatewayAttachments = [...inlineImages, ...attachmentImages]
        .map((part) => toGatewayAttachment(part))
        .filter((part): part is GatewayChatAttachment => Boolean(part));

      const trimmed = text.trim();
      const modeCommand = parseModeCommand(trimmed);
      if (gatewayAttachments.length === 0 && trimmed) {
        if (trimmed.startsWith('/status')) {
          assistantWorkspace.setDrawer('status', 'all');
          return;
        }
        if (trimmed.startsWith('/review') || trimmed.startsWith('/actions')) {
          assistantWorkspace.setDrawer('review', assistantWorkspace.activeScope);
          return;
        }
        if (modeCommand) {
          assistantWorkspace.setDrawer('status', modeCommand);
          return;
        }
      }

      if (trimmed || gatewayAttachments.length > 0) {
        await chat.send(text, gatewayAttachments);
      }
    },
    [assistantWorkspace, chat.send],
  );

  const convertMessage = useCallback((msg: typeof chat.messages[number]) => ({
    role: msg.role as 'user' | 'assistant',
    content: [
      ...(msg.text ? [{ type: 'text' as const, text: msg.text }] : []),
      ...((msg.attachments ?? []).map((attachment) => ({
        type: 'image' as const,
        image: `data:${attachment.mimeType};base64,${attachment.content}`,
        filename: attachment.fileName,
      }))),
    ],
    id: msg.id,
    createdAt: new Date(msg.timestampMs),
    ...(msg.isError ? { metadata: { custom: { isError: true } } } : {}),
  }), []);

  const runtimeAdapters = useMemo(
    () => (
      dictationAdapter
        ? { attachments: imageAttachmentAdapter, dictation: dictationAdapter }
        : { attachments: imageAttachmentAdapter }
    ),
    [dictationAdapter, imageAttachmentAdapter],
  );

  const externalStore = useMemo(() => ({
    messages: chat.messages,
    isRunning: chat.status === 'streaming' || chat.status === 'waiting',
    convertMessage,
    onNew,
    adapters: runtimeAdapters,
  }), [chat.messages, chat.status, convertMessage, onNew, runtimeAdapters]);

  const assistantRuntime = useExternalStoreRuntime(externalStore);

  const quickActionChip = (
    <button
      type="button"
      className="assistant-quick-chip"
      onClick={() => assistantWorkspace.setDrawer('review', assistantWorkspace.activeScope)}
    >
      <HugeiconsIcon icon={ClipboardList} className="h-3.5 w-3.5" />
      <span>{actionQueue.pendingCount} pending action{actionQueue.pendingCount === 1 ? '' : 's'}</span>
    </button>
  );

  const refreshDrawer = useCallback(() => {
    if (assistantWorkspace.drawerKind === 'review') {
      void actionQueue.refresh();
      return;
    }
    if (assistantWorkspace.drawerKind === 'status') {
      setStatusRefreshTick((previous) => previous + 1);
    }
  }, [actionQueue, assistantWorkspace.drawerKind]);

  const drawerSlot = (
    <div className="space-y-2">
      {quickActionChip}
      {assistantWorkspace.drawerKind !== 'none' ? (
        <div className="assistant-command-drawer">
          <div className="assistant-command-drawer-header">
            <div>
              <p className="text-sm font-semibold text-foreground">
                {assistantWorkspace.drawerKind === 'status' ? 'Status' : 'Review'}
              </p>
              <p className="text-xs text-muted-foreground">
                {assistantWorkspace.drawerKind === 'status'
                  ? `Scope: ${scopeLabel(assistantWorkspace.drawerModeFilter)}`
                  : `Pending actions in ${scopeLabel(actionQueueScope)}`}
              </p>
            </div>
            <div className="assistant-command-drawer-actions">
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                title="Refresh drawer"
                aria-label="Refresh drawer"
                onClick={refreshDrawer}
              >
                <HugeiconsIcon
                  icon={RefreshIcon}
                  className={`h-3.5 w-3.5 ${statusLoading || actionQueue.loading ? 'animate-spin' : ''}`}
                />
              </Button>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                title="Close drawer"
                aria-label="Close drawer"
                onClick={assistantWorkspace.closeDrawer}
              >
                <HugeiconsIcon icon={Cancel01Icon} className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {assistantWorkspace.drawerKind === 'status' ? (
            <div className="space-y-2">
              <div className="text-[11px] text-muted-foreground">{statusLoading ? 'Checking mode health...' : statusDetail}</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {statusRows.map((row) => (
                  <article key={row.mode} className="assistant-status-row">
                    <div className="flex items-center gap-2">
                      <span className={`assistant-status-dot ${row.ready ? 'ready' : 'blocked'}`} />
                      <span className="font-medium">{MODE_CONFIG[row.mode].label}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">{row.ready ? 'ready' : (row.reason ?? 'blocked')}</div>
                  </article>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{actionQueue.pendingCount} pending</span>
              </div>
              <div className="max-h-52 space-y-2 overflow-auto pr-1">
                {actionQueue.items.length === 0 ? (
                  <div className="rounded-md border border-border/60 bg-muted/30 px-2 py-2 text-xs text-muted-foreground">
                    No review items.
                  </div>
                ) : actionQueue.items.map((item) => (
                  <article key={item.id} className="assistant-review-row">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{item.detail}</p>
                    </div>
                    <div className="assistant-review-actions">
                      <Button type="button" size="sm" variant="outline" onClick={() => actionQueue.approve(item.id)}>
                        <HugeiconsIcon icon={TaskDone01Icon} className="h-3.5 w-3.5" />
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => actionQueue.reject(item.id)}>
                        <HugeiconsIcon icon={Cancel01Icon} className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const next = window.prompt('Edit response draft', item.editedResponse ?? '') ?? '';
                          actionQueue.edit(item.id, next);
                        }}
                      >
                        <HugeiconsIcon icon={ChatEdit01Icon} className="h-3.5 w-3.5" />
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => actionQueue.resolve(item.id)}>
                        Resolve
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-1 pb-4 pt-2 sm:pt-3">
      <div className="min-h-0 flex-1">
        <AssistantRuntimeProvider runtime={assistantRuntime}>
          <Thread
            drawerSlot={drawerSlot}
            dictationTooltip={audioCapture.microphoneLabel || 'System default microphone'}
            composerControlSlot={(
              <div className="assistant-composer-controls">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="ghost" size="sm" className="assistant-composer-select-btn">
                      <span className="assistant-composer-select-title">Provider</span>
                      <span className="assistant-composer-select-value">{providerSelectionLabel}</span>
                      <HugeiconsIcon icon={ArrowDown01Icon} className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="top" align="start" className="w-56">
                    <DropdownMenuItem
                      className="text-xs"
                      onSelect={() => setProviderSelection('auto')}
                    >
                      <span className="assistant-dropdown-check">{providerSelection === 'auto' ? '✓' : ''}</span>
                      Auto
                    </DropdownMenuItem>
                    {PROVIDER_ORDER.map((provider) => (
                      <DropdownMenuItem
                        key={provider}
                        className="text-xs"
                        onSelect={() => setProviderSelection(provider)}
                      >
                        <span className="assistant-dropdown-check">{providerSelection === provider ? '✓' : ''}</span>
                        {PROVIDER_CATALOG[provider].label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="assistant-composer-select-btn"
                      disabled={models.length === 0}
                    >
                      <span className="assistant-composer-select-title">Model</span>
                      <span className="assistant-composer-select-value">{models.find((entry) => entry.id === activeModel)?.label ?? 'No models'}</span>
                      <HugeiconsIcon icon={ArrowDown01Icon} className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="top" align="start" className="w-64">
                    {models.length > 0 ? (
                      models.map((entry) => (
                        <DropdownMenuItem
                          key={entry.id}
                          className="text-xs"
                          onSelect={() => setModelByProvider((previous) => ({ ...previous, [effectiveProvider]: entry.id }))}
                        >
                          <span className="assistant-dropdown-check">{entry.id === activeModel ? '✓' : ''}</span>
                          <span className="truncate">{entry.label}</span>
                        </DropdownMenuItem>
                      ))
                    ) : (
                      <DropdownMenuItem disabled className="text-xs">
                        <span className="assistant-dropdown-check" />
                        No models
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>

                <div className="assistant-runtime-switch">
                  {(['auto', 'cloud', 'local'] as ChatRuntime[]).map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={runtime === value ? 'assistant-runtime-btn assistant-runtime-btn-active' : 'assistant-runtime-btn'}
                      onClick={() => setRuntime(value)}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>
            )}
            composerStatusSlot={(
              <div className="assistant-status-rail">
                <div className="assistant-connection-line">
                  <span className="inline-flex items-center gap-1">
                    {chat.preflight.state === 'ready' ? <HugeiconsIcon icon={TaskDone01Icon} className="h-3 w-3 text-emerald-500" /> : null}
                    {chat.preflight.state === 'checking' ? <HugeiconsIcon icon={Clock03Icon} className="h-3 w-3 text-amber-500" /> : null}
                    {(chat.preflight.state === 'blocked' || chat.status === 'error') ? <HugeiconsIcon icon={AlertCircleIcon} className="h-3 w-3 text-rose-500" /> : null}
                    <span>{chat.preflightLabel}</span>
                  </span>
                </div>
                {sttStatus.visible ? (
                  <div className={sttStatus.state === 'error' ? 'assistant-stt-line assistant-stt-line-error' : 'assistant-stt-line'}>
                    <span>{sttStatus.label}</span>
                    {sttStatus.state === 'error' ? (
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        className="assistant-stt-retry-btn"
                        disabled={sttStatus.retrying}
                        onClick={() => { void sttStatus.retry(); }}
                      >
                        {sttStatus.retrying ? 'Retrying...' : 'Retry'}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
            slashCommands={SLASH_COMMANDS.map((entry) => ({ command: entry.command, description: entry.description }))}
          />
        </AssistantRuntimeProvider>
      </div>
    </div>
  );
}
