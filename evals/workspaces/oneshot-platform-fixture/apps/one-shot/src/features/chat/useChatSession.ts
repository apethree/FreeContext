import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GatewayChatAttachment, GatewayPushEvent } from '@/gateway/demoTypes';
import type { ChatMessage, ChatProvider, ChatRuntime, ChatSessionStatus, PreflightStatus } from '@/features/chat/types';
import { useSyncCollections } from '@/shared/collections/SyncCollectionsProvider';
import { ensureProviderPreflight } from '@/shared/hooks/providerReadiness';
import { useProviderHealth } from '@/shared/hooks/useProviderHealth';

type UseChatSessionOptions = {
  sessionId: string;
  provider: ChatProvider;
  runtime: ChatRuntime;
  model: string;
};

type ParsedGatewayChatPayload = {
  sessionKey: string;
  state?: string;
  errorMessage?: string;
  seq?: number;
  message?: {
    role?: string;
    text?: string;
  };
};

const MAX_ATTACHMENT_BYTES = 5_000_000;
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

function estimateBase64DecodedBytes(base64: string): number {
  const cleaned = base64.replace(/\s+/g, '');
  if (!cleaned) return 0;
  const padding = cleaned.endsWith('==') ? 2 : cleaned.endsWith('=') ? 1 : 0;
  return Math.floor((cleaned.length * 3) / 4) - padding;
}

function validateAttachments(attachments: GatewayChatAttachment[]): string | null {
  for (const [index, attachment] of attachments.entries()) {
    const label = attachment.fileName || `attachment-${index + 1}`;
    if (attachment.type !== 'image') {
      return `${label}: only image attachments are supported`;
    }
    if (!ALLOWED_IMAGE_MIME_TYPES.has(attachment.mimeType)) {
      return `${label}: unsupported image type ${attachment.mimeType}`;
    }
    const decodedBytes = estimateBase64DecodedBytes(attachment.content);
    if (decodedBytes <= 0 || decodedBytes > MAX_ATTACHMENT_BYTES) {
      return `${label}: exceeds 5 MB image limit`;
    }
  }
  return null;
}

function parseGatewayChatPayload(event: GatewayPushEvent): ParsedGatewayChatPayload | null {
  if (event.type !== 'chat') return null;
  if (!event.payload || typeof event.payload !== 'object') return null;
  const payload = event.payload as Record<string, unknown>;
  const sessionKey = typeof payload.sessionKey === 'string' ? payload.sessionKey : '';
  if (!sessionKey) return null;
  const messageRaw = payload.message;
  const message = messageRaw && typeof messageRaw === 'object'
    ? (messageRaw as { role?: unknown; text?: unknown })
    : undefined;
  return {
    sessionKey,
    state: typeof payload.state === 'string' ? payload.state : undefined,
    errorMessage: typeof payload.errorMessage === 'string' ? payload.errorMessage : undefined,
    seq: typeof payload.seq === 'number' && Number.isFinite(payload.seq) ? payload.seq : undefined,
    message: message
      ? {
        role: typeof message.role === 'string' ? message.role : undefined,
        text: typeof message.text === 'string' ? message.text : undefined,
      }
      : undefined,
  };
}

function normalizeHistoryMessage(raw: unknown): ChatMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;
  const id = typeof entry.id === 'string' ? entry.id : crypto.randomUUID();
  const role = entry.role === 'assistant' ? 'assistant' : entry.role === 'user' ? 'user' : null;
  const text = typeof entry.text === 'string' ? entry.text : '';
  if (!role || !text.trim()) return null;
  const timestampMs = typeof entry.timestamp === 'number' ? entry.timestamp : Date.now();
  return { id, role, text, timestampMs };
}

