---
name: ralph-wiggum
description: Iterative AI development loop for persistent automation. Use when building features overnight, running TDD loops, or tasks needing repeated iteration until success. Triggers on: loop, iterate, overnight, keep trying, until done.
---

# Ralph Wiggum Loop

## Core Concept
```bash
while :; do cat PROMPT.md | claude ; done
```

Keep iterating until task is complete.

## Usage

### Basic Loop
```bash
/ralph-wiggum:ralph-loop "Build feature X" --completion-promise "DONE" --max-iterations 30
```

### TDD Loop
```bash
/ralph-wiggum:ralph-loop "Implement feature using TDD.
1. Write failing test
2. Implement to pass
3. Run tests
4. Fix if failing
5. Repeat

Output <promise>DONE</promise> when all tests green." --max-iterations 50
```

## Prompt Best Practices

1. **Clear completion criteria** - Define what "done" means
2. **Incremental goals** - Break into phases
3. **Self-correction** - Include retry logic
4. **Escape hatch** - Always use --max-iterations

## Template
Implement [FEATURE].
Requirements:

[Requirement 1]
[Requirement 2]

Success criteria:

All tests passing
No linter errors

After 15 failed iterations:

Document blockers
List attempted approaches

Output <promise>COMPLETE</promise> when done.
