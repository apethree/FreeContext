import React from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sortable,
  SortableItem,
  SortableItemHandle,
} from "@/components/ui/sortable";
import { HugeiconsIcon } from "@/components/ui/hugeicons-icon";
import { cn } from "@/lib/utils";
import { safeProjectName } from "@/features/app/defaults";
import type { ProjectProfile, ProjectRun } from "@/features/app/types";
import type { ProjectTreeAction } from "@/features/sidebar/useProjectTreeActions";
import { reorderVisibleRuns, visibleRuns } from "@/features/sidebar/sidebarHelpers";
import {
  Archive,
  Bookmark,
  ColumnInsertIcon,
  Eye,
  EyeOff,
  FolderDetailsIcon,
  FolderOpen,
  Settings2,
  SquarePen,
  Trash2,
  Triangle,
} from "@hugeicons/core-free-icons";

type ProjectItemProps = {
  index: number;
  projectPath: string;
  profile: ProjectProfile;
  isSelected: boolean;
  selectedRunId?: string;
  actionIconClass: string;
  folderToggleIconClass: string;
  onSelectProject: (projectPath: string, runId?: string) => void;
  onProjectTreeAction: (action: ProjectTreeAction) => void;
};

export function ProjectItem({
  index,
  projectPath,
  profile,
  isSelected,
  selectedRunId,
  actionIconClass,
  folderToggleIconClass,
  onSelectProject,
  onProjectTreeAction,
}: ProjectItemProps) {
  const runs = profile.runs ?? [];
  const visibleProjectRuns = visibleRuns(runs, {
    showHidden: !profile.runsHidden,
    showArchived: true,
  });

  const projectName =
    profile.displayName?.trim() || safeProjectName(projectPath);
  const hasExpandableRows = runs.length > 0;
  const triangleRotationClass = profile.isExpanded ? "rotate-180" : "rotate-90";
  const selectedRunExists = Boolean(
    selectedRunId && runs.some((run) => run.id === selectedRunId),
  );
  const iconClass = "h-[var(--app-icon-size)] w-[var(--app-icon-size)]";

  const selectProjectWithRunFallback = (runId?: string) => {
    if (runId) {
      onSelectProject(projectPath, runId);
      return;
    }

    if (!runs.length) {
      onSelectProject(projectPath);
      return;
    }

    onSelectProject(
      projectPath,
      selectedRunExists ? selectedRunId : runs[0].id,
    );
  };

  const onRenameProject = () => {
    const nextName = window.prompt("Rename project", projectName);
    if (!nextName || !nextName.trim()) {
      return;
    }
    onProjectTreeAction({
      type: "project.rename",
      projectPath,
      nextName: nextName.trim(),
    });
  };

  const onRenameRun = (run: ProjectRun) => {
    const nextName = window.prompt("Rename run", run.name);
    if (!nextName || !nextName.trim()) {
      return;
    }
    onProjectTreeAction({
      type: "run.rename",
      projectPath,
      runId: run.id,
      nextName: nextName.trim(),
    });
  };

  return (
    <SortableItem value={projectPath} asChild disabled={!isSelected}>
      <li
        data-slot="sidebar-menu-item"
        className="group/menu-item group/project relative"
      >
        <div
          data-project-row={projectPath}
          style={{ animationDelay: `${Math.min(index * 30, 300)}ms` }}
          className={cn(
            "sidebar-selection-shell",
            isSelected
              ? "sidebar-selection-active text-sidebar-accent-foreground"
              : "sidebar-selection-idle",
          )}
        >
          <SortableItemHandle
            asChild
            className={
              isSelected ? "cursor-grab active:cursor-grabbing" : undefined
            }
          >
            <div
              className="relative px-2 py-1"
              onClick={() => selectProjectWithRunFallback()}
            >
              {isSelected ? (
                <span
                  aria-hidden="true"
                  className="sidebar-selection-indicator"
                />
              ) : null}

              <div className="flex items-center gap-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="h-6 w-6"
                  title={
                    hasExpandableRows
                      ? `${profile.isExpanded ? "Collapse" : "Expand"} project`
                      : "Open project"
                  }
                  aria-label={
                    hasExpandableRows
                      ? `${profile.isExpanded ? "Collapse" : "Expand"} project ${projectName}`
                      : `Open project ${projectName}`
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!hasExpandableRows) {
                      selectProjectWithRunFallback();
                      return;
                    }
                    onProjectTreeAction({
                      type: "project.toggleExpanded",
                      projectPath,
                      expanded: !profile.isExpanded,
                    });
                  }}
                >
                  <span className="relative inline-flex h-5 w-5 items-center justify-center">
                    {hasExpandableRows ? (
                      <>
                        <HugeiconsIcon
                          icon={FolderDetailsIcon}
                          size={16}
                          className="absolute text-sidebar-foreground/80 opacity-100 transition-opacity group-hover/project:invisible group-hover/project:opacity-0 group-focus-within/project:invisible group-focus-within/project:opacity-0"
                        />
                        <HugeiconsIcon
                          icon={Triangle}
                          className={cn(
                            "absolute fill-current text-sidebar-foreground/65 opacity-0 transition-opacity group-hover/project:opacity-100 group-focus-within/project:opacity-100",
                            folderToggleIconClass,
                            triangleRotationClass,
                          )}
                        />
                      </>
                    ) : (
                      <HugeiconsIcon icon={FolderOpen} className={folderToggleIconClass} />
                    )}
                  </span>
                </Button>

                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-responsive-sm font-medium leading-[1.2]"
                  onClick={(event) => {
                    event.stopPropagation();
                    selectProjectWithRunFallback();
                  }}
                >
                  {projectName}
                </button>

                <div
                  className="pointer-events-none flex items-center gap-0.5 opacity-0 transition-opacity group-hover/project:pointer-events-auto group-hover/project:opacity-100 group-focus-within/project:pointer-events-auto group-focus-within/project:opacity-100"
                  onClick={(event) => event.stopPropagation()}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="h-6 w-6 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    title={
                      profile.isBookmarked
                        ? "Unbookmark project"
                        : "Bookmark project"
                    }
                    aria-label={`${profile.isBookmarked ? "Unbookmark" : "Bookmark"} project ${projectName}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onProjectTreeAction({
                        type: "project.toggleBookmarked",
                        projectPath,
                        bookmarked: !profile.isBookmarked,
                      });
                    }}
                  >
                    <HugeiconsIcon
                      icon={Bookmark}
                      className={cn(
                        actionIconClass,
                        profile.isBookmarked && "fill-current text-foreground",
                      )}
                    />
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        title="Project actions"
                        className="h-6 w-6 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                        aria-label={`Project actions for ${projectName}`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <HugeiconsIcon icon={Settings2} className={actionIconClass} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem
                        className="gap-2 whitespace-nowrap text-responsive-xs"
                        onSelect={onRenameProject}
                      >
                        <HugeiconsIcon icon={SquarePen} className={iconClass} />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="gap-2 whitespace-nowrap text-responsive-xs"
                        onSelect={() =>
                          onProjectTreeAction({
                            type: "project.toggleRunsHidden",
                            projectPath,
                            hidden: !profile.runsHidden,
                          })
                        }
                      >
                        {profile.runsHidden ? (
                          <HugeiconsIcon icon={Eye} className={iconClass} />
                        ) : (
                          <HugeiconsIcon icon={EyeOff} className={iconClass} />
                        )}
                        {profile.runsHidden ? "Show runs" : "Hide runs"}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="gap-2 whitespace-nowrap text-responsive-xs"
                        onSelect={() =>
                          onProjectTreeAction({ type: "run.create", projectPath })
                        }
                      >
                        <HugeiconsIcon icon={ColumnInsertIcon} size={16} className={iconClass} />
                        New run
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="gap-2 whitespace-nowrap text-responsive-xs"
                        onSelect={() =>
                          onProjectTreeAction({
                            type: "project.toggleArchived",
                            projectPath,
                            archived: !profile.isArchived,
                          })
                        }
                      >
                        {profile.isArchived ? (
                          <HugeiconsIcon icon={FolderOpen} className={iconClass} />
                        ) : (
                          <HugeiconsIcon icon={Archive} className={iconClass} />
                        )}
                        {profile.isArchived
                          ? "Unarchive project"
                          : "Archive project"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                </div>
              </div>
            </div>
          </SortableItemHandle>

          {profile.isExpanded ? (
            <div
              className="space-y-1.5 border-t border-sidebar-border/45 px-2 py-2"
              onClick={(event) => {
                if (event.target !== event.currentTarget) {
                  return;
                }
                selectProjectWithRunFallback();
              }}
            >
              <Sortable
                value={visibleProjectRuns}
                getItemValue={(item) => item.id}
                onValueChange={(nextVisibleRuns: ProjectRun[]) => {
                  const orderedRunIds = reorderVisibleRuns(
                    runs,
                    visibleProjectRuns,
                    nextVisibleRuns,
                  );
                  onProjectTreeAction({
                    type: "runs.reorder",
                    projectPath,
                    orderedRunIds,
                  });
                }}
                className="space-y-1.5 border-l border-sidebar-border/40 pl-2 pr-0"
              >
                {visibleProjectRuns.map((run) => (
                  <SortableItem
                    key={run.id}
                    value={run.id}
                    disabled={!(isSelected && selectedRunId === run.id)}
                  >
                    <SortableItemHandle
                      asChild
                      className={
                        isSelected && selectedRunId === run.id
                          ? "cursor-grab active:cursor-grabbing"
                          : undefined
                      }
                    >
                      <div
                        data-run-row={`${projectPath}:${run.id}`}
                        className={cn(
                          "group/run sidebar-selection-shell py-1.5 pl-2 pr-0",
                          selectedRunId === run.id && isSelected
                            ? "sidebar-selection-active"
                            : "sidebar-selection-idle bg-sidebar/25 hover:bg-sidebar-accent/20",
                          run.isHidden && "opacity-50",
                        )}
                        onClick={(event) => {
                          event.stopPropagation();
                          selectProjectWithRunFallback(run.id);
                        }}
                      >
                        {selectedRunId === run.id && isSelected ? (
                          <span
                            aria-hidden="true"
                            className="sidebar-selection-indicator"
                          />
                        ) : null}

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="min-w-0 flex-1 truncate text-left text-responsive-sm leading-[1.2]"
                            onClick={(event) => {
                              event.stopPropagation();
                              selectProjectWithRunFallback(run.id);
                            }}
                          >
                            {run.name}
                          </button>

                          <div className="pointer-events-none ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover/run:pointer-events-auto group-hover/run:opacity-100 group-focus-within/run:pointer-events-auto group-focus-within/run:opacity-100">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              className="h-6 w-6 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                              title={
                                run.isBookmarked
                                  ? "Unbookmark run"
                                  : "Bookmark run"
                              }
                              aria-label={`${run.isBookmarked ? "Unbookmark" : "Bookmark"} run ${run.name}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                onProjectTreeAction({
                                  type: "run.toggleBookmarked",
                                  projectPath,
                                  runId: run.id,
                                  bookmarked: !run.isBookmarked,
                                });
                              }}
                            >
                              <HugeiconsIcon
                                icon={Bookmark}
                                className={cn(
                                  actionIconClass,
                                  run.isBookmarked &&
                                    "fill-current text-foreground",
                                )}
                              />
                            </Button>

                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-xs"
                                  className="h-6 w-6 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                                  title="Run actions"
                                  aria-label={`Run actions for ${run.name}`}
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <HugeiconsIcon icon={Settings2} className={actionIconClass} />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-44">
                                <DropdownMenuItem
                                  className="gap-2 whitespace-nowrap text-responsive-xs"
                                  onSelect={() => onRenameRun(run)}
                                >
                                  <HugeiconsIcon icon={SquarePen} className={iconClass} />
                                  Rename
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="gap-2 whitespace-nowrap text-responsive-xs"
                                  onSelect={() =>
                                    onProjectTreeAction({
                                      type: "run.toggleHidden",
                                      projectPath,
                                      runId: run.id,
                                      hidden: !run.isHidden,
                                    })
                                  }
                                >
                                  {run.isHidden ? (
                                    <HugeiconsIcon icon={Eye} className={iconClass} />
                                  ) : (
                                    <HugeiconsIcon icon={EyeOff} className={iconClass} />
                                  )}
                                  {run.isHidden ? "Show" : "Hide"}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="gap-2 whitespace-nowrap text-responsive-xs"
                                  onSelect={() =>
                                    onProjectTreeAction({
                                      type: "run.toggleArchived",
                                      projectPath,
                                      runId: run.id,
                                      archived: !run.isArchived,
                                    })
                                  }
                                >
                                  {run.isArchived ? (
                                    <HugeiconsIcon icon={FolderOpen} className={iconClass} />
                                  ) : (
                                    <HugeiconsIcon icon={Archive} className={iconClass} />
                                  )}
                                  {run.isArchived ? "Unarchive" : "Archive"}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="gap-2 whitespace-nowrap text-responsive-xs"
                                  onSelect={() =>
                                    onProjectTreeAction({
                                      type: "run.delete",
                                      projectPath,
                                      runId: run.id,
                                    })
                                  }
                                >
                                  <HugeiconsIcon icon={Trash2} className={iconClass} />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>

                          </div>
                        </div>
                      </div>
                    </SortableItemHandle>
                  </SortableItem>
                ))}
              </Sortable>
            </div>
          ) : null}
        </div>
      </li>
    </SortableItem>
  );
}
