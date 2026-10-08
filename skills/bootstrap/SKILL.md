---
name: bootstrap
description: First-run onboarding for pi-mini-boss. Use on a fresh agent when the module says the config is missing (or when the user asks to reconfigure): read the template, verify required extensions, ask the user a few questions, and write agent.yaml.
---

# pi-mini-boss bootstrap

Run once, before the first real task — the module marks onboarding as pending until the user config exists.

## Steps

1. **Read the core template** at `config/agent.yaml` in the pi-mini-boss package (shipped defaults: `base_behavior`, `required_extensions`, `workflow`, `thinking`).
2. **Ask the user** through the `ask` tool (the terminal board panel), one question at a time. If `ask` reports the board is not running, ask in plain text instead:
   - `role.name` — who the agent is (e.g. "senior backend developer");
   - `role.purpose` — what they work on;
   - `role.language` — reply language;
   - which `recommended_extensions` to install.
3. **Write the resolved config** to `~/.pi/agent/pi-mini-boss/agent.yaml`:
   - take the user's answers for `role`;
   - keep `base_behavior`, `required_extensions`, `workflow`, `thinking` from the template;
   - set `onboarded: true`.
4. **Verify extensions**: report which `required_extensions` are missing and offer to install them (`pi install <source>`). Explain each missing `recommended` extension in one line.
5. **Confirm** to the user, in one short message, what the agent is now configured as.

## Rules

- `base_behavior` stays universal — no stack, domain, or project specifics. Those belong in the project's `AGENTS.md` and project memory.
- Personal always-on rules go through `/memory-pin` (`STANDING.md`), not this config.
- Re-running is safe: it only updates `role` and the recommended list, and keeps the core.
