# Full Code Review Command

Run a comprehensive code review using all available skills. This command examines recent changes and applies domain-specific expertise.

## Instructions

When this command is invoked, perform the following steps:

### Step 1: Identify Changed Files
First, identify what has changed:
```bash
git diff --name-only HEAD~1  # Recent commit changes
git diff --name-only         # Uncommitted changes
```

### Step 2: Invoke Review Skills
For each relevant skill based on the changed files, invoke it to review the code:

1. **code-review-expert** - Always run for general code quality
2. **code-consistency-validator** - Run if TypeScript, Rust, or PostgreSQL files changed
3. **defi-expert** - Run if DeFi-related code changed (protocols, tokens, trading)
4. **defi-registry-manager** - Run if token/protocol/chain configurations changed
5. **hft-quant-expert** - Run if trading strategy or signal code changed
6. **liquidity-depth-analyzer** - Run if swap/AMM/liquidity code changed
7. **system-integration-validator** - Run if API routes, database, or service connections changed
8. **error-logger** - Run if logging or error handling code changed
9. **latency-tracker** - Run if performance-critical paths changed

### Step 3: File Type Mapping
Use this mapping to determine which skills to invoke:

| File Pattern | Skills to Invoke |
|-------------|------------------|
| `*.ts` (server routes) | code-review-expert, system-integration-validator |
| `*.ts` (services) | code-review-expert, defi-expert, hft-quant-expert |
| `*.tsx` (React) | code-review-expert, apple-ui-design |
| `*.rs` (Rust) | code-review-expert, code-consistency-validator, latency-tracker |
| `schema.ts`, `*.sql` | code-consistency-validator, system-integration-validator |
| `*token*`, `*protocol*` | defi-registry-manager, defi-expert |
| `*arbitrage*`, `*trade*` | defi-expert, hft-quant-expert, liquidity-depth-analyzer |
| `*logger*`, `*error*` | error-logger |

### Step 4: Report Findings
After all skills have reviewed the code, provide a consolidated report:

```
## Review Summary

### Critical Issues (Must Fix)
- [List any critical bugs, security issues, or breaking changes]

### Warnings (Should Fix)
- [List any potential issues or improvements]

### Suggestions (Nice to Have)
- [List any optional enhancements]

### Skills Invoked
- [List which skills reviewed the code]

### Files Reviewed
- [List files that were examined]
```

### Step 5: Fix Critical Issues
If any critical issues are found, offer to fix them immediately.

## Usage
Run this command after making code changes:
- Before committing: `/review` to catch issues early
- After committing: `/review` to validate changes
- On PR review: `/review` for comprehensive analysis
