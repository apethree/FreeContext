import { File } from '@/components/assistant-ui/file';
import { MarkdownText } from '@/components/assistant-ui/markdown-text';
import { TooltipIconButton } from '@/components/assistant-ui/tooltip-icon-button';
import { Button } from '@/components/ui/button';
import {
  ActionBarPrimitive,
  AttachmentPrimitive,
  AuiIf,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useMessage,
} from '@assistant-ui/react';
import {
  AlertCircleIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  CopyIcon,
  MicIcon,
  PaperclipIcon,
  PencilIcon,
  RefreshCwIcon,
  SquareIcon,
  XIcon,
} from 'lucide-react';
import { type FC, type KeyboardEvent, type ReactNode, useMemo, useRef, useState } from 'react';

type ThreadProps = {
  drawerSlot?: ReactNode;
  composerControlSlot?: ReactNode;
  composerStatusSlot?: ReactNode;
  slashCommands?: Array<{ command: string; description: string }>;
  dictationTooltip?: string;
};

export const Thread: FC<ThreadProps> = ({
  drawerSlot,
  composerControlSlot,
  composerStatusSlot,
  slashCommands,
  dictationTooltip,
}) => {
  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root flex h-full flex-col bg-background"
      style={{ ['--thread-max-width' as string]: '44rem' }}
    >
      <ThreadPrimitive.Viewport
        turnAnchor="top"
        className="aui-thread-viewport relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth px-4 pt-4 select-text"
      >
        <AuiIf condition={(s) => s.thread.isEmpty}>
          <ThreadWelcome />
        </AuiIf>

        <ThreadPrimitive.Messages
          components={{ UserMessage, EditComposer, AssistantMessage }}
        />

        <ThreadPrimitive.ViewportFooter className="sticky bottom-0 mx-auto mt-auto flex w-full max-w-(--thread-max-width) flex-col gap-1 overflow-visible rounded-t-3xl bg-background pb-4 md:pb-6">
          <ThreadScrollToBottom />
          {drawerSlot ? <div className="thread-drawer-slot">{drawerSlot}</div> : null}
          <Composer
            composerControlSlot={composerControlSlot}
            composerStatusSlot={composerStatusSlot}
            slashCommands={slashCommands}
            dictationTooltip={dictationTooltip}
          />
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="Scroll to bottom"
        variant="outline"
        className="absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible dark:bg-background dark:hover:bg-accent"
      >
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

const ThreadWelcome: FC = () => {
  return (
    <div className="mx-auto my-auto flex w-full max-w-(--thread-max-width) grow flex-col">
      <div className="flex w-full grow flex-col items-center justify-center">
        <div className="flex size-full flex-col justify-center px-4">
          <h1 className="font-semibold text-2xl">Hello there!</h1>
          <p className="text-muted-foreground text-xl">How can I help you today?</p>
        </div>
      </div>
    </div>
  );
};

const Composer: FC<{
  composerControlSlot?: ReactNode;
  composerStatusSlot?: ReactNode;
  slashCommands?: Array<{ command: string; description: string }>;
  dictationTooltip?: string;
}> = ({
  composerControlSlot,
  composerStatusSlot,
  slashCommands = [],
  dictationTooltip,
}) => {
  const [draftValue, setDraftValue] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const filteredSlashCommands = useMemo(() => {
    const trimmed = draftValue.trimStart();
    if (!trimmed.startsWith('/')) return [];
    const query = trimmed.toLowerCase();
    return slashCommands
      .filter((entry) => entry.command.startsWith(query))
      .slice(0, 8);
  }, [draftValue, slashCommands]);

  const slashOpen = filteredSlashCommands.length > 0;

  const applySlashCommand = (command: string) => {
    const input = inputRef.current;
    if (!input) return;
    const next = `${command} `;
    input.value = next;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    setDraftValue(next);
    setHighlightIndex(0);
  };

  const onSlashKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!slashOpen) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightIndex((current) => Math.min(filteredSlashCommands.length - 1, current + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightIndex((current) => Math.max(0, current - 1));
      return;
    }
    if (event.key === 'Enter') {
      const target = filteredSlashCommands[highlightIndex];
      if (!target) return;
      event.preventDefault();
      applySlashCommand(target.command);
    }
  };

  return (
    <ComposerPrimitive.Root className="relative z-20 flex w-full flex-col">
      {slashOpen ? (
        <div className="assistant-slash-panel">
          {filteredSlashCommands.map((entry, index) => (
            <button
              key={entry.command}
              type="button"
              className={index === highlightIndex ? 'assistant-slash-item assistant-slash-item-active' : 'assistant-slash-item'}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applySlashCommand(entry.command)}
            >
              <span className="font-medium">{entry.command}</span>
              <span className="text-muted-foreground">{entry.description}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="assistant-composer-shell">
        <ComposerPrimitive.Attachments
          components={{ Attachment: ComposerAttachmentChip, Image: ComposerAttachmentChip }}
        />
        <ComposerPrimitive.Input
          ref={inputRef}
          placeholder="Send a message..."
          className="mb-1 max-h-32 min-h-14 w-full resize-none bg-transparent px-4 pt-2 pb-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-0"
          rows={1}
          autoFocus
          aria-label="Message input"
          onChange={(event) => setDraftValue(event.currentTarget.value)}
          onKeyDown={onSlashKeyDown}
        />
        <ComposerAction composerControlSlot={composerControlSlot} dictationTooltip={dictationTooltip} />
      </div>
      {composerStatusSlot ? <div className="mt-1 px-1">{composerStatusSlot}</div> : null}
    </ComposerPrimitive.Root>
  );
};

const ComposerAction: FC<{ composerControlSlot?: ReactNode; dictationTooltip?: string }> = ({
  composerControlSlot,
  dictationTooltip,
}) => {
  return (
    <div className="relative mx-2 mb-2 flex items-center justify-between gap-2">
      <div className="flex items-center gap-0.5">
        <ComposerPrimitive.AddAttachment asChild>
          <TooltipIconButton
            tooltip="Add image"
            side="top"
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 rounded-full text-muted-foreground hover:text-foreground"
            aria-label="Add image attachment"
          >
            <PaperclipIcon className="size-4" />
          </TooltipIconButton>
        </ComposerPrimitive.AddAttachment>
        {composerControlSlot ? <div className="ml-1">{composerControlSlot}</div> : null}
      </div>
      <div className="flex items-center gap-0.5">
        <AuiIf condition={(s) => s.thread.capabilities.dictation && s.composer.dictation == null}>
          <ComposerPrimitive.Dictate asChild>
            <TooltipIconButton
              tooltip={dictationTooltip ?? 'Dictate (system default microphone)'}
              tooltipClassName="rounded-md px-2 py-1 text-[11px] leading-none shadow-sm"
              side="top"
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 rounded-full text-muted-foreground hover:text-foreground"
              aria-label="Start dictation"
            >
              <MicIcon className="size-4" />
            </TooltipIconButton>
          </ComposerPrimitive.Dictate>
        </AuiIf>
        <AuiIf condition={(s) => s.composer.dictation != null}>
          <ComposerPrimitive.StopDictation asChild>
            <TooltipIconButton
              tooltip="Stop dictation"
              side="top"
              type="button"
              variant="emphasis"
              size="icon"
              className="size-8 rounded-full text-emphasis-foreground hover:text-emphasis-foreground"
              aria-label="Stop dictation"
            >
              <SquareIcon className="size-3 animate-pulse fill-emphasis-foreground text-emphasis-foreground" />
            </TooltipIconButton>
          </ComposerPrimitive.StopDictation>
        </AuiIf>
        <AuiIf condition={(s) => !s.thread.isRunning}>
          <ComposerPrimitive.Send asChild>
            <TooltipIconButton
              tooltip="Send message"
              side="bottom"
              type="button"
              variant="emphasis"
              size="icon"
              className="size-8 rounded-full text-emphasis-foreground hover:text-emphasis-foreground"
              aria-label="Send message"
            >
              <ArrowUpIcon className="size-4" />
            </TooltipIconButton>
          </ComposerPrimitive.Send>
        </AuiIf>
        <AuiIf condition={(s) => s.thread.isRunning}>
          <ComposerPrimitive.Cancel asChild>
            <Button
              type="button"
              variant="emphasis"
              size="icon"
              className="size-8 rounded-full text-emphasis-foreground hover:text-emphasis-foreground"
              aria-label="Stop generating"
            >
              <SquareIcon className="size-3 fill-emphasis-foreground text-emphasis-foreground" />
            </Button>
          </ComposerPrimitive.Cancel>
        </AuiIf>
      </div>
    </div>
  );
};

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="mt-2 rounded-md border border-destructive bg-destructive/10 p-3 text-destructive text-sm select-text dark:bg-destructive/5 dark:text-red-200">
        <ErrorPrimitive.Message className="whitespace-pre-wrap break-all" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

const AssistantErrorContent: FC = () => {
  const message = useMessage();
  const text = message.content
    .flatMap((p) => (p.type === 'text' && 'text' in p ? [(p as { type: 'text'; text: string }).text] : []))
    .join('');
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const onCopy = () => {
    if (!text || isCopied) return;
    copyToClipboard(text);
  };

  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm dark:bg-destructive/10">
      <div className="flex items-start gap-2 text-destructive dark:text-red-300">
        <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold">Request failed</div>
            <TooltipIconButton
              tooltip={isCopied ? 'Copied' : 'Copy full error'}
              side="top"
              onClick={onCopy}
              className="size-6 rounded-md border border-destructive/25 hover:bg-destructive/10"
            >
              {isCopied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
            </TooltipIconButton>
          </div>
          <div className="mt-1 font-mono text-xs leading-relaxed break-all opacity-90 whitespace-pre-wrap select-text">{text}</div>
        </div>
      </div>
    </div>
  );
};

const AssistantMessage: FC = () => {
  const message = useMessage();
  const isError = message.metadata?.custom?.isError === true;
  return (
    <MessagePrimitive.Root
      className="relative mx-auto w-full max-w-(--thread-max-width) py-3 select-text"
      data-role="assistant"
    >
      <div className="px-2 text-foreground leading-relaxed select-text">
        {isError ? (
          <AssistantErrorContent />
        ) : (
          <MessagePrimitive.Parts
            components={{ Text: MarkdownText, File }}
          />
        )}
        <MessageError />
      </div>
      <div className="mt-1 ml-2 flex">
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  );
};

const AssistantActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="-ml-1 flex gap-1 text-muted-foreground"
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Copy">
          <AuiIf condition={(s) => s.message.isCopied}>
            <CheckIcon />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <CopyIcon />
          </AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton tooltip="Refresh">
          <RefreshCwIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
    </ActionBarPrimitive.Root>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      className="mx-auto grid w-full max-w-(--thread-max-width) auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 py-3 select-text [&:where(>*)]:col-start-2"
      data-role="user"
    >
      <div className="relative col-start-2 min-w-0">
        <div className="rounded-2xl bg-muted px-4 py-2.5 text-foreground select-text">
          <MessagePrimitive.Attachments
            components={{ Attachment: MessageAttachmentChip, Image: MessageAttachmentChip }}
          />
          <MessagePrimitive.Parts />
        </div>
        <div className="absolute top-1/2 left-0 -translate-x-full -translate-y-1/2 pr-2">
          <UserActionBar />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="flex flex-col items-end gap-1"
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Copy">
          <AuiIf condition={(s) => s.message.isCopied}>
            <CheckIcon />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <CopyIcon />
          </AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Edit asChild>
        <TooltipIconButton tooltip="Edit" className="p-4">
          <PencilIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  return (
    <MessagePrimitive.Root className="mx-auto flex w-full max-w-(--thread-max-width) flex-col px-2 py-3">
      <ComposerPrimitive.Root className="ml-auto flex w-full max-w-[85%] flex-col rounded-2xl bg-muted">
        <ComposerPrimitive.Input
          className="min-h-14 w-full resize-none bg-transparent p-4 text-foreground text-sm outline-none"
          autoFocus
        />
        <div className="mx-3 mb-3 flex items-center gap-2 self-end">
          <ComposerPrimitive.Cancel asChild>
            <Button variant="ghost" size="sm">Cancel</Button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <Button size="sm">Update</Button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
};

const ComposerAttachmentChip: FC = () => {
  return (
    <AttachmentPrimitive.Root className="mx-2 mb-1 flex items-center gap-2 rounded-xl border border-border/60 bg-muted/30 px-2 py-1 text-xs">
      <AttachmentPrimitive.unstable_Thumb className="size-8 overflow-hidden rounded-md border border-border/60 bg-background" />
      <AttachmentPrimitive.Name />
      <AttachmentPrimitive.Remove asChild>
        <button
          type="button"
          className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Remove attachment"
        >
          <XIcon className="size-3" />
        </button>
      </AttachmentPrimitive.Remove>
    </AttachmentPrimitive.Root>
  );
};

const MessageAttachmentChip: FC = () => {
  return (
    <AttachmentPrimitive.Root className="mb-2 flex items-center gap-2 rounded-xl border border-border/60 bg-background/60 px-2 py-1 text-xs">
      <AttachmentPrimitive.unstable_Thumb className="size-8 overflow-hidden rounded-md border border-border/60 bg-background" />
      <AttachmentPrimitive.Name />
    </AttachmentPrimitive.Root>
  );
};

const useCopyToClipboard = ({ copiedDuration = 1500 }: { copiedDuration?: number } = {}) => {
  const [isCopied, setIsCopied] = useState(false);

  const copyToClipboard = (value: string) => {
    if (!value) return;
    navigator.clipboard.writeText(value).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), copiedDuration);
    }).catch(() => undefined);
  };

  return { isCopied, copyToClipboard };
};
