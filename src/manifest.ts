import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ManifestVerificationResult } from './server/job-store.js';

const execAsync = promisify(exec);

export interface ManifestFile {
  path: string;
  operation: 'CREATE' | 'MODIFY' | 'DELETE';
  purpose: string;
}

export function parseManifest(planText: string): ManifestFile[] | null {
  const match = planText.match(
    /<!--\s*MANIFEST_START\s*-->[\s\S]*?```json\s*([\s\S]*?)\s*```[\s\S]*?<!--\s*MANIFEST_END\s*-->/,
  );
  if (!match || !match[1]) return null;
  try {
    const parsed = JSON.parse(match[1]) as { files?: ManifestFile[] };
    if (!Array.isArray(parsed.files)) return null;
    return parsed.files.filter(
      (f) => f && typeof f.path === 'string' && ['CREATE', 'MODIFY', 'DELETE'].includes(f.operation),
    );
  } catch {
    return null;
  }
}

export async function verifyManifest(
  manifest: ManifestFile[],
  workingDir: string,
  filesWritten: string[],
): Promise<ManifestVerificationResult> {
  const expected = manifest.map((m) => ({ path: m.path, operation: m.operation }));
  const expectedPaths = new Set(manifest.map((m) => m.path));
  const writtenSet = new Set(filesWritten);

  let gitChanged: string[] = [];
  try {
    const { stdout } = await execAsync('git diff --name-only HEAD', { cwd: workingDir, timeout: 10000 });
    gitChanged = stdout.split('\n').map((s) => s.trim()).filter(Boolean);
    const { stdout: untracked } = await execAsync('git ls-files --others --exclude-standard', {
      cwd: workingDir,
      timeout: 10000,
    });
    gitChanged.push(...untracked.split('\n').map((s) => s.trim()).filter(Boolean));
  } catch {
    gitChanged = filesWritten;
  }

  const changedSet = new Set(gitChanged);
  const missing: string[] = [];
  const matched: string[] = [];
  for (const m of manifest) {
    if (m.operation === 'DELETE') {
      matched.push(m.path);
      continue;
    }
    if (changedSet.has(m.path) || writtenSet.has(m.path)) {
      matched.push(m.path);
    } else {
      missing.push(m.path);
    }
  }

  const unplanned = gitChanged.filter((p) => !expectedPaths.has(p));

  return {
    expected,
    actual: { written: filesWritten, unchanged: missing, unexpected: unplanned },
    missing,
    unplanned,
    matched,
  };
}

export function formatVerificationReport(result: ManifestVerificationResult): string {
  const lines: string[] = ['## Manifest Verification', ''];
  lines.push(`- Planned files: ${result.expected.length}`);
  lines.push(`- Matched (changed as planned): ${result.matched.length}`);
  lines.push(`- **Missing (planned but NOT changed)**: ${result.missing.length}`);
  for (const p of result.missing) lines.push(`  - [MISSING] ${p}`);
  lines.push(`- **Unplanned (changed but NOT in plan)**: ${result.unplanned.length}`);
  for (const p of result.unplanned) lines.push(`  - [UNPLANNED] ${p}`);
  return lines.join('\n');
}
