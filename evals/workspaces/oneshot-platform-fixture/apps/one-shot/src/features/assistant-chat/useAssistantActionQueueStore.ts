import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppMode, AssistantScope } from '@/features/app/types';
import { useChannels } from '@/shared/hooks/useChannels';

export type AssistantActionStatus = 'pending' | 'approved' | 'rejected' | 'resolved';

export type AssistantActionItem = {
  id: string;
  mode: AppMode;
  scope: AssistantScope;
  source: 'chats' | 'mail' | 'hooks';
  title: string;
  detail: string;
  sessionId: string;
  createdAtMs: number;
  status: AssistantActionStatus;
  editedResponse?: string;
};

type ActionMutation = {
  status?: AssistantActionStatus;
  editedResponse?: string;
};

type UseAssistantActionQueueStoreOptions = {
  scope: AssistantScope;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function modeFromScope(scope: AssistantScope): AppMode | null {
  if (scope === 'all') return null;
  return scope;
}

export function useAssistantActionQueueStore({
  scope,
}: UseAssistantActionQueueStoreOptions) {
  const channels = useChannels();
  const [items, setItems] = useState<AssistantActionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [mutationsById, setMutationsById] = useState<Record<string, ActionMutation>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [mailRes, hookEventsRes] = await Promise.allSettled([
        Promise.resolve({ ok: false as const, reason: 'mail.account.list not yet available', payload: null }),
        window.appShell.pipelineListHookEvents({ limit: 25 }),
      ]);

      const next: AssistantActionItem[] = [];
      const now = Date.now();

      channels
        .filter((channel) => channel.is_active)
        .forEach((channel, index) => {
          next.push({
            id: `chats:${channel.id}`,
            mode: 'chats',
            scope: 'chats',
            source: 'chats',
            title: `Review channel auto-reply for ${channel.id}`,
            detail: `Pending human review for ${channel.type} channel message.`,
            sessionId: `channel:${channel.id}`,
            createdAtMs: now - index * 1000,
            status: 'pending',
          });
        });

      if (mailRes.status === 'fulfilled' && mailRes.value.ok) {
        const payload = asObject(mailRes.value.payload);
        const mailboxesRaw = Array.isArray(payload?.mailboxes)
          ? payload?.mailboxes
          : Array.isArray(payload?.accounts)
            ? payload?.accounts
            : [];

        mailboxesRaw.forEach((mailboxRaw, index) => {
          const mailbox = asObject(mailboxRaw);
          if (!mailbox) return;
          const mailboxId = String(mailbox.id ?? mailbox.mailboxId ?? `mailbox-${index}`);
          const label = String(mailbox.displayName ?? mailbox.primaryAddress ?? mailboxId);
          const pending = Number(mailbox.pendingApprovals ?? mailbox.pending ?? 0);
          if (!Number.isFinite(pending) || pending <= 0) return;

          next.push({
            id: `mail:${mailboxId}`,
            mode: 'mail',
            scope: 'mail',
            source: 'mail',
            title: `${label} has ${pending} pending approvals`,
            detail: 'Drafted outbound responses are waiting for review.',
            sessionId: `assistant:global:mail`,
            createdAtMs: now - index * 1200,
            status: 'pending',
          });
        });
      }

      if (hookEventsRes.status === 'fulfilled' && hookEventsRes.value.ok) {
        const events = Array.isArray(hookEventsRes.value.events) ? hookEventsRes.value.events : [];
        events
          .slice(0, 5)
          .forEach((eventRaw, index) => {
            const event = asObject(eventRaw);
            if (!event) return;
            const status = String(event.status ?? '').toLowerCase();
            if (status !== 'failed' && status !== 'pending') return;
            const name = String(event.name ?? event.event ?? `event-${index + 1}`);
            const eventId = String(event.id ?? `${name}-${index}`);
            next.push({
              id: `hooks:${eventId}`,
              mode: 'work',
              scope: 'work',
              source: 'hooks',
              title: `Hook event requires review: ${name}`,
              detail: String(event.error ?? event.detail ?? 'Manual intervention may be required.'),
              sessionId: 'assistant:global:work',
              createdAtMs: now - index * 1500,
              status: 'pending',
            });
          });
      }

      setItems(next.sort((a, b) => b.createdAtMs - a.createdAtMs));
    } finally {
      setLoading(false);
    }
  }, [channels]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filteredItems = useMemo(() => {
    const modeFilter = modeFromScope(scope);
    const base = modeFilter ? items.filter((item) => item.mode === modeFilter) : items;
    return base.map((item) => {
      const mutation = mutationsById[item.id] ?? {};
      return {
        ...item,
        status: mutation.status ?? item.status,
        editedResponse: mutation.editedResponse ?? item.editedResponse,
      };
    });
  }, [items, mutationsById, scope]);

  const updateMutation = useCallback((id: string, patch: ActionMutation) => {
    setMutationsById((previous) => ({
      ...previous,
      [id]: {
        ...(previous[id] ?? {}),
        ...patch,
      },
    }));
  }, []);

  const approve = useCallback((id: string) => updateMutation(id, { status: 'approved' }), [updateMutation]);
  const reject = useCallback((id: string) => updateMutation(id, { status: 'rejected' }), [updateMutation]);
  const resolve = useCallback((id: string) => updateMutation(id, { status: 'resolved' }), [updateMutation]);
  const edit = useCallback((id: string, text: string) => updateMutation(id, { editedResponse: text }), [updateMutation]);

  const pendingCount = useMemo(
    () => filteredItems.filter((item) => item.status === 'pending').length,
    [filteredItems],
  );

  return {
    items: filteredItems,
    loading,
    pendingCount,
    refresh,
    approve,
    reject,
    resolve,
    edit,
  };
}
