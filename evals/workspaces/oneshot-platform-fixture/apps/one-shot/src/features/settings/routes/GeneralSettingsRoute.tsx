import { GeneralSettings } from '@/features/settings/sections/GeneralSettings';
import { useSettingsRouteData } from '@/features/settings/routes/useSettingsRouteData';

function noop() {
  return;
}

export function GeneralSettingsRoute() {
  const { userEmail, machine, userSettings } = useSettingsRouteData();

  return (
    <GeneralSettings
      userEmail={userEmail}
      workspaceRoot={machine.workspaceRoot}
      fontSize={machine.fontSize}
      envDraft={userSettings.envDraft}
      onOpenAccountProfile={noop}
      onFontSizeChange={machine.setFontSize}
      onEnvDraftChange={userSettings.setEnvDraft}
    />
  );
}
