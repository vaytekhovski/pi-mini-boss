# pi-mini-boss — bootstrap-модуль для Pi (план)

> Имя пакета: `pi-mini-boss`. Владелец: `vaytekhovski`.
> Лицензия базового кода: MIT (форк `chandra447/pi-hermes-memory`).

## 0. Идея и цель

Один пакет, который пользователь ставит **первым** при работе с Pi:

1. **Конфигурируемый файл** — роль, назначение, базовые правила, workflow. Пользователь меняет роль/назначение, базовые вещи остаются.
2. **Первый запуск** — агент читает конфиг, проверяет что нужные расширения установлены, задаёт уточняющие вопросы и сам конфигурируется.
3. **Единый workflow** — на каждой задаче агент придерживается плана из конфига.
4. **Свой веб-дашборд** — реальтайм по задачам, больше статусов, без скриптов-костылей.
5. **Рекомендация модулей** — предлагает установить нужные, объясняя зачем и что дадут.
6. **Кроссплатформенность** — Windows / WSL / Linux / macOS: тесты и рантайм не зависят от ОС.

## 1. Аудит текущего состояния (что уже стоит)

Установлено 12 пакетов (после удаления `pi-lens`). Большая часть — разрозненные сторонние модули со своими конфигами.

| Пакет | Даёт | Решение |
|---|---|---|
| `pi-hermes-memory` (chandra447, MIT) | память, `session_search`, `skill_manage`, `/memory-interview`, `/memory-pin` (STANDING.md), correction-detector | **Форкнуть в свой пакет** |
| `pi-kanban` | веб-дашборд + `kanban-sync.mjs` (carrier-session хак) | **Заменить своим** |
| `rolebox` | роли (движок под opencode) | **Заменить своим конфигом** |
| `bigpowers` | ~80 скиллов PMBOK-lifecycle | **Заменить** на lean-workflow |
| `pi-web-access` | интернет (`web_search`, `fetch_content`) | **Оставить** — нужен для доступа в сеть |
| `billion-context-pi` | сжатие контекста: LLM сам решает когда/что сжимать | **Добавить** как recommended (см. §5.1) |
| `pi-subagents` | `subagent`, council | оставить |
| `pi-background-tasks` | `bg_*` | оставить |
| `pi-goal-x` | `create_goal`/`get_goal` | оставить (позже — свернуть в конфиг) |
| `@juicesharp/rpiv-todo` | `todo` | оставить |
| `@juicesharp/rpiv-ask-user-question` | `ask_user_question` | оставить |
| `ponytail` | lazy-режим | оставить |
| `@narumitw/pi-usage` | статистика | опционально/drop |
| ~~`pi-lens`~~ | LSP-диагностика | **удалён** — в webapibase давал ложные ошибки |

**Важный факт:** `pi-hermes-memory` — сторонний MIT-пакет, а не наш исходник. Наши — только данные (`~/.pi/agent/pi-hermes-memory/`: `MEMORY.md`, `USER.md`, `failures.md`, `sessions.db`, 3 скилла) и скиллы, которые мы создали в процессе.

### Что `pi-hermes-memory` УЖЕ умеет (не переделывать)
- `/memory-interview` — онбординг-вопросы на первом запуске
- `/memory-pin` → `STANDING.md` — «базовые правила, которые остаются» (инжектится всегда)
- `session_search`, `memory_search`, `skill_manage` — «чему научились»
- correction-detector, background-review (каждые 10 ходов), auto-consolidation, secret-scanning

### Чего в нём НЕТ (наши 3 пробела)
1. Единого конфига роль/назначение/base_behavior/workflow.
2. Проверки требуемых/рекомендованных расширений на старте.
3. Своего дашборда с реальтаймом.

## 2. Архитектура

Форк `pi-hermes-memory` → единый пакет со слоями:

