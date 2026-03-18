import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { useAppShellContext } from "@/features/app/AppShellContext";
import { PageContentContainer } from "@/features/app/PageContentContainer";

export function SkillsPage() {
  const { appState } = useAppShellContext();
  const profile = appState.projectProfiles[appState.selectedProjectPath];
  const [search, setSearch] = useState("");

  const filteredRows = useMemo(() => {
    void search;
    return [];
  }, [search]);

  return (
    <PageContentContainer>
      <header className="rounded-xl border border-border/70 bg-card/80 px-4 py-3">
        <h1 className="text-xl font-semibold tracking-tight">Skills</h1>
        <p className="text-sm text-muted-foreground">
          {profile?.displayName
            ? `Project context: ${profile.displayName}`
            : "No project selected."}
        </p>
      </header>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search skills by name, slug, or tier"
            className="max-w-md"
          />
          <p className="text-xs text-muted-foreground">{filteredRows.length} skills</p>
        </div>

        <div className="rounded-xl border border-border/70 bg-card/60">
          <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr] gap-2 border-b border-border/70 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span>Skill</span>
            <span>Tier</span>
            <span>Latest</span>
            <span>Activation</span>
          </div>
          <p className="px-3 py-4 text-xs text-muted-foreground">
            Skills catalog not yet integrated with hosted backend.
          </p>
        </div>
      </div>
    </PageContentContainer>
  );
}
