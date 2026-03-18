import { AuthenticateWithRedirectCallback } from '@clerk/clerk-react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthPage } from '@/features/auth/AuthPage';
import { AppShell } from '@/features/app/AppShell';
import { PageContentContainer } from '@/features/app/PageContentContainer';
import { HomePage } from '@/features/home/HomePage';
import { ModeHomePage } from '@/features/home/ModeHomePage';
import { SkillsPage } from '@/features/skills/SkillsPage';
import { TemplatesPage } from '@/features/templates/TemplatesPage';
import { StyleLabPage } from '@/features/style-lab/StyleLabPage';
import { OneShotPage } from '@/features/one-shot/OneShotPage';
import { ProjectPage } from '@/features/projects/ProjectPage';
import { CreateProjectPage } from '@/features/projects/CreateProjectPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { SettingsSectionRoute } from '@/features/settings/routes/SettingsSectionRoute';
import { OpenClawDemoPage } from '@/features/openclaw-demo/OpenClawDemoPage';
import { OpenClawHostedPhasePage } from '@/features/openclaw-hosted-phase/OpenClawHostedPhasePage';
import { GlobalAssistantPage } from '@/features/assistant-chat/GlobalAssistantPage';
import { WebTestPage } from '@/features/web-test/WebTestPage';
import { GhostLayerPage } from '@/features/ghost-layer/GhostLayerPage';
import { LiveFlowPage } from '@/features/live/LiveFlowPage';
import { CloudInspectorPage } from '@/features/cloud-inspector/CloudInspectorPage';
import { getAppCapabilities } from '@/lib/appCapabilities';

function DesktopOnlyPage({ title }: { title: string }) {
  return (
    <PageContentContainer className="max-w-4xl">
      <section className="surface-raised px-5 py-5">
        <h1 className="text-base font-semibold text-foreground">{title}</h1>
        <p className="mt-2 text-xs text-muted-foreground">
          This page depends on desktop runtime capabilities and is not available in the web app.
        </p>
      </section>
    </PageContentContainer>
  );
}

export function App() {
  const capabilities = getAppCapabilities();
  const isWebRuntime = capabilities.platform === 'web';

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/auth" replace />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/sso-callback" element={<AuthenticateWithRedirectCallback />} />

        <Route path="/home" element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="mode/:mode" element={<ModeHomePage />} />
          <Route path="mode/:mode/:tab" element={<ModeHomePage />} />
          <Route path="skills" element={<SkillsPage />} />
          <Route path="templates" element={<TemplatesPage />} />
          <Route path="style-lab" element={<StyleLabPage />} />
          <Route path="one-shot" element={<OneShotPage />} />
          <Route
            path="openclaw-demo"
            element={isWebRuntime ? <DesktopOnlyPage title="OpenClaw Demo" /> : <OpenClawDemoPage />}
          />
          <Route
            path="openclaw-hosted-phase"
            element={isWebRuntime ? <DesktopOnlyPage title="Hosted Phase Test" /> : <OpenClawHostedPhasePage />}
          />
          <Route path="live" element={<LiveFlowPage />} />
          <Route path="global-assistant" element={<GlobalAssistantPage />} />
          <Route path="assistant-chat" element={<Navigate to="/home/global-assistant" replace />} />
          <Route
            path="web-test"
            element={isWebRuntime ? <DesktopOnlyPage title="Web Test" /> : <WebTestPage />}
          />
          <Route
            path="ghost-layer"
            element={isWebRuntime ? <DesktopOnlyPage title="Ghost Layer" /> : <GhostLayerPage />}
          />
          <Route path="cloud-inspector" element={<CloudInspectorPage />} />
          <Route path="project/:projectId" element={<ProjectPage />} />
          <Route path="project/:projectId/:runId" element={<ProjectPage />} />
          <Route path="create" element={<CreateProjectPage />} />
          <Route path="settings" element={<SettingsPage />}>
            <Route index element={<SettingsSectionRoute />} />
            <Route path=":section" element={<SettingsSectionRoute />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/auth" replace />} />
      </Routes>
    </HashRouter>
  );
}
