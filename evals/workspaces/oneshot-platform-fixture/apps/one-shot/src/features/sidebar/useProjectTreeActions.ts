import type React from 'react';
import { useCallback } from 'react';
import {
  createRun,
  defaultProjectProfile,
} from '@/features/app/defaults';
import type { AppShellState } from '@/features/app/types';
import { createWorkspaceSnapshot, workspaceSnapshotKey } from '@/features/project-workspace/mockData';

export type ProjectTreeAction =
  | { type: 'sort.set'; mode: AppShellState['sortMode'] }
  | { type: 'projects.reorder'; orderedProjectPaths: string[] }
  | { type: 'project.toggleExpanded'; projectPath: string; expanded: boolean }
  | { type: 'project.toggleBookmarked'; projectPath: string; bookmarked: boolean }
  | { type: 'project.toggleRunsHidden'; projectPath: string; hidden: boolean }
  | { type: 'project.toggleArchived'; projectPath: string; archived: boolean }
  | { type: 'project.rename'; projectPath: string; nextName: string }
  | { type: 'run.create'; projectPath: string }
  | { type: 'runs.reorder'; projectPath: string; orderedRunIds: string[] }
  | { type: 'run.rename'; projectPath: string; runId: string; nextName: string }
  | { type: 'run.delete'; projectPath: string; runId: string }
  | { type: 'run.toggleBookmarked'; projectPath: string; runId: string; bookmarked: boolean }
  | { type: 'run.toggleHidden'; projectPath: string; runId: string; hidden: boolean }
  | { type: 'run.toggleArchived'; projectPath: string; runId: string; archived: boolean };

type UseProjectTreeActionsInput = {
  setAppState: React.Dispatch<React.SetStateAction<AppShellState>>;
};

