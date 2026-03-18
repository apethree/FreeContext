import { useAuth, useUser } from '@clerk/clerk-react';
import { useMachineSettings } from '@/features/settings/useMachineSettings';
import { useUserSettings } from '@/features/settings/useUserSettings';

export function useSettingsRouteData() {
  const { user } = useUser();
  const { orgId } = useAuth();
  const userId = user?.id || null;
  const tenantId = orgId ?? userId;
  const userEmail =
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses?.[0]?.emailAddress ??
    '';
  const machine = useMachineSettings();
  const userSettings = useUserSettings(userId, tenantId);

  return {
    userId,
    userEmail,
    machine,
    userSettings,
  };
}
