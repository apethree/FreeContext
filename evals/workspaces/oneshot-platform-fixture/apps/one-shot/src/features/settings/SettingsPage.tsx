import { Outlet, useOutletContext } from 'react-router-dom';
import type { AppShellContextValue } from '@/features/app/AppShellContext';

export function SettingsPage() {
  const appShellContext = useOutletContext<AppShellContextValue>();

  return (
    <div className="h-full overflow-auto px-6 py-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <Outlet context={appShellContext} />
      </div>
    </div>
  );
}
