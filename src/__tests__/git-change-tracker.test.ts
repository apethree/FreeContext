import { describe, expect, it, vi } from "vitest";
import { GitChangeTracker } from "../git/git-change-tracker.js";

describe("GitChangeTracker", () => {
  it("uses git diff for explicit revisions", async () => {
    const runGit = vi.fn(async (args: string[]) => {
      if (args[0] === "rev-parse") {
        return "true\n";
      }
      expect(args).toEqual(["diff", "--name-only", "--relative", "HEAD~2", "--"]);
      return "src/a.ts\nsrc/b.ts\n";
    });

    const tracker = new GitChangeTracker({ cwd: "/tmp/project", runGit });
    const changed = await tracker.getChangedFiles("HEAD~2");

    expect(changed).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("merges tracked and untracked changes when no revision is provided", async () => {
    const runGit = vi.fn(async (args: string[]) => {
      if (args[0] === "rev-parse") {
        return "true\n";
      }
      if (args[0] === "diff") {
        return "src/b.ts\nsrc/a.ts\n";
      }
      if (args[0] === "ls-files") {
        return "src/c.ts\n";
      }
      return "";
    });

    const tracker = new GitChangeTracker({ cwd: "/tmp/project", runGit });
    const changed = await tracker.getChangedFiles();

    expect(changed).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
  });

  it("returns null and no files outside git repos", async () => {
    const runGit = vi.fn(async (args: string[]) => {
      if (args[0] === "rev-parse") {
        throw new Error("not a git repo");
      }
      return "";
    });

    const tracker = new GitChangeTracker({ cwd: "/tmp/project", runGit });
    await expect(tracker.getCurrentRevision()).resolves.toBeNull();
    await expect(tracker.getChangedFiles()).resolves.toEqual([]);
  });
});
