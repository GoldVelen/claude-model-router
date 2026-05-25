# Pipeline Stage Prompt Classification Report

Generated: 2026-05-25

## Classification Rules

| Condition | Classification | Action |
|-----------|---------------|--------|
| Prompt contains constraint keywords | `interactive-only` | Remove from pipeline entry |
| No constraint keywords + generative keywords present | `pipeline-ok` | Keep in pipeline |
| Neither or ambiguous | `needs-review` | Human decision required |

## Built-in Stage Prompts (DEFAULT_PIPELINE_STAGES)

| Stage | Classification | Constraint Hits | Generative Hits | Notes |
|-------|---------------|-----------------|-----------------|-------|
| plan | **pipeline-ok** | — | create, implement, output, produce | Architect blueprint generation |
| implement | **pipeline-ok** | do not refactor, existing code | write, implement, output | Hits are instructional guardrails, not task constraints. Human decision: pipeline-ok. |
| test | **pipeline-ok** | — | write, implement, output | Test generation |
| execute | **pipeline-ok** | — | implement, output | Code block extraction (parsing) |
| report | **pipeline-ok** | — | create, implement | Summary generation |

## Summary

- **pipeline-ok**: 5 stages — plan, implement, test, execute, report
- **needs-review**: 0 stages
- **interactive-only**: 0 stages

## Resolved: implement stage (was needs-review)

**Why flagged**: The implement stage prompt contains `do not refactor` and `existing code` in its RULES section. These are instructions telling the model what NOT to do:

> "Do NOT refactor or 'improve' existing code unless the plan explicitly tells you to"

**Human decision**: False positive. The keywords appear as guardrails for the model, not as a description of the task. The implement stage is a core generative pipeline stage. **Classified as `pipeline-ok`.** No prompt content modified. No files moved.

## User Task Templates

**No separate user-facing prompt template files exist.** Users write task descriptions directly in the WebUI textarea, CLI args, or API payload. The L2 keyword guard handles runtime detection for user-submitted tasks.

The only "prompt library" is `DEFAULT_PIPELINE_STAGES` in `src/pipeline.ts` and optional per-stage overrides in `~/.config/claude-model-router/config.json`. These are system prompts for pipeline orchestration, not user-selectable task templates.

## Actions Taken

- No prompt content modified (per plan constraint)
- No files moved (no separate prompt template files exist)
- `implement` stage false positive resolved: pipeline-ok
