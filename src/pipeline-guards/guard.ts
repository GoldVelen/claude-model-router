import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ConstraintKeywordsConfig {
  keywords: { zh: string[]; en: string[] };
  envOverride: string;
}

let cachedKeywords: ConstraintKeywordsConfig | null = null;

function loadKeywords(): ConstraintKeywordsConfig {
  if (!cachedKeywords) {
    const path = join(__dirname, 'constraint-keywords.json');
    cachedKeywords = JSON.parse(readFileSync(path, 'utf-8')) as ConstraintKeywordsConfig;
  }
  return cachedKeywords;
}

export interface GuardResult {
  triggered: boolean;
  matchedKeywords: string[];
}

export function checkConstraintKeywords(text: string): GuardResult {
  if (process.env.PIPELINE_GUARD_DISABLED === '1') {
    return { triggered: false, matchedKeywords: [] };
  }

  const config = loadKeywords();
  const lowerText = text.toLowerCase();
  const matched: string[] = [];

  for (const kw of config.keywords.zh) {
    if (text.includes(kw)) {
      matched.push(kw);
    }
  }

  for (const kw of config.keywords.en) {
    if (lowerText.includes(kw.toLowerCase())) {
      matched.push(kw);
    }
  }

  return { triggered: matched.length > 0, matchedKeywords: [...new Set(matched)] };
}

export function formatGuardWarning(matchedKeywords: string[]): string {
  const joined = matchedKeywords.map((k) => `"${k}"`).join(', ');
  return [
    'Constraint keywords detected: ' + joined,
    '',
    'Your prompt contains markers of a constrained task (minimal-diff fix,',
    'surgical change, etc.). Pipeline mode has a significantly higher failure',
    'rate for this type of task — business logic may be rewritten, tasks may',
    'be silently skipped, or Read results may be hallucinated.',
    '',
    'Recommendation: use Claude Code interactive environment instead.',
    'To bypass this check, set PIPELINE_GUARD_DISABLED=1',
  ].join('\n');
}
