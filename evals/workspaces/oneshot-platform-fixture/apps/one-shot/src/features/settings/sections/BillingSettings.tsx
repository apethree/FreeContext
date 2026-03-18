import { RefreshCw } from '@hugeicons/core-free-icons';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { HugeiconsIcon } from '@/components/ui/hugeicons-icon';
import { SectionTitle } from '@/features/settings/ui/SettingsLayout';
import { formatBillingDate } from '@/features/settings/settingsHelpers';
import type { EntitlementTier, BillingPlanResponse } from '@/features/settings/types';

type BillingSettingsProps = {
  userEmail: string;
  entitlementTier: EntitlementTier;
  billingPlan: BillingPlanResponse | null;
  billingActionBusy: 'portal' | null;
  onOpenBillingPortal: () => void;
  onRefreshBillingPlan: () => void;
  unsupported?: boolean;
};

export function BillingSettings({
  userEmail,
  entitlementTier,
  billingPlan,
  billingActionBusy,
  onOpenBillingPortal,
  onRefreshBillingPlan,
  unsupported = true,
}: BillingSettingsProps) {
  const compactIconButtonClass =
    'h-6 w-6 rounded-xl border border-border/60 bg-background text-foreground/70 transition-colors hover:bg-accent hover:text-foreground';
  const currentTier = billingPlan?.tier || entitlementTier;
  const isTrial = Boolean(billingPlan?.is_trial);
  const trialEndsLabel = formatBillingDate(billingPlan?.trial_ends_at);
  const graceEndsLabel = formatBillingDate(billingPlan?.grace_expires_at);
  const isDelinquent = ['past_due', 'unpaid', 'incomplete'].includes(
    String(billingPlan?.status || '').toLowerCase(),
  );

  return (
    <div className="space-y-5">
      <SectionTitle>Plans and billing</SectionTitle>
      <Card className="rounded-2xl border border-neutral-300/80 bg-white px-5 py-5 shadow-[0_24px_80px_-48px_rgba(38,38,38,0.32)] dark:border-neutral-700 dark:bg-neutral-950">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-responsive-sm font-semibold text-foreground">
              {currentTier === 'basic'
                ? 'Upgrade now to unlock paid One Shot plans'
                : `You're on ${currentTier.toUpperCase()}`}
            </p>
            <p className="mt-1 text-responsive-xs text-muted-foreground">
              {billingPlan
                ? `${billingPlan.plan} · ${billingPlan.status}`
                : 'Billing integration is not available in one-shot yet.'}
            </p>
            {isTrial && trialEndsLabel ? (
              <p className="mt-1 text-responsive-xs text-blue-700 dark:text-blue-300">Trial ends on {trialEndsLabel}</p>
            ) : null}
            {isDelinquent && graceEndsLabel ? (
              <p className="mt-1 text-responsive-xs text-amber-700 dark:text-amber-300">
                Payment issue: resolve billing by {graceEndsLabel} to avoid downgrade.
              </p>
            ) : null}
            {unsupported ? (
              <p className="mt-2 text-responsive-xs text-muted-foreground">
                Billing actions are shown for parity and will be enabled after one-shot backend wiring.
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={
                unsupported ||
                billingActionBusy !== null ||
                !billingPlan?.portal_enabled ||
                !billingPlan?.stripe_customer_id
              }
              onClick={onOpenBillingPortal}
              className="rounded-xl"
            >
              {billingActionBusy === 'portal' ? 'Opening...' : 'Manage billing'}
            </Button>
            <Button
              variant="outline"
              size="icon-xs"
              className={compactIconButtonClass}
              onClick={onRefreshBillingPlan}
              title="Refresh billing plan"
              disabled={unsupported}
            >
              <HugeiconsIcon icon={RefreshCw} className="h-[var(--app-icon-size)] w-[var(--app-icon-size)]" />
            </Button>
          </div>
        </div>
      </Card>

      <Card className="rounded-2xl border border-neutral-300/80 bg-white px-5 py-5 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
        <div className="flex flex-col gap-2">
          <p className="text-responsive-sm font-semibold text-foreground">Current plan: {currentTier.toUpperCase()}</p>
          <p className="text-responsive-xs text-muted-foreground">
            Stripe checkout and billing portal are not yet connected in one-shot.
          </p>
          <p className="text-responsive-xs text-muted-foreground">Signed in email: {userEmail || 'No email'}</p>
        </div>
      </Card>
    </div>
  );
}