export function useProjectTreeActions({ setAppState }: UseProjectTreeActionsInput) {
  const dispatch = useCallback((action: ProjectTreeAction) => {
    setAppState((previous) => {
      if (action.type === 'sort.set') {
        return { ...previous, sortMode: action.mode };
      }

      if (action.type === 'projects.reorder') {
        return { ...previous, projectPaths: action.orderedProjectPaths };
      }

      if (action.type === 'project.toggleExpanded') {
        return {
          ...previous,
          projectProfiles: {
            ...previous.projectProfiles,
            [action.projectPath]: {
              ...previous.projectProfiles[action.projectPath],
              isExpanded: action.expanded,
            },
          },
        };
      }

      if (action.type === 'project.toggleBookmarked') {
        return {
          ...previous,
          projectProfiles: {
            ...previous.projectProfiles,
            [action.projectPath]: {
              ...previous.projectProfiles[action.projectPath],
              isBookmarked: action.bookmarked,
            },
          },
        };
      }

      if (action.type === 'project.toggleRunsHidden') {
        return {
          ...previous,
          projectProfiles: {
            ...previous.projectProfiles,
            [action.projectPath]: {
              ...previous.projectProfiles[action.projectPath],
              runsHidden: action.hidden,
            },
          },
        };
      }

      if (action.type === 'project.toggleArchived') {
        return {
          ...previous,
          projectProfiles: {
            ...previous.projectProfiles,
            [action.projectPath]: {
              ...previous.projectProfiles[action.projectPath],
              isArchived: action.archived,
            },
          },
        };
      }

      if (action.type === 'project.rename') {
        return {
          ...previous,
          projectProfiles: {
            ...previous.projectProfiles,
            [action.projectPath]: {
              ...previous.projectProfiles[action.projectPath],
              displayName: action.nextName,
            },
          },
        };
      }

      if (action.type === 'run.create') {
        const currentProfile =
          previous.projectProfiles[action.projectPath] ?? defaultProjectProfile(action.projectPath);
        const nextRun = createRun(action.projectPath);
        const key = workspaceSnapshotKey(action.projectPath, nextRun.id);
        return {
          ...previous,
          selectedProjectPath: action.projectPath,
          projectProfiles: {
            ...previous.projectProfiles,
            [action.projectPath]: {
              ...currentProfile,
              runs: [nextRun, ...currentProfile.runs],
              isExpanded: true,
            },
          },
          selectedRunByProject: {
            ...previous.selectedRunByProject,
            [action.projectPath]: nextRun.id,
          },
          projectWorkspaces: {
            ...previous.projectWorkspaces,
            [key]: createWorkspaceSnapshot(action.projectPath, nextRun.id, currentProfile.displayName),
          },
        };
      }

      if (action.type === 'runs.reorder') {
        const currentProfile =
          previous.projectProfiles[action.projectPath] ?? defaultProjectProfile(action.projectPath);
        const runById = new Map(currentProfile.runs.map((run) => [run.id, run]));
        const orderedRuns = action.orderedRunIds
          .map((runId) => runById.get(runId))
          .filter((run): run is NonNullable<typeof run> => Boolean(run));
        if (orderedRuns.length !== currentProfile.runs.length) {
          return previous;
        }
        return {
          ...previous,
          projectProfiles: {
            ...previous.projectProfiles,
            [action.projectPath]: {
              ...currentProfile,
              runs: orderedRuns,
            },
          },
        };
      }

      if (action.type === 'run.rename') {
        const currentProfile =
          previous.projectProfiles[action.projectPath] ?? defaultProjectProfile(action.projectPath);
        return {
          ...previous,
          projectProfiles: {
            ...previous.projectProfiles,
            [action.projectPath]: {
              ...currentProfile,
              runs: currentProfile.runs.map((run) =>
                run.id === action.runId ? { ...run, name: action.nextName } : run),
            },
          },
        };
      }

      if (action.type === 'run.delete') {
        const currentProfile =
          previous.projectProfiles[action.projectPath] ?? defaultProjectProfile(action.projectPath);
        const nextRuns = currentProfile.runs.filter((run) => run.id !== action.runId);
        const currentSelectedRun = previous.selectedRunByProject[action.projectPath];
        const shouldRotateSelected = currentSelectedRun === action.runId;
        const nextSelectedRunByProject = { ...previous.selectedRunByProject };
        if (shouldRotateSelected) {
          const nextRunId = nextRuns[0]?.id;
          if (nextRunId) {
            nextSelectedRunByProject[action.projectPath] = nextRunId;
          } else {
            delete nextSelectedRunByProject[action.projectPath];
          }
        }
        const nextWorkspaces = { ...previous.projectWorkspaces };
        delete nextWorkspaces[workspaceSnapshotKey(action.projectPath, action.runId)];
        return {
          ...previous,
          selectedRunByProject: nextSelectedRunByProject,
          projectWorkspaces: nextWorkspaces,
          projectProfiles: {
            ...previous.projectProfiles,
            [action.projectPath]: {
              ...currentProfile,
              runs: nextRuns,
            },
          },
        };
      }

      if (action.type === 'run.toggleBookmarked') {
        const currentProfile =
          previous.projectProfiles[action.projectPath] ?? defaultProjectProfile(action.projectPath);
        return {
          ...previous,
          projectProfiles: {
            ...previous.projectProfiles,
            [action.projectPath]: {
              ...currentProfile,
              runs: currentProfile.runs.map((run) =>
                run.id === action.runId ? { ...run, isBookmarked: action.bookmarked } : run),
            },
          },
        };
      }

      if (action.type === 'run.toggleHidden') {
        const currentProfile =
          previous.projectProfiles[action.projectPath] ?? defaultProjectProfile(action.projectPath);
        return {
          ...previous,
          projectProfiles: {
            ...previous.projectProfiles,
            [action.projectPath]: {
              ...currentProfile,
              runs: currentProfile.runs.map((run) =>
                run.id === action.runId ? { ...run, isHidden: action.hidden } : run),
            },
          },
        };
      }

      if (action.type === 'run.toggleArchived') {
        const currentProfile =
          previous.projectProfiles[action.projectPath] ?? defaultProjectProfile(action.projectPath);
        return {
          ...previous,
          projectProfiles: {
            ...previous.projectProfiles,
            [action.projectPath]: {
              ...currentProfile,
              runs: currentProfile.runs.map((run) =>
                run.id === action.runId ? { ...run, isArchived: action.archived } : run),
            },
          },
        };
      }

      return previous;
    });
  }, [setAppState]);

  return { dispatch };
}
