# Quick Code Review

Fast review of uncommitted changes focusing on critical issues only.

## Instructions

1. Run `git diff --name-only` to see changed files
2. For each changed file, check for:
   - Security vulnerabilities (SQL injection, XSS, command injection)
   - Type mismatches across TypeScript/Rust/PostgreSQL boundaries
   - Incorrect token decimals (CRITICAL for DeFi)
   - Missing error handling
   - Hardcoded secrets or credentials

3. Report only critical issues that must be fixed before commit

4. Skip style suggestions, minor improvements, and nice-to-haves

Keep the review brief and actionable.
