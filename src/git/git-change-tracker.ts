import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ChangeTracker } from "../types/index.js";

const execFileAsync = promisify(execFile);

interface GitChangeTrackerOptions {
  cwd: string;
  runGit?: (args: string[]) => Promise<string>;
}

export class GitChangeTracker implements ChangeTracker {
  private runGit: (args: string[]) => Promise<string>;

  constructor(private options: GitChangeTrackerOptions) {
    this.runGit = options.runGit ?? ((args) => runGitCommand(options.cwd, args));
  }

  async getChangedFiles(since?: string): Promise<string[]> {
    const insideRepo = await this.isGitRepo();
    if (!insideRepo) {
      return [];
    }

    const tracked = await this.readLines(
      since
        ? ["diff", "--name-only", "--relative", since, "--"]
        : ["diff", "--name-only", "--relative", "HEAD", "--"]
    );
    const untracked = since ? [] : await this.readLines(["ls-files", "--others", "--exclude-standard"]);

    return [...new Set([...tracked, ...untracked])].sort();
  }

  async getCurrentRevision(): Promise<string | null> {
    const insideRepo = await this.isGitRepo();
    if (!insideRepo) {
      return null;
    }

    try {
      return (await this.runGit(["rev-parse", "HEAD"])).trim() || null;
    } catch {
      return null;
    }
  }

  private async isGitRepo(): Promise<boolean> {
    try {
      const output = await this.runGit(["rev-parse", "--is-inside-work-tree"]);
      return output.trim() === "true";
    } catch {
      return false;
    }
  }

  private async readLines(args: string[]): Promise<string[]> {
    try {
      const output = await this.runGit(args);
      return output
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }
}

async function runGitCommand(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return result.stdout;
}
