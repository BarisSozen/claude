---
name: code-review-expert
description: Comprehensive code review expertise. Use when reviewing code, evaluating architecture, or assessing quality. Triggers on review, evaluate, assess, audit, code quality, best practices.
---

# Code Review Expert

## Review Phases
```
Phase 1 (10%): Initial scan - structure, architecture
Phase 2 (40%): Top-down - Architecture → Modules → Functions
Phase 3 (30%): Multi-perspective - Architect, PM, QA, UX
Phase 4 (15%): Deep dives - Security, performance
Phase 5 (5%):  Report - Summarize, prioritize
```

## Severity

| Level | Action |
|-------|--------|
| 🔴 Critical | Must fix before deploy |
| 🟠 High | Fix this sprint |
| 🟡 Medium | Fix next sprint |
| 🟢 Low | Backlog |

## Quick Checklist

- [ ] No `any` types
- [ ] Error handling complete
- [ ] Input validation present
- [ ] No hardcoded secrets
- [ ] Parameterized queries
- [ ] Async errors handled