```
pi-mini-boss/
├── package.json               # "pi-package" + peerDeps (host) + deps (hono, better-sqlite3)
├── src/                       # форк памяти (memory, session-search, skills)
├── src/bootstrap/             # НОВОЕ:
│   ├── config.ts              #   чтение/запись agent.yaml
│   ├── extension-check.ts     #   проверка required/recommended
│   └── dashboard.ts           #   веб-сервер + SSE
├── skills/
│   ├── bootstrap/SKILL.md     #   «первый запуск»: конфиг → проверка → вопросы
│   └── workflow/SKILL.md      #   «как вести задачу» (вместо bigpowers)
├── prompts/
│   ├── onboard.md             # /onboard — (пере)конфигурация
│   ├── plan.md                # /plan — спланировать задачу
│   └── status.md              # /status — сводка задач
├── themes/
└── config/agent.yaml          # КОНФИГУРИРУЕМЫЙ ФАЙЛ (см. §3)
```

Слои соответствуют механизмам Pi:
- **Package** — дистрибуция (`pi install`).
- **Extension** — `/onboard`, `/plan`, `/status`, проверка расширений, дашборд-сервер.
- **Skill** — инструкции workflow + онбординг (грузится по требованию).
- **Prompt template** — быстрые команды.

## 3. Конфиг-файл `agent.yaml` (спецификация)

```yaml
# пользователь редактирует ТОЛЬКО: role, purpose, language, recommended
role:
  name: "senior backend developer"
  purpose: "развивать marketplace-платформу на ASP.NET Core"
  language: ru

# ядро — не редактируется пользователем; ТОЛЬКО универсальное (без стека/домена/проекта)
base_behavior:
  - читай AGENTS.md/CLAUDE.md проекта первым и следуй его конвенциям
  - сборка и тесты проходят чисто — без предупреждений и ошибок
  - ожидаемые ошибки обрабатывай явно, не через исключения
  - проверяй, что правка реально легла в файл (не доверяй вызову edit)
  - авторитетны сборка и тесты, а не диагностика IDE/LSP
  - минимальный diff — не переусложняй
  - отмечай статус задачи при старте и при завершении

# проверяется на session_start: отсутствует → ошибка/предложение установить
required_extensions: [memory, todo, subagents]

# предлагается с описанием «зачем» — install/пропустить
recommended_extensions:
  - name: ponytail
    why: "лаконичный режим, меньше токенов"
  - name: pi-web-access
    why: "доступ в интернет"
  - name: billion-context-pi
    why: "сжатие контекста, длинные сессии"

workflow: [plan, do, verify, close]

# сколько рассуждений генерировать и показывать (мапится на Pi defaultThinkingLevel / hideThinkingBlock)
thinking: { level: low, hide: true }
```

**Разделение правды:**
- `role`/`purpose`/`recommended` — меняет пользователь.
- `base_behavior`/`workflow` — ядро модуля, обновляется версией пакета.
- Память (`MEMORY.md`/`USER.md`/`failures.md`) — накапливается агентом, как сейчас.
- **Стек/домен/проект в `base_behavior` не кладём** — это конвенции проекта: живут в его AGENTS.md и project-memory, а не в конфиге модуля.

### 3.1. `base_behavior` vs `/memory-pin` (STANDING.md)

Оба — «правила, которые всегда в контексте», но **разный владелец**:

| | `base_behavior` (agent.yaml) | `/memory-pin` → STANDING.md |
|---|---|---|
| Владелец | модуль (мы) | пользователь |
| Обновление | версией пакета | командой/редактором |
| Пример | «сборка без предупреждений», «минимальный diff» | «не запускай `find /`» |
| Назначение | гарантированное поведение из коробки | персональные правила поверх |

Не сливать: дефолты модуля и личные пины имеют разный источник и каденс обновления.

## 4. Онбординг-флоу (первый запуск)

1. `session_start` → `config.ts` проверяет наличие `agent.yaml`.
2. Нет конфига (или `incomplete: true`) → агент запускает скилл `bootstrap`:
   - читает базовый шаблон;
   - задаёт вопросы (`ask_user_question`): роль, назначение, язык, какие `recommended` ставить;
   - пишет `agent.yaml`.
3. `extension-check.ts` сверяет `required_extensions` с установленными пакетами → отчёт + `pi install` для недостающих.
4. `before_agent_start` инжектит `role` + `base_behavior` + `workflow` в системный промпт (переиспользуя механику `STANDING.md`).
5. Переконфигурация — `/onboard` в любой момент.

## 5. Workflow-скилл (вместо bigpowers)

