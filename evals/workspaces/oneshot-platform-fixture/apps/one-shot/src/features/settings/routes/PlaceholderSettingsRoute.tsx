import { InsetGroup, InsetRow } from '@/features/settings/ui/SettingsLayout';

export function PlaceholderSettingsRoute({
  title,
  summary,
  actions,
}: {
  title: string;
  summary: string;
  actions: Array<{ label: string; value: string }>;
}) {
  return (
    <InsetGroup>
      <InsetRow
        title={title}
        description={summary}
        control={<div className="text-responsive-xs text-muted-foreground">Local-only placeholder</div>}
      />
      {actions.map((action, index) => (
        <InsetRow
          key={`${title}-${action.label}`}
          title={action.label}
          description={action.value}
          control={<div className="text-responsive-xs text-muted-foreground">Read-only</div>}
          last={index === actions.length - 1}
        />
      ))}
    </InsetGroup>
  );
}
