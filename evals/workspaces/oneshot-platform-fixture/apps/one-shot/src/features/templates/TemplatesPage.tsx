import { PageContentContainer } from "@/features/app/PageContentContainer";

export function TemplatesPage() {
  return (
    <PageContentContainer>
      <header className="rounded-xl border border-border/70 bg-card/80 px-4 py-3">
        <h1 className="text-xl font-semibold tracking-tight">Templates</h1>
        <p className="text-sm text-muted-foreground">Curated starter templates and shared harness libraries.</p>
      </header>

      <p className="px-1 text-sm text-muted-foreground">
        Use templates to bootstrap flows and reusable project structures quickly.
      </p>
    </PageContentContainer>
  );
}
