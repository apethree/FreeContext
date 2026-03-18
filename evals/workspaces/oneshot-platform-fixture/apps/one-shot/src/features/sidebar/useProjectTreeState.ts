import { useMemo } from 'react';
import type { AppShellState } from '@/features/app/types';
import type { ShellView } from '@/features/app/shellRoutes';

export type ProjectTreeState = {
  sortMode: AppShellState['sortMode'];
  projectPaths: AppShellState['projectPaths'];
  selectedProjectPath: string;
  selectedRunByProject: AppShellState['selectedRunByProject'];
  projectProfiles: AppShellState['projectProfiles'];
};

type UseProjectTreeStateInput = {
  appState: AppShellState;
  shellView: ShellView;
};

export function useProjectTreeState({ appState, shellView }: UseProjectTreeStateInput): ProjectTreeState {
  return useMemo(
    () => ({
      sortMode: appState.sortMode,
      projectPaths: appState.projectPaths,
      selectedProjectPath: shellView.projectPath || appState.selectedProjectPath,
      selectedRunByProject: appState.selectedRunByProject,
      projectProfiles: appState.projectProfiles,
    }),
    [appState.projectPaths, appState.projectProfiles, appState.selectedProjectPath, appState.selectedRunByProject, appState.sortMode, shellView.projectPath],
  );
}
