import { InsetGroup, InsetRow } from '@/features/settings/ui/SettingsLayout';

export function ArchivedProjectsSettingsRoute() {
  return (
    <InsetGroup>
      <InsetRow
        title="No archived projects"
        description="Archive a project from the sidebar to manage it here."
        last
      />
    </InsetGroup>
  );
}
