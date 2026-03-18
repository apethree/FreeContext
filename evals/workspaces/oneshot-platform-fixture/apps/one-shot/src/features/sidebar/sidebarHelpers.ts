import { safeProjectName } from '@/features/app/defaults';
import type { ProjectProfile, ProjectRun, SortMode } from '@/features/app/types';

export function visibleRuns(runs: ProjectRun[], options: { showHidden: boolean; showArchived: boolean }) {
  return runs.filter((run) => {
    if (!options.showHidden && run.isHidden) return false;
    if (!options.showArchived && run.isArchived) return false;
    return true;
  });
}

export function reorderVisibleRuns(
  allRuns: ProjectRun[],
  previousVisibleRuns: ProjectRun[],
  nextVisibleRuns: ProjectRun[],
): string[] {
  const previousVisibleIds = previousVisibleRuns.map((run) => run.id);
  const nextVisibleIds = nextVisibleRuns.map((run) => run.id);

  if (previousVisibleIds.length !== nextVisibleIds.length) {
    return allRuns.map((run) => run.id);
  }

  const nextVisibleQueue = [...nextVisibleIds];
  const visibleSet = new Set(nextVisibleQueue);

  return allRuns.map((run) => {
    if (!visibleSet.has(run.id)) {
      return run.id;
    }
    return nextVisibleQueue.shift() ?? run.id;
  });
}

export function sortProjectPaths(
  projectPaths: string[],
  mode: SortMode,
  projectProfiles: Record<string, ProjectProfile>,
  projectBookmarks: Record<string, boolean> = {},
) {
  if (mode === 'manual') {
    return [...projectPaths];
  }

  const paths = [...projectPaths];
  paths.sort((left, right) => {
    const leftProfile = projectProfiles[left];
    const rightProfile = projectProfiles[right];
    const leftBookmarked = Boolean(projectBookmarks[left] ?? leftProfile?.isBookmarked);
    const rightBookmarked = Boolean(projectBookmarks[right] ?? rightProfile?.isBookmarked);

    if (leftBookmarked !== rightBookmarked) {
      return leftBookmarked ? -1 : 1;
    }

    if (mode === 'name') {
      return safeProjectName(left).localeCompare(safeProjectName(right));
    }

    const leftCreated = leftProfile?.createdAt ?? 0;
    const rightCreated = rightProfile?.createdAt ?? 0;
    if (leftCreated !== rightCreated) {
      return rightCreated - leftCreated;
    }

    return projectPaths.indexOf(left) - projectPaths.indexOf(right);
  });

  return paths;
}
