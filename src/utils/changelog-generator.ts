import { execSync } from 'node:child_process';

export interface CommitEntry {
  readonly hash: string;
  readonly date: string;
  readonly type: string;
  readonly description: string;
}

export interface VersionGroup {
  readonly version: string;
  readonly commits: readonly CommitEntry[];
}

export function parseGitLog(): CommitEntry[] {
  const output = execSync(
    'git log --format="%H||%ai||%s" --no-merges',
    { encoding: 'utf-8' },
  );

  return output
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const [hash, date, ...subjectParts] = line.split('||');
      const subject = (subjectParts ?? []).join('||');
      const match = subject.match(/^(\w+)(?:\([^)]*\))?:\s*(.+)/);
      return {
        hash: hash ?? '',
        date: (date ?? '').split(' ')[0] ?? '',
        type: match ? match[1] ?? 'chore' : 'chore',
        description: match ? match[2] ?? subject : subject,
      };
    });
}

const VERSION_PATTERN = /^v\d+\.\d+\.\d+/;
const INIT_PATTERNS = new Set(['init project skeleton', 'initial release']);

function addCommit(group: VersionGroup, commit: CommitEntry): VersionGroup {
  return { ...group, commits: [...group.commits, commit] };
}

export function groupByVersion(commits: readonly CommitEntry[]): VersionGroup[] {
  const groups: VersionGroup[] = [];
  let current: VersionGroup | null = null;

  for (const commit of commits) {
    const desc = commit.description;

    if (VERSION_PATTERN.test(desc)) {
      if (current) groups.push(current);
      current = { version: desc.split(' ')[0] ?? desc, commits: [] };
    } else if (INIT_PATTERNS.has(desc)) {
      if (!current || current.version !== 'v0.1.0') {
        if (current) groups.push(current);
        current = { version: 'v0.1.0', commits: [] };
      }
      current = addCommit(current, commit);
    } else if (current) {
      current = addCommit(current, commit);
    } else {
      current = { version: 'Unreleased', commits: [commit] };
    }
  }

  if (current) groups.push(current);
  return groups;
}

const TYPE_LABELS: Record<string, string> = {
  feat: 'Features',
  fix: 'Bug Fixes',
  perf: 'Performance',
  refactor: 'Refactoring',
  docs: 'Documentation',
  test: 'Tests',
  chore: 'Chores',
  ci: 'CI/CD',
};

export function renderChangelog(groups: readonly VersionGroup[]): string {
  const lines: string[] = ['# Changelog', ''];

  for (const group of groups) {
    lines.push(`## ${group.version}`, '');
    const byType: Record<string, CommitEntry[]> = {};

    for (const commit of group.commits) {
      const t = commit.type;
      if (!byType[t]) byType[t] = [];
      byType[t]!.push(commit);
    }

    for (const [type, entries] of Object.entries(byType)) {
      const label = TYPE_LABELS[type] ?? type;
      lines.push(`### ${label}`, '');
      for (const entry of entries) {
        const dateStr = entry.date ? ` (${entry.date})` : '';
        lines.push(`- ${entry.description}${dateStr}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n').trim() + '\n';
}

export function generateChangelog(): string {
  const commits = parseGitLog();
  const groups = groupByVersion(commits);
  return renderChangelog(groups);
}
