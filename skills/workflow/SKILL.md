---
name: workflow
description: pi-mini-boss task workflow — plan → do → verify → close. Use for any non-trivial task to follow the module's task procedure, keep task status live, and close work with evidence.
---

# pi-mini-boss workflow

The order is configured in `agent.yaml` → `workflow`. Follow it for every non-trivial task.

## 1. plan
- Read the project's `AGENTS.md`/`CLAUDE.md` and the relevant plan/docs **first**.
- Break the task into steps; create a todo per step and mark the current one `in_progress` **before** starting it.
- Write the test cases / acceptance criteria before the code.

## 2. do
- Smallest diff that works; reuse what already exists in the repo.
- Update a task's status **in the same step** as the work (started → `in_progress`, done → `completed`) — never leave a stale status.
- Keep expected errors explicit, not exceptions.

## 3. verify
- Build, lint, and tests must pass clean — no warnings.
- Confirm a write actually landed; the build/test gate is authoritative, not IDE/LSP hints.
- For behaviour or UI changes, do a manual check and record the evidence.

## 4. close
- Mark the task `completed`.
- Update docs/decisions when a decision was made.
- Commit with a clear message.

## Rules
- Do not change scope silently — surface it.
- Never mark a task completed while its tests fail: keep it `in_progress` and add a blocker task.
- Project/stack specifics stay in the project's `AGENTS.md` and project memory, not here.
