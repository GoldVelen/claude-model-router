
## Pipeline WebUI Improvements (2026-05-25)

### Bug: Pipeline input cleared after submission, no running indicator
- After clicking "Run Pipeline", the task input and working directory are cleared/reset
- Users cannot tell if a pipeline is still executing
- The only feedback is a brief "Submitted: jobId" message that disappears
- Old log messages (like "[shutdown] closing watcher and server...") persist in the log panel, confusing users

### Feature: Dedicated pipeline task dashboard
Add a dedicated area in the WebUI that:
1. Shows all background pipeline tasks (past and current)
2. Displays current execution stage for running tasks (plan → implement → test → execute → report)
3. Shows stage completion status (completed/failed/in-progress)
4. Allows viewing detailed results per task (ctx contents, executeResult, etc.)
5. Auto-refreshes without clearing input fields

### API requirements for the feature
- Need a `GET /api/runs` endpoint to list all jobs with their status
- Need to track job status per-stage (currently only "running" and "done")
- Consider persisting job results (currently in-memory, lost on restart)

---

## Pipeline Quality Improvements (2026-05-25)

### Implement completeness issue
AI implement stage only completed ~30% of planned work:
- New files: created correctly (middleware.ts, url-allowlist.ts)
- Existing file modifications: all skipped (upload/route.ts, repair/route.ts, configs/analyze/route.ts untouched)
- Manual step-by-step execution didn't have this problem

### Fix 1: Per-file modification checklist in plan prompt
The plan prompt (`DEFAULT_PIPELINE_STAGES.plan`) must produce a machine-verifiable manifest:
- Each file listed with: path, operation (CREATE/MODIFY/DELETE), exact sections to change
- Structured enough that the test stage can compare plan vs reality

### Fix 2: Verification stage — plan manifest vs actual changes
Add to the test stage (or a new verify stage):
- Read the plan's file manifest
- Check each file against git diff to confirm it was actually modified
- Flag any planned file that was NOT touched as a [MISSING] deviation
- Flag any unplanned file that was created/modified

### Fix 3: Summary report visibility after pipeline completes
Currently the report output is only in `ctx.report` (in-memory). Users expect:
- WebUI: show report card after pipeline finishes (summary, plan vs implementation table, issues)
- TUI: display report content when pipeline exits
- Logs: print report summary to stderr so it appears in server log

### Implementation order
1. Fix plan prompt (per-file manifest) → ensures implement stage has clear targets
2. Add verification to test stage → catches missing work post-implement
3. Report visibility → WebUI dashboard + TUI output
