# Session Retrospective Skill

Generate a retrospective summary after a Claude Code session to capture learnings and identify improvements.

## Trigger

Use this skill when the user asks for:
- `/retro`
- "session retrospective"
- "what did we accomplish"
- "session summary"
- "lessons learned"

## Process

### 1. Gather Session Data

Analyze the current session by checking:

```bash
# Recent git activity (commits made this session)
git log --oneline --since="4 hours ago"

# Files changed
git diff --stat HEAD~5 2>/dev/null || git diff --stat

# Current branch status
git status --short
```

### 2. Structure the Retrospective

Create a retrospective with these sections:

```markdown
# Session Retro: [Date]

## Accomplished
- [List concrete deliverables, commits, features completed]

## What Went Well
- [Smooth implementations, good decisions, effective patterns]

## Challenges Faced
- [Blockers, bugs encountered, things that took longer than expected]

## Lessons Learned
- [Technical insights, process improvements, things to remember]

## Action Items for Next Session
- [ ] [Specific tasks to pick up]
- [ ] [Technical debt to address]
- [ ] [Improvements to implement]

## Session Stats
- Commits: X
- Files changed: X
- Lines added/removed: +X / -X
```

### 3. Save the Retrospective

Save to `retros/` directory with date-based naming:

```bash
mkdir -p retros
```

Filename format: `retros/YYYY-MM-DD-retro.md`

If multiple retros in one day, append a number: `retros/YYYY-MM-DD-retro-2.md`

### 4. Optional: Append to Running Log

If `retros/RETRO_LOG.md` exists, append a condensed summary to it for historical tracking.

## Output Format

Always output:
1. The full retrospective content to the user
2. Confirmation of where it was saved
3. Any suggested follow-up actions

## Tips for Better Retros

- Be specific about what was accomplished (reference commit hashes)
- Be honest about challenges - they're learning opportunities
- Keep action items actionable and concrete
- Note any patterns (recurring issues, effective solutions)
- Include context that future-you will need

## Example Output

```markdown
# Session Retro: 2026-01-16

## Accomplished
- Fixed live RPC balance display in /menu and /wallets (bb71f2c)
- Added error handling to hunt toggle (4d7580b)
- Cleaned up launchpad to pump.fun only (91a35aa)

## What Went Well
- RPC integration was straightforward once we found the right endpoint
- Hunt system refactor consolidated scattered logic

## Challenges Faced
- Initial wallet import wasn't processing private keys - edge case with input parsing
- Positions query had invalid join that caused silent failures

## Lessons Learned
- Always validate database queries return expected shape
- Hunt settings needed dedicated JSONB column - avoid overloading existing fields

## Action Items for Next Session
- [ ] Add integration tests for wallet import edge cases
- [ ] Monitor hunt system performance in production
- [ ] Consider adding retry logic to RPC calls

## Session Stats
- Commits: 10
- Files changed: 24
- Lines: +847 / -312
```
