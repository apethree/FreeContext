export type EnvMap = Record<string, string>;

export type EntitlementTier = 'basic' | 'pro' | 'expert' | 'enterprise';

export type ProjectSyncStatus = 'local_only' | 'synced' | 'pending' | 'error';

export type BillingPlanResponse = {
  tier: EntitlementTier;
  plan: string;
  status: string;
  portal_enabled?: boolean;
  stripe_customer_id?: string;
  is_trial?: boolean;
  trial_ends_at?: string | null;
  grace_expires_at?: string | null;
};
