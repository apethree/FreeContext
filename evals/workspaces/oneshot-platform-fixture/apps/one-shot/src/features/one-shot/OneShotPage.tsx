import { PageContentContainer } from '@/features/app/PageContentContainer';

export function OneShotPage() {
  return (
    <PageContentContainer>
      <header className="rounded-xl border border-border/70 bg-card/80 px-4 py-3">
        <h1 className="text-xl font-semibold tracking-tight">One Shot</h1>
        <p className="text-sm text-muted-foreground">Default content coming next.</p>
      </header>

      <p className="px-1 text-sm text-muted-foreground">
        This page will host One Shot workflows and orchestration views.
      </p>
    </PageContentContainer>
  );
}
