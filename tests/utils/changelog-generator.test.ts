import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('parseGitLog', () => {
  it('returns an array of commit entries', async () => {
    const { parseGitLog } = await import('../../src/utils/changelog-generator.js');
    const commits = parseGitLog();
    assert.ok(Array.isArray(commits));
    for (const commit of commits) {
      assert.ok(typeof commit.hash === 'string');
      assert.ok(typeof commit.date === 'string');
      assert.ok(typeof commit.type === 'string');
      assert.ok(typeof commit.description === 'string');
    }
  });

  it('parses conventional commit types', async () => {
    const { parseGitLog } = await import('../../src/utils/changelog-generator.js');
    const commits = parseGitLog();
    const types = commits.map((c) => c.type);
    assert.ok(types.includes('feat') || types.includes('fix') || types.includes('chore'));
  });
});

describe('groupByVersion', () => {
  it('groups commits by version', async () => {
    const { groupByVersion } = await import('../../src/utils/changelog-generator.js');
    const commits = [
      { hash: 'a1', date: '2026-01-01', type: 'feat', description: 'add feature A' },
      { hash: 'b2', date: '2026-01-02', type: 'fix', description: 'fix bug B' },
      { hash: 'c3', date: '2026-01-03', type: 'chore', description: 'v0.2.0 release' },
      { hash: 'd4', date: '2026-01-04', type: 'feat', description: 'add feature D' },
    ] as const;
    const groups = groupByVersion([...commits]);
    assert.ok(groups.length >= 1);
  });

  it('handles empty commits array', async () => {
    const { groupByVersion } = await import('../../src/utils/changelog-generator.js');
    const groups = groupByVersion([]);
    assert.deepStrictEqual(groups, []);
  });
});

describe('renderChangelog', () => {
  it('produces markdown output', async () => {
    const { renderChangelog } = await import('../../src/utils/changelog-generator.js');
    const groups = [
      {
        version: 'v0.3.0',
        commits: [
          { hash: 'a1', date: '2026-05-24', type: 'feat', description: 'add stats command' },
          { hash: 'b2', date: '2026-05-24', type: 'fix', description: 'fix routing bug' },
        ],
      },
    ];
    const output = renderChangelog(groups);
    assert.ok(output.includes('# Changelog'));
    assert.ok(output.includes('## v0.3.0'));
    assert.ok(output.includes('### Features'));
    assert.ok(output.includes('add stats command'));
    assert.ok(output.includes('### Bug Fixes'));
    assert.ok(output.includes('fix routing bug'));
  });

  it('handles empty groups', async () => {
    const { renderChangelog } = await import('../../src/utils/changelog-generator.js');
    const output = renderChangelog([]);
    assert.ok(output.includes('# Changelog'));
  });
});

describe('generateChangelog', () => {
  it('returns a non-empty markdown string', async () => {
    const { generateChangelog } = await import('../../src/utils/changelog-generator.js');
    const result = generateChangelog();
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 0);
    assert.ok(result.startsWith('# Changelog'));
  });
});
