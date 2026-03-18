import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { HugeiconsIcon } from '@/components/ui/hugeicons-icon';
import { CommandLineIcon } from '@hugeicons/core-free-icons';
import { Input } from '@/components/ui/input';

type ObsRecord = {
  ts: string;
  domain: string;
  action: string;
  phase?: string;
  status?: 'start' | 'success' | 'error' | 'retry' | 'skip' | 'close';
  correlationId?: string;
  fingerprint?: string;
  durationMs?: number;
  duplicateCount?: number;
  data?: Record<string, unknown>;
};

function formatRecord(record: ObsRecord): string {
  return JSON.stringify(record, null, 2);
}

export function DevLogViewer() {
  const [open, setOpen] = useState(false);
  const [domainFilter, setDomainFilter] = useState('');
  const [search, setSearch] = useState('');
  const [events, setEvents] = useState<ObsRecord[]>([]);

  useEffect(() => {
    let mounted = true;
    void window.appShell.getObservabilityEvents().then((existing) => {
      if (!mounted) return;
      setEvents(existing);
    });
    const unsubscribe = window.appShell.onObservabilityEvent((event) => {
      setEvents((previous) => {
        const next = [...previous, event];
        if (next.length > 500) {
          return next.slice(next.length - 500);
        }
        return next;
      });
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const domain = domainFilter.trim().toLowerCase();
    return events
      .filter((entry) => {
        if (domain && !entry.domain.toLowerCase().includes(domain)) return false;
        if (!query) return true;
        const blob = `${entry.domain} ${entry.action} ${entry.status ?? ''} ${JSON.stringify(entry.data ?? {})}`.toLowerCase();
        return blob.includes(query);
      })
      .slice()
      .reverse();
  }, [domainFilter, events, search]);

  if (!import.meta.env.DEV) return null;

  return (
    <div className="pointer-events-none fixed right-1 bottom-1 z-[80]">
      <div className="pointer-events-auto flex flex-col items-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon-xs"
          className="h-7 w-7 bg-background/95"
          onClick={() => setOpen((previous) => !previous)}
          title={`Dev Logs (${events.length})`}
        >
          <HugeiconsIcon icon={CommandLineIcon} className="h-3.5 w-3.5" />
        </Button>
        {open ? (
          <div className="w-[760px] max-w-[95vw] rounded-md border bg-background p-3 shadow-lg">
            <div className="mb-2 flex items-center gap-2">
              <Input
                value={domainFilter}
                onChange={(event) => setDomainFilter(event.target.value)}
                placeholder="Filter by domain (e.g. gateway.remote)"
              />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search action/status/data"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEvents([]);
                  void window.appShell.clearObservabilityEvents();
                }}
              >
                Clear
              </Button>
            </div>
            <div className="h-[360px] overflow-auto rounded border bg-muted/20 p-2">
              {filtered.length === 0 ? (
                <div className="text-sm text-muted-foreground">No events</div>
              ) : (
                <div className="space-y-2">
                  {filtered.map((record, index) => (
                    <pre
                      key={`${record.ts}:${record.domain}:${record.action}:${index}`}
                      className="overflow-auto rounded border bg-background p-2 text-xs"
                    >
                      {formatRecord(record)}
                    </pre>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
