import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const CACHE_ROOT = resolve(REPO_ROOT, "evals", ".promptfoo", "workspaces");
const SOURCE_AGENT_WORKSPACE = resolve(REPO_ROOT, "evals", "workspaces", "oneshot-platform-fixture");
const STAGED_AGENT_WORKSPACE = resolve(CACHE_ROOT, "agent-workspace");
const SOURCE_EDIT_FIXTURES = resolve(REPO_ROOT, "evals", "fixtures");
const STAGED_EDIT_WORKSPACE = resolve(CACHE_ROOT, "edit-workspace");

async function resetDir(targetPath) {
  await rm(targetPath, { recursive: true, force: true });
  await mkdir(dirname(targetPath), { recursive: true });
}

async function ensureGitRepo(workspaceRoot) {
  await new Promise((resolvePromise, rejectPromise) => {
    execFile("git", ["init", "-q"], { cwd: workspaceRoot }, (error) => {
      if (error) {
        rejectPromise(error);
        return;
      }
      resolvePromise();
    });
  });
}

export async function prepareAgentWorkspace() {
  await resetDir(STAGED_AGENT_WORKSPACE);
  await cp(SOURCE_AGENT_WORKSPACE, STAGED_AGENT_WORKSPACE, { recursive: true });
  await ensureGitRepo(STAGED_AGENT_WORKSPACE);
  return STAGED_AGENT_WORKSPACE;
}

export async function prepareEditWorkspace() {
  await resetDir(STAGED_EDIT_WORKSPACE);
  await mkdir(resolve(STAGED_EDIT_WORKSPACE, "evals"), { recursive: true });
  await cp(SOURCE_EDIT_FIXTURES, resolve(STAGED_EDIT_WORKSPACE, "evals", "fixtures"), { recursive: true });
  await ensureGitRepo(STAGED_EDIT_WORKSPACE);
  return STAGED_EDIT_WORKSPACE;
}

export function getStagedAgentWorkspace() {
  return STAGED_AGENT_WORKSPACE;
}

export function getStagedEditWorkspace() {
  return STAGED_EDIT_WORKSPACE;
}
