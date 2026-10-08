# pi-mini-boss

Bootstrap module for [Pi](https://pi.dev): agent config, first-run onboarding, roles and
purposes, an extension catalogue, and tasks with a web board — plus the persistent
memory, session search and skills it forked from
[pi-hermes-memory](https://github.com/chandra447/pi-hermes-memory).

Install it once, run `/onboard`, and every session after that knows who the agent is,
what you work on, which extensions you picked, and what it must always check.

## Install

```bash
pi install npm:pi-mini-boss
```

Start a session and run:

```
/onboard
```

Three windows follow — language → role and purpose → extensions — plus a fourth only if
something you switched off is still installed. Before they open you get a short tour of
what the module can do; it is repeated once setup finishes, so nobody misses it.

## What you get

### Config: `agent.yaml`

One file, shipped as a template (`config/agent.yaml`) and resolved per user to
`~/.pi/agent/pi-mini-boss/agent.yaml`.

| Key | Owner | What it does |
|---|---|---|
| `role.name` / `role.purpose` / `role.language` | you | who the agent is, what it works on, how it talks |
| `role.model` / `role.thinking` / `role.tools` | you, optional | applied at session start |
| `base_behavior` | module | universal rules — no stack, no project, no domain |
| `workflow` | module | the process the agent follows |
| `thinking` | module | how much reasoning is generated and shown |
| `required_extensions` | module | checked at startup (empty today) |
| `recommended_extensions` | you | the catalogue and what you picked |

`role.name` is a skill: profiles live under `skills/roles/` and the matching one is
applied (its focus, profile and what to check). Purposes work the same way, from
`skills/purposes/`.

### Extensions: pick once, reconfigure any time

Onboarding's third window offers a catalogue of ~70 packages grouped into eight tabs —
context and sessions, quality, safety, planning, UI, search, observability, delegation.
**★** marks the module's recommendation, **◉** what you picked, **✓** what is already
installed.

```bash
/extensions   # reopen the same panel whenever you like
```

Confirming does three things: your `agent.yaml` records the choice, newly picked
extensions are declared in `~/.pi/agent/settings.json` as `npm:<name>`, and unchecked
ones lose their declaration — Pi stops loading them, while the npm copies stay on disk,
so ticking the box again is instant. The module then runs the update itself; nothing has
to be typed into a shell. Restart Pi to load what changed.

### Tasks and the web board

The `task` tool keeps a list with live statuses (`pending` → `in_progress` →
`completed`, plus `blocked`). `/dashboard` starts a local Hono server on
<http://localhost:7817> with a realtime (SSE) board — open it in a browser while the
agent works.

### Memory and session search

Inherited from pi-hermes-memory and kept intact: `memory_add` / `memory_search`,
`session_search` across past sessions, failure memory, correction detection,
auto-consolidation, and skill storage. Data lives in `~/.pi/agent/pi-hermes-memory/`.

### Standing instructions vs `base_behavior`

- `base_behavior` (in `agent.yaml`) — the module's rules, shipped with the package and
  replaced on update.
- `/memory-pin` — **your** rules, injected into every session, never touched by a
  package update. Stored in `~/.pi/agent/pi-hermes-memory/STANDING.md` (20 entries /
  2000 characters). Deliberately a slash command rather than a tool: the model cannot
  write standing instructions for itself.

## Commands

| Command | What it does |
|---|---|
| `/onboard` | full setup: language, role, purpose, extensions |
| `/extensions` | add or switch off extensions |
| `/dashboard` | task board in the browser (port 7817) |
| `/memory-pin [list \| remove <n> \| clear]` | rules that must hold in every session |
| `/memory-insights` | show what is stored in persistent memory |
| `/memory-consolidate` | merge entries and free space |
| `/memory-interview` | answer a few questions to pre-fill your user profile |
| `/memory-skills` | manage procedural skills |
| `/memory-preview-context` | preview what memory is injected |
| `/memory-switch-project` | switch the active project scope |
| `/memory-index-sessions` | import past sessions into search |
| `/memory-sync-markdown` | rebuild the search mirror from markdown |

## Development

```bash
npm run check   # typecheck
npm test        # unit tests
```

## Credits

Forked from [pi-hermes-memory](https://github.com/chandra447/pi-hermes-memory) by
chandra447 (MIT): the memory system, session search and skills come from there. The
bootstrap layer — config, onboarding, roles, extension catalogue, task board — is this
package's own.

## License

MIT
