import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAppShellContext } from "@/features/app/AppShellContext";
import { PageContentContainer } from "@/features/app/PageContentContainer";

const ALL_TECH_OPTIONS = [
  "nextjs",
  "react",
  "expo",
  "fastapi",
  "electron",
  "typescript",
  "tailwindcss",
  "supabase",
  "clerk",
  "stripe",
  "postgres",
  "docker",
];

const ALL_SKILL_OPTIONS = [
  "frontend-design",
  "clerk-setup",
  "native-data-fetching",
  "vercel-react-best-practices",
  "vercel-react-native-skills",
  "building-native-ui",
  "supabase-postgres-best-practices",
  "project-scaffold-router",
];

function toggleInList(current: string[], value: string) {
  return current.includes(value)
    ? current.filter((entry) => entry !== value)
    : [...current, value];
}

function recommendationsForIntent(intentId: string) {
  if (intentId === "mobile-app") {
    return {
      technologies: ["expo", "react", "typescript"],
      skills: ["building-native-ui", "vercel-react-native-skills", "frontend-design"],
    };
  }
  if (intentId === "launch-startup") {
    return {
      technologies: ["nextjs", "tailwindcss", "typescript", "clerk"],
      skills: ["frontend-design", "vercel-react-best-practices", "clerk-setup"],
    };
  }
  if (intentId === "automation") {
    return {
      technologies: ["typescript", "postgres", "docker"],
      skills: ["native-data-fetching", "project-scaffold-router"],
    };
  }
  if (intentId === "marketplace") {
    return {
      technologies: ["nextjs", "supabase", "stripe", "typescript"],
      skills: ["frontend-design", "native-data-fetching", "supabase-postgres-best-practices"],
    };
  }
  if (intentId === "saas") {
    return {
      technologies: ["nextjs", "supabase", "clerk", "tailwindcss"],
      skills: ["clerk-setup", "vercel-react-best-practices", "supabase-postgres-best-practices"],
    };
  }
  if (intentId === "ai-product") {
    return {
      technologies: ["react", "electron", "typescript"],
      skills: ["frontend-design", "native-data-fetching"],
    };
  }
  return {
    technologies: ["react", "typescript"],
    skills: ["frontend-design"],
  };
}

export function CreateProjectPage() {
  const { appState, setAppState } = useAppShellContext();
  const draft = appState.createProjectDraft;
  const [customizeOpen, setCustomizeOpen] = useState(false);

  const recommended = useMemo(
    () => recommendationsForIntent(draft.selectedIntent),
    [draft.selectedIntent],
  );

  const updateDraft = (patch: Partial<typeof draft>) => {
    setAppState((previous) => ({
      ...previous,
      createProjectDraft: {
        ...previous.createProjectDraft,
        ...patch,
      },
    }));
  };

  return (
    <PageContentContainer>
      <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">
          Project creation is being updated.
        </p>
        <Button type="button" variant="outline" onClick={() => setCustomizeOpen(true)}>
          Customize tech &amp; skills
        </Button>
      </div>

      <Dialog open={customizeOpen} onOpenChange={setCustomizeOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Customize recommendations</DialogTitle>
            <DialogDescription>
              Keep Auto on for low-friction defaults, or customize the exact picks.
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="tech">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="tech">Tech</TabsTrigger>
              <TabsTrigger value="skills">Skills</TabsTrigger>
            </TabsList>

            <TabsContent value="tech" className="space-y-4">
              <div className="flex items-center justify-between rounded-md border border-border/70 bg-muted/30 px-3 py-2">
                <div>
                  <p className="text-sm font-medium">Auto</p>
                  <p className="text-xs text-muted-foreground">We'll pick sensible defaults.</p>
                </div>
                <Switch
                  checked={draft.technologiesAutoMode}
                  onCheckedChange={(checked) =>
                    updateDraft({
                      technologiesAutoMode: checked === true,
                      selectedTechnologies:
                        checked === true ? recommended.technologies : draft.selectedTechnologies,
                    })
                  }
                />
              </div>

              {draft.technologiesAutoMode ? (
                <div className="flex flex-wrap gap-2">
                  {recommended.technologies.map((tech) => (
                    <div
                      key={tech}
                      className="rounded-full border border-border/70 bg-background/60 px-3 py-1 text-xs text-muted-foreground"
                    >
                      {tech}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {ALL_TECH_OPTIONS.map((tech) => (
                    <Button
                      key={tech}
                      type="button"
                      size="xs"
                      variant={draft.selectedTechnologies.includes(tech) ? "default" : "outline"}
                      onClick={() =>
                        updateDraft({
                          selectedTechnologies: toggleInList(draft.selectedTechnologies, tech),
                        })
                      }
                    >
                      {tech}
                    </Button>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="skills" className="space-y-4">
              <div className="flex items-center justify-between rounded-md border border-border/70 bg-muted/30 px-3 py-2">
                <div>
                  <p className="text-sm font-medium">Auto</p>
                  <p className="text-xs text-muted-foreground">We'll pick sensible defaults.</p>
                </div>
                <Switch
                  checked={draft.skillsAutoMode}
                  onCheckedChange={(checked) =>
                    updateDraft({
                      skillsAutoMode: checked === true,
                      selectedSkills:
                        checked === true ? recommended.skills : draft.selectedSkills,
                    })
                  }
                />
              </div>

              {draft.skillsAutoMode ? (
                <div className="flex flex-wrap gap-2">
                  {recommended.skills.map((skill) => (
                    <div
                      key={skill}
                      className="rounded-full border border-border/70 bg-background/60 px-3 py-1 text-xs text-muted-foreground"
                    >
                      {skill}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {ALL_SKILL_OPTIONS.map((skill) => (
                    <Button
                      key={skill}
                      type="button"
                      size="xs"
                      variant={draft.selectedSkills.includes(skill) ? "default" : "outline"}
                      onClick={() =>
                        updateDraft({
                          selectedSkills: toggleInList(draft.selectedSkills, skill),
                        })
                      }
                    >
                      {skill}
                    </Button>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </PageContentContainer>
  );
}
