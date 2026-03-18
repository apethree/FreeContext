import type { EnvMap } from '@/features/settings/types';

export const SETTINGS_CONTROL_CLASS = 'h-8';
export const DESKTOP_NOTIFICATIONS_ENV_KEY = 'CAPZERO_DESKTOP_NOTIFICATIONS';
export const WEBHOOK_NOTIFICATIONS_ENV_KEY = 'CAPZERO_WEBHOOK_NOTIFICATIONS';

export function updateEnvValue(current: EnvMap, key: string, value: string): EnvMap {
  return {
    ...current,
    [key]: value,
  };
}

export function formatBillingDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
