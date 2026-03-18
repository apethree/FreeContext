import { ConnectAccountsSettings } from '@/features/settings/sections/ConnectAccountsSettings';
import { useSettingsRouteData } from '@/features/settings/routes/useSettingsRouteData';

export function ConnectAccountsSettingsRoute() {
  const { userSettings } = useSettingsRouteData();

  return (
    <ConnectAccountsSettings
      connectedAccounts={userSettings.connectedAccounts}
      onConnectedAccountsChange={userSettings.setConnectedAccounts}
    />
  );
}
