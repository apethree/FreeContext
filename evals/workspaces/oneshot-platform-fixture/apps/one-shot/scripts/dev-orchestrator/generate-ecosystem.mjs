#!/usr/bin/env node
import { loadResolvedWorktrees, writeEcosystemFile } from './shared-config.mjs';

try {
  const resolved = loadResolvedWorktrees({ allowExampleFallback: true });
  const result = writeEcosystemFile(resolved);
  console.log(`[dev-orchestrator] generated ${result.path}`);
  console.log(`[dev-orchestrator] worktrees=${resolved.worktrees.length} processes=${result.appCount}`);
  for (const worktree of resolved.worktrees) {
    console.log(`  - ${worktree.worktreeKey}: cloud=${String(worktree.cloudPort ?? '-')} app=${String(worktree.appPort ?? '-')}${worktree.blockedReason ? ` blocked=${worktree.blockedReason}` : ''}`);
  }
} catch (error) {
  console.error(`[dev-orchestrator] ${String(error)}`);
  process.exit(1);
}
