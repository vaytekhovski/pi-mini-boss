# pi-mini-boss

Bootstrap for [Pi](https://pi.dev): a one-time setup that gives the agent a role,
a purpose, a language, a chosen set of extensions, and a task board — plus the
persistent memory, session search and skills from
[pi-hermes-memory](https://github.com/chandra447/pi-hermes-memory).

Install it once, run `/onboard`, and every session after that knows who the agent
is, what you work on, which extensions you picked, and what it must always check.

## Install

Requires Pi `>= 0.80.6`.

```bash
pi install npm:pi-mini-boss

# from git
pi install git:github.com/vaytekhovski/pi-mini-boss
```

Start a session and run:

```
/onboard
```

Three windows follow — language → role and purpose → extensions — plus a fourth
only when something you switched off is still installed. A short tour of what the
module can do runs before them and again after setup.

## Commands

| Command | What it does |
|---|---|
| `/onboard` | full setup: language, role, purpose, extensions |
| `/language` | change the language only |
| `/profile` | change role and purpose only |
| `/mini-boss` | show the current setup and the command list |
| `/extensions` | add or switch off extensions |
| `/dashboard` | task board in the browser (port 7817) |

## What you get

### Config: `agent.yaml`

One file, shipped as a template (`config/agent.yaml`) and resolved per user to
`~/.pi/agent/pi-mini-boss/agent.yaml`. `/onboard`, `/language` and `/profile`
write it for you, but you can edit it by hand:

| Key | Owner | What it does |
|---|---|---|
| `role.name` / `role.purpose` / `role.language` | you | who the agent is, what it works on, how it talks |
| `role.model` / `role.thinking` / `role.tools` | you, optional | applied at session start |
| `base_behavior` / `workflow` / `thinking` | module | universal rules and the working process |
| `required_extensions` / `recommended_extensions` | module / you | checked at startup; the catalogue and your picks |

`role.name` and `role.purpose` are skills: the matching profile under
`skills/roles/` or `skills/purposes/` is applied.

### Extensions

Pick once in onboarding, reconfigure any time with `/extensions`. The catalogue
has ~70 packages grouped into eight tabs; **★** marks the recommendation, **◉**
your pick, **✓** what is already installed. Confirming records the choice, adds
the new packages to `~/.pi/agent/settings.json`, drops the unchecked ones, and
fetches what changed. Restart Pi to load them.

### Pipeline and subagents

As an orchestrator, the agent runs every non-trivial task through a standard
pipeline — **анализ → планирование → разработка → ревью → тестирование →
отчёт** — splitting each step into sub-steps and delegating them to subagents it
orchestrates and monitors. The subagent catalogue (`skills/subagents/`) ships
six roles out of the box — analyst, planner, implementer, reviewer, tester,
reporter — each with its own purpose and model (deepseek-flash for fast work,
deepseek-v4-pro for heavy reasoning). The agent keeps the task board live and
reports progress back to you.

### Tasks, memory and skills

- The `task` tool keeps a list with live statuses covering the whole pipeline;
  `/dashboard` opens a realtime board on <http://localhost:7817> — drag a card
  between stages, click it to edit, use the add row at the bottom of a column to
  create a task, and watch a live activity panel showing what the agent and its
  subagents are doing.
- Tasks belong to a **project** — the session's directory, or `inbox` outside one.
  The dashboard draws one board per project on a single screen, so several projects
  running in parallel are visible at once; collapse or hide the boards you don't
  need ("Показать скрытые" brings them back) and filter the stages per board.
- Activity is per project too: the agent and each subagent get their own row on
  the board they belong to, so parallel sessions never share one status.
- The dashboard ships two themes — light "parchment" (default) and dark
  graphite — switched from the header and remembered in the browser.
- While a question panel is open (`ask`, onboarding) the project is marked
  "⏳ ждёт ответа" — a badge in the board header and globally at the top of the
  page — and cleared once you answer or cancel; the agent can also set it itself
  with `boss waiting=true`. A board whose tasks are all closed shows "✓ готово".
- `memory_add` / `memory_search` persist facts, decisions and failures across
  sessions; `session_search` searches past sessions. Data lives in
  `~/.pi/agent/pi-hermes-memory/`.
- `/memory-pin` stores **your** rules for every session, in a file a package
  update never touches. Deliberately a slash command, not a tool: the model
  cannot write standing instructions for itself.

## Development

```bash
npm install
npm run check   # typecheck
npm test        # unit tests
```

Run a local copy without installing it: `pi -e ./src/index.ts`.

## Credits

Forked from [pi-hermes-memory](https://github.com/chandra447/pi-hermes-memory) by
chandra447 (MIT): memory, session search and skills come from there. The bootstrap
layer — config, onboarding, roles, extension catalogue, task board — is this
package's own.

## License

MIT
