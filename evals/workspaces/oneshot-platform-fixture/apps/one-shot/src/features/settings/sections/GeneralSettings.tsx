import { useEffect, useState } from 'react';
import {
  ALargeSmall,
  BellRing,
  CircleUserRound,
  Copy,
  Monitor,
  Moon,
  Palette,
  SettingsIcon,
  Sun,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@/components/ui/hugeicons-icon';
import { useTheme } from 'next-themes';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { InsetGroup, InsetRow, SectionTitle } from '@/features/settings/ui/SettingsLayout';
import {
  DESKTOP_NOTIFICATIONS_ENV_KEY,
  SETTINGS_CONTROL_CLASS,
  WEBHOOK_NOTIFICATIONS_ENV_KEY,
  updateEnvValue,
} from '@/features/settings/settingsHelpers';
import type { EnvMap } from '@/features/settings/types';

type GeneralSettingsProps = {
  userEmail: string;
  workspaceRoot: string;
  fontSize: number;
  envDraft: EnvMap;
  onOpenAccountProfile: () => void;
  onFontSizeChange: (value: number) => void;
  onEnvDraftChange: (next: EnvMap | ((prev: EnvMap) => EnvMap)) => void;
};

export function GeneralSettings({
  userEmail,
  workspaceRoot,
  fontSize,
  envDraft,
  onOpenAccountProfile,
  onFontSizeChange,
  onEnvDraftChange,
}: GeneralSettingsProps) {
  const { theme, setTheme } = useTheme();
  const [themeValue, setThemeValue] = useState<'light' | 'dark' | 'system'>('system');
  const [notificationsOpen, setNotificationsOpen] = useState(true);
  const [desktopPermission, setDesktopPermission] = useState<NotificationPermission>('default');

  useEffect(() => {
    if (theme === 'light' || theme === 'dark' || theme === 'system') {
      setThemeValue(theme);
    }
  }, [theme]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return;
    }
    setDesktopPermission(window.Notification.permission);
  }, []);

  async function handleDesktopNotificationsToggle(checked: boolean) {
    if (!checked) {
      onEnvDraftChange(updateEnvValue(envDraft, DESKTOP_NOTIFICATIONS_ENV_KEY, 'false'));
      return;
    }

    if (typeof window === 'undefined' || !('Notification' in window)) {
      return;
    }

    let permission = window.Notification.permission;
    if (permission === 'default') {
      permission = await window.Notification.requestPermission();
      setDesktopPermission(permission);
    }

    if (permission !== 'granted') {
      onEnvDraftChange(updateEnvValue(envDraft, DESKTOP_NOTIFICATIONS_ENV_KEY, 'false'));
      return;
    }

    onEnvDraftChange(updateEnvValue(envDraft, DESKTOP_NOTIFICATIONS_ENV_KEY, 'true'));
  }

  const compactIconButtonClass =
    'h-6 w-6 rounded-xl border border-border/60 bg-background text-foreground/70 transition-colors hover:bg-accent hover:text-foreground';

  return (
    <div className="space-y-5">
      <SectionTitle>&nbsp;</SectionTitle>
      <InsetGroup>
        <InsetRow
          title="Account settings"
          description={userEmail || 'Open your Clerk profile settings.'}
          icon={<HugeiconsIcon icon={CircleUserRound} className="h-[var(--app-icon-size)] w-[var(--app-icon-size)] text-muted-foreground" />}
          control={
            <Button variant="outline" size="sm" onClick={onOpenAccountProfile}>
              Open
            </Button>
          }
        />
        <InsetRow
          title="Workspace root"
          description="Where One Shot stores local app state and env settings."
          icon={<HugeiconsIcon icon={SettingsIcon} className="h-[var(--app-icon-size)] w-[var(--app-icon-size)] text-muted-foreground" />}
          control={
            <div className="flex items-center gap-2">
              <code className="rounded-md border border-border/70 bg-muted/40 px-2 py-1 text-responsive-xs text-foreground">
                {workspaceRoot}
              </code>
              <Button
                type="button"
                variant="outline"
                size="icon-xs"
                className={compactIconButtonClass}
                title="Copy workspace root"
                onClick={() => {
                  void navigator.clipboard.writeText(workspaceRoot).catch(() => undefined);
                }}
              >
                <HugeiconsIcon icon={Copy} className="h-[var(--app-icon-size)] w-[var(--app-icon-size)]" />
              </Button>
            </div>
          }
          last
        />
      </InsetGroup>

      <SectionTitle>Appearance</SectionTitle>
      <InsetGroup>
        <InsetRow
          title="Theme"
          description="Switch between light, dark, or system appearance."
          icon={<HugeiconsIcon icon={Monitor} className="h-[var(--app-icon-size)] w-[var(--app-icon-size)] text-muted-foreground" />}
          control={
            <Tabs
              value={themeValue}
              onValueChange={(value) => {
                if (value === 'light' || value === 'dark' || value === 'system') {
                  setThemeValue(value);
                  setTheme(value);
                }
              }}
            >
              <TabsList className="h-8 rounded-xl border border-border/70 bg-muted/70 p-1">
                <TabsTrigger value="light" className="flex-none rounded-lg px-2.5 text-responsive-xs">
                  <HugeiconsIcon icon={Sun} className="size-3.5" />
                  Light
                </TabsTrigger>
                <TabsTrigger value="dark" className="flex-none rounded-lg px-2.5 text-responsive-xs">
                  <HugeiconsIcon icon={Moon} className="size-3.5" />
                  Dark
                </TabsTrigger>
                <TabsTrigger value="system" className="flex-none rounded-lg px-2.5 text-responsive-xs">
                  <HugeiconsIcon icon={Monitor} className="size-3.5" />
                  System
                </TabsTrigger>
              </TabsList>
            </Tabs>
          }
        />
        <InsetRow
          title="Font family"
          description="Geist is used across the app for a dense neutral UI."
          icon={<HugeiconsIcon icon={Palette} className="h-[var(--app-icon-size)] w-[var(--app-icon-size)] text-muted-foreground" />}
          control={<div className="text-responsive-sm text-muted-foreground">Geist</div>}
        />
        <InsetRow
          title="UI text size"
          description="Adjust text and icon scale together across the app."
          icon={<HugeiconsIcon icon={ALargeSmall} className="h-[var(--app-icon-size)] w-[var(--app-icon-size)] text-muted-foreground" />}
          control={
            <Select value={String(fontSize)} onValueChange={(value) => onFontSizeChange(Number(value))}>
              <SelectTrigger className={`w-28 ${SETTINGS_CONTROL_CLASS}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="12">12 px</SelectItem>
                <SelectItem value="13">13 px</SelectItem>
                <SelectItem value="14">14 px</SelectItem>
                <SelectItem value="15">15 px</SelectItem>
                <SelectItem value="16">16 px</SelectItem>
              </SelectContent>
            </Select>
          }
          last
        />
      </InsetGroup>

      <SectionTitle>Notifications</SectionTitle>
      <Card className="mx-0 overflow-hidden border border-border/80 bg-card py-0 shadow-none">
        <Accordion
          type="single"
          collapsible
          value={notificationsOpen ? 'notifications-settings' : ''}
          onValueChange={(value) => setNotificationsOpen(value === 'notifications-settings')}
        >
          <AccordionItem value="notifications-settings" className="border-none">
            <AccordionTrigger className="px-4 py-3 hover:no-underline">
              <div className="flex items-center gap-2 text-responsive-xs font-medium text-foreground">
                <HugeiconsIcon icon={BellRing} className="h-[var(--app-icon-size)] w-[var(--app-icon-size)] text-muted-foreground" />
                Turn completion notifications
              </div>
            </AccordionTrigger>
            <AccordionContent className="border-t border-border/70 px-4 pt-3 pb-3">
              <div className="space-y-3">
                <InsetRow
                  title="Desktop notifications"
                  description={
                    <span>
                      Send desktop alerts for completed turns. This uses system notification permissions.
                      {desktopPermission !== 'granted' ? ` Current permission: ${desktopPermission}.` : ''}
                    </span>
                  }
                  control={
                    <Switch
                      checked={(envDraft[DESKTOP_NOTIFICATIONS_ENV_KEY] || 'true').toLowerCase() !== 'false'}
                      onCheckedChange={(checked) => {
                        void handleDesktopNotificationsToggle(checked);
                      }}
                    />
                  }
                />
                <InsetRow
                  title="Custom webhook notifications"
                  description="Enable webhook-based notifications for external systems."
                  control={
                    <Switch
                      checked={(envDraft[WEBHOOK_NOTIFICATIONS_ENV_KEY] || 'false').toLowerCase() === 'true'}
                      onCheckedChange={(checked) =>
                        onEnvDraftChange(
                          updateEnvValue(
                            envDraft,
                            WEBHOOK_NOTIFICATIONS_ENV_KEY,
                            checked ? 'true' : 'false',
                          ),
                        )
                      }
                    />
                  }
                  last
                />
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </Card>
    </div>
  );
}
