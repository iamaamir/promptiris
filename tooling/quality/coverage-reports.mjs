import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const workspaceParents = ['apps', 'packages'];

export async function workspaceDirectories(root) {
  const directories = [];
  for (const parent of workspaceParents) {
    let entries;
    try {
      entries = await readdir(join(root, parent), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) directories.push(join(root, parent, entry.name));
    }
  }
  return directories.sort((left, right) => left.localeCompare(right));
}

export async function discoverWorkspaceCoverage(root) {
  const reports = [];
  for (const workspace of await workspaceDirectories(root)) {
    const report = join(workspace, 'coverage', 'coverage-final.json');
    try {
      await access(report);
      reports.push(report);
    } catch {
      // A workspace without a coverage-producing test target contributes no report.
    }
  }
  return reports;
}