Один скилл с вашим порядком из AGENTS.md:
- `plan` → задача из плана, трекинг статуса (на доску), тест-кейсы до кода;
- `do` → TDD-цикл, минимальный diff;
- `verify` → build `-warnaserror` + тесты + ручная проверка;
- `close` → статус в дашборд, актуализация docs/decisions, коммит.

Уроки «чему научились» раскладываются по месту, а не валятся в один файл:
- **универсальные** (Pi/инструменты) → обобщаются в `base_behavior`:
  - не доверяй вызову edit — проверяй, что запись реально легла;
  - диагностика IDE/LSP может устареть — авторитетны сборка и тесты.
- **проектные** (стек, домен, окружение) → в project-memory и AGENTS.md проекта:
  - `-warnaserror`, лишний `using` (IDE0005) — в AGENTS.md webapibase;
  - CRLF/LF, git push из WSL, запись в decisions.md — в project-memory (уже там).

### 5.1. Контекст: `billion-context-pi`

Есть два варианта пакета `ranxianglei`:
- **`billion-context-pi`** — лёгкий Pi-фасад: даёт модели инструмент `compress`, LLM сам решает когда/что сжимать. Рекомендуем его.
- **`billion-context`** — полный proxy (ACP-kernel), переписывает потоки API между агентом и моделью. Тяжелее, нужен только если нужен кросс-агентный слой.

Берём `billion-context-pi` как **recommended** (не required): он дополняет, а не конфликтует с памятью hermes — hermes держит память между сессиями, billion-context сжимает внутри одной длинной сессии. У Pi есть и нативная авто-компакция — billion-context-pi даёт проактивную, управляемую моделью вместо реактивной.

## 6. Дашборд (свой веб-UI, реальтайм)

Замена `pi-kanban` + `kanban-sync.mjs`:
- **Стек:** Hono/Express + better-sqlite3 + SSE (все уже есть в node_modules).
- **Хранилище:** SQLite (`~/.pi/agent/pi-mini-boss/kanban.db`), не JSON-файлы с carrier-session-хаком.
- **Реальтайм:** extension пишет в SQLite на `tool_call`/`agent_end` → SSE push в браузер.
- **Статусы:** свои (pending/in_progress/completed/deleted + блокировки/приоритеты) — больше, чем сейчас.
- **Правда:** план в git (`docs/iterations/*`), статусы в SQLite, синк — событием, а не скриптом.

## 7. Фазы и DoD

| Фаза | Содержание | DoD |
|---|---|---|
| **1. Форк** | склонировать `pi-hermes-memory`, переименовать в `pi-mini-boss`, tsc зелёный | `npm run check` чисто; тесты — см. 1.5 |
| **1.5. Кроссплатформенность** | починить Windows-фейлы: file-locking (EBUSY/EPERM) + POSIX-пути (`/tmp`); CI-матрица win/linux/mac | `npm test` зелёный на Windows/WSL/Linux/macOS |
| **2. Config + check** | `agent.yaml` + `config.ts` + `extension-check.ts` + скилл `bootstrap` | свежий агент: прочитал конфиг, проверил расширения, задал вопросы |
| **3. Workflow** | скилл `workflow` + references-уроки, выпилить bigpowers | задача ведётся по plan→do→verify→close |
| **4. Роли** | заменить rolebox: role/purpose из конфига в промпт | смена role в yaml меняет поведение |
| **5. Дашборд** | Hono+SQLite+SSE, заменить kanban-sync | реальтайм-доска без скриптов |
| **6. Дистрибуция** | npm-пакет, README, онбординг для чужих | `pi install` на чистой машине → сконфигурировался |

## 8. Решения этого этапа и открытые вопросы

**Решено:**
- Имя — `pi-mini-boss`.
- `pi-lens` — удалён (ложные ошибки в webapibase).
- `pi-web-access` — оставить (интернет).
- `billion-context-pi` — добавить как recommended (лёгкий Pi-фасад, не proxy).
- `base_behavior` vs `/memory-pin` — оставить ОБА (разный владелец, см. §3.1).

**Открыто (закрыть по ходу):**
- npm scope — `pi-mini-boss` или `@vaytekhovski/pi-mini-boss`?
- Дашборд: один сервер на все проекты или per-project?
- `pi-goal-x` свернуть в конфиг или оставить отдельным пакетом?
