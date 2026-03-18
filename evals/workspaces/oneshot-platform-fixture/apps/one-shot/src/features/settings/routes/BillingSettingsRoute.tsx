import { BillingSettings } from '@/features/settings/sections/BillingSettings';
import { useSettingsRouteData } from '@/features/settings/routes/useSettingsRouteData';

function noop() {
  return;
}

export function BillingSettingsRoute() {
  const { userEmail } = useSettingsRouteData();

  return (
    <BillingSettings
      userEmail={userEmail}
      entitlementTier="basic"
      billingPlan={null}
      billingActionBusy={null}
      onOpenBillingPortal={noop}
      onRefreshBillingPlan={noop}
      unsupported
    />
  );
}