export function useChatSession(opts: UseChatSessionOptions) {
  const providerHealth = useProviderHealth(opts.provider);
  const { getAuthToken } = useSyncCollections();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatSessionStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<PreflightStatus>({ state: 'unknown' });
  const isDesktopRuntime = window.appShell.getCapabilities().platform === 'desktop';
  // Track the ID of the currently streaming assistant message so deltas update it in place.
  const streamingMessageIdRef = useRef<string | null>(null);
  // Gateway events can arrive more than once (retries/reconnects); de-duplicate by seq.
  const seenEventSeqRef = useRef<Set<number>>(new Set());

  const ensureReady = useCallback(async (options?: { capabilityProbe?: boolean }) => {
    const capabilityProbe = options?.capabilityProbe === true;
    setPreflight({ state: 'checking' });
    try {
      const result = await ensureProviderPreflight(getAuthToken, {
        provider: opts.provider,
        runtime: opts.runtime,
        capabilityProbe,
        ...(capabilityProbe ? { model: opts.model } : {}),
        localRuntimeAvailable: isDesktopRuntime,
      });
      if (!result.ready) {
        setPreflight({
          state: 'blocked',
          reason: result.reason || 'provider not ready',
          blockedBy: result.blockedBy,
        });
        return false;
      }
      setPreflight({
        state: 'ready',
        local: result.local,
        cloud: result.cloud,
        healed: false,
      });
      return true;
    } catch (nextError) {
      setPreflight({
        state: 'blocked',
        reason: String(nextError),
        blockedBy: 'not-connected',
      });
      return false;
    }
  }, [getAuthToken, isDesktopRuntime, opts.model, opts.provider, opts.runtime]);

  useEffect(() => {
    if (opts.runtime === 'local') {
      return;
    }

    if (!providerHealth.hasCredential) {
      setPreflight({ state: 'blocked', reason: 'no cloud token', blockedBy: 'no-token' });
      return;
    }

    if (providerHealth.readiness === 'ready') {
      setPreflight({
        state: 'ready',
        local: false,
        cloud: true,
        healed: false,
      });
      return;
    }

    if (providerHealth.readiness === 'blocked' || providerHealth.readiness === 'error') {
      setPreflight({
        state: 'blocked',
        reason: providerHealth.readinessReason || 'provider not ready',
        blockedBy: providerHealth.readinessReason.toLowerCase().includes('cloud not connected')
          ? 'not-connected'
          : 'no-token',
      });
    }
  }, [opts.runtime, providerHealth]);

  useEffect(() => {
    let mounted = true;
    void window.appShell.gatewayGetChatHistory({ sessionKey: opts.sessionId }).then((history) => {
      if (!mounted) return;
      const normalized = Array.isArray(history.messages)
        ? history.messages
          .map(normalizeHistoryMessage)
          .filter((entry): entry is ChatMessage => Boolean(entry))
        : [];
      setMessages(normalized);
    }).catch((err) => {
      console.error('[useChatSession] history load failed', err);
    });
    return () => {
      mounted = false;
    };
  }, [opts.sessionId]);

  useEffect(() => {
    seenEventSeqRef.current = new Set();
  }, [opts.sessionId]);

  useEffect(() => {
    return window.appShell.onGatewayEvent((event) => {
      const parsed = parseGatewayChatPayload(event);
      if (!parsed || parsed.sessionKey !== opts.sessionId) return;
      if (typeof parsed.seq === 'number') {
        if (seenEventSeqRef.current.has(parsed.seq)) {
          return;
        }
        seenEventSeqRef.current.add(parsed.seq);
        if (seenEventSeqRef.current.size > 1024) {
          const first = seenEventSeqRef.current.values().next().value as number | undefined;
          if (typeof first === 'number') {
            seenEventSeqRef.current.delete(first);
          }
        }
      }

      if (parsed.state === 'error') {
        streamingMessageIdRef.current = null;
        const errorText = parsed.errorMessage || parsed.message?.text || 'chat error';
        setError(errorText);
        setStatus('error');
        setMessages((previous) => [
          ...previous,
          { id: crypto.randomUUID(), role: 'assistant', text: errorText, timestampMs: Date.now(), isError: true },
        ]);
        void window.appShell.logEvent({
          domain: 'chat.session',
          action: 'inference_error',
          status: 'error',
          data: { sessionId: opts.sessionId, error: errorText },
        });
        return;
      }

      if (parsed.state === 'aborted') {
        streamingMessageIdRef.current = null;
        setStatus('idle');
        const text = parsed.message?.text ?? parsed.errorMessage ?? '';
        if (text.trim()) {
          setMessages((previous) => [
            ...previous,
            { id: crypto.randomUUID(), role: 'assistant', text, timestampMs: Date.now() },
          ]);
        }
        return;
      }

      const text = parsed.message?.text ?? '';
      if (!text.trim()) return;

      if (parsed.state === 'delta') {
        // Streaming: update the same message in place (accumulated text).
        setMessages((previous) => {
          const streamId = streamingMessageIdRef.current;
          if (streamId) {
            return previous.map((entry) =>
              entry.id === streamId ? { ...entry, text, timestampMs: Date.now() } : entry,
            );
          }
          const newId = crypto.randomUUID();
          streamingMessageIdRef.current = newId;
          return [...previous, { id: newId, role: 'assistant', text, timestampMs: Date.now() }];
        });
        setStatus('streaming');
        return;
      }

      if (parsed.state === 'final') {
        const role: 'user' | 'assistant' = parsed.message?.role === 'user' ? 'user' : 'assistant';
        setMessages((previous) => {
          const streamId = streamingMessageIdRef.current;
          if (streamId) {
            return previous.map((entry) =>
              entry.id === streamId ? { ...entry, role, text, timestampMs: Date.now() } : entry,
            );
          }
          // Deduplicate: if this is a user message and the last local message is an
          // optimistically-added user message with the same text within 2 seconds, skip.
          if (role === 'user' && previous.length > 0) {
            const last = previous[previous.length - 1];
            if (
              last.role === 'user' &&
              last.text === text &&
              Math.abs(Date.now() - last.timestampMs) < 2000
            ) {
              return previous;
            }
          }
          // Deduplicate repeated assistant finals that occasionally arrive twice.
          if (role === 'assistant' && previous.length > 0) {
            const last = previous[previous.length - 1];
            if (
              last.role === 'assistant' &&
              last.text === text &&
              Math.abs(Date.now() - last.timestampMs) < 2000
            ) {
              return previous;
            }
          }
          return [...previous, { id: crypto.randomUUID(), role, text, timestampMs: Date.now() }];
        });
        streamingMessageIdRef.current = null;
        setStatus('idle');
        return;
      }
    });
  }, [opts.sessionId]);

  const send = useCallback(async (text: string, attachments: GatewayChatAttachment[] = []) => {
    const message = text.trim();
    const hasAttachments = attachments.length > 0;
    if (!message && !hasAttachments) return { ok: false as const, reason: 'empty-message' };
    const attachmentError = validateAttachments(attachments);
    if (attachmentError) {
      setStatus('error');
      setError(attachmentError);
      return { ok: false as const, reason: attachmentError };
    }
    const ready = await ensureReady({ capabilityProbe: false });
    if (!ready) return { ok: false as const, reason: 'not-ready' };

    setError(null);
    setStatus('waiting');
    setMessages((previous) => [
      ...previous,
      {
        id: crypto.randomUUID(),
        role: 'user',
        text: message,
        attachments: attachments.length > 0 ? attachments : undefined,
        timestampMs: Date.now(),
      },
    ]);

    let response: Awaited<ReturnType<typeof window.appShell.pipelineChatSend>>;
    try {
      response = await window.appShell.pipelineChatSend({
        provider: opts.provider,
        runtime: opts.runtime,
        model: opts.model,
        sessionId: opts.sessionId,
        message,
        attachments: attachments.length > 0 ? attachments : undefined,
        idempotencyKey: crypto.randomUUID(),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      setStatus('error');
      setError(reason);
      void ensureReady({ capabilityProbe: true }).catch(() => undefined);
      setMessages((previous) => [
        ...previous,
        { id: crypto.randomUUID(), role: 'assistant', text: reason, timestampMs: Date.now(), isError: true },
      ]);
      void window.appShell.logEvent({
        domain: 'chat.session',
        action: 'send_error',
        status: 'error',
        data: { sessionId: opts.sessionId, error: reason },
      });
      return { ok: false as const, reason };
    }

    if (!response.ok) {
      const reason = response.error || 'chat send failed';
      setStatus('error');
      setError(reason);
      void ensureReady({ capabilityProbe: true }).catch(() => undefined);
      // For connection/preflight failures no gateway event fires, so inject the error message here
      setMessages((previous) => [
        ...previous,
        { id: crypto.randomUUID(), role: 'assistant', text: reason, timestampMs: Date.now(), isError: true },
      ]);
      void window.appShell.logEvent({
        domain: 'chat.session',
        action: 'send_blocked',
        status: 'error',
        data: { sessionId: opts.sessionId, error: reason, blockedBy: (response as { blockedBy?: string }).blockedBy },
      });
      return { ok: false as const, reason };
    }

    if (response.status === 'submitted-cloud' || response.status === 'submitted-local-ws') {
      setStatus('streaming');
    } else {
      setStatus('idle');
    }
    return { ok: true as const };
  }, [ensureReady, opts.model, opts.provider, opts.runtime, opts.sessionId]);

  const preflightLabel = useMemo(() => {
    if (preflight.state === 'unknown') return 'Unknown';
    if (preflight.state === 'checking') return 'Checking...';
    if (preflight.state === 'blocked') return `Blocked: ${preflight.reason}`;
    const details = [
      preflight.local ? 'local' : '',
      preflight.cloud ? 'cloud' : '',
      preflight.healed ? 'healed' : '',
    ].filter(Boolean).join(', ');
    return details ? `Ready (${details})` : 'Ready';
  }, [preflight]);

  return {
    messages,
    status,
    error,
    preflight,
    preflightLabel,
    send,
    refreshPreflight: () => ensureReady({ capabilityProbe: true }),
  };
}
