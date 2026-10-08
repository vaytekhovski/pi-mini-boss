---
name: role-author
description: "Автор ролей pi-mini-boss: написать или обновить профессиональную роль-профиль (фокус, model/thinking/tools, критерии проверки) в skills/roles/<slug>/SKILL.md. Use when asked to create, improve, or fill in a pi-mini-boss role."
---

# Автор ролей pi-mini-boss

Роль pi-mini-boss — это **профессиональный профиль**: как агент думает, на что смотрит и что делает в этой специальности. Хранится как скилл `skills/roles/<slug>/SKILL.md`.

## Процесс

1. Уточни у пользователя одним вызовом `ask`: специальность; ключевые задачи; что критично проверять; нужны ли особые `model`/`thinking`/`tools`.
2. Создай `skills/roles/<slug>/SKILL.md` по структуре ниже (slug латиницей, `name: role-<slug>`).
3. Если роль должна появляться при настройке — добавь её в список ролей онбординга (`src/bootstrap/index.ts` → `buildOnboardPrompt`).
4. Подтверди коротко и покажи, как активировать: `agent.yaml` → `role.name` (+ опционально `role.model` / `role.thinking` / `role.tools`).

## Структура файла роли

```markdown
---
name: role-<slug>
description: "<Специальность> — <фокус>. Use when the active pi-mini-boss role is <специальность>."
---

# Роль: <специальность>

## Фокус

- ...

## Профиль роли

- `model`: provider/modelId (или «по умолчанию»)
- `thinking`: off|minimal|low|medium|high|xhigh|max
- `tools`: [список активных инструментов]

## Что проверять (обязательно)

- ...

## Типичный workflow

- ...

## Анти-паттерны

- ...
```

## Правила

- Фокус — только про эту роль; универсальные правила живут в `agent.yaml` → `base_behavior`.
- Конкретика стека и проекта — в `AGENTS.md` проекта, не здесь.
- `tools` — реальные имена tool'ов Pi; не выдумывай.
- Не плоди дубли: если профиль пересекается с существующей ролью — предложи дополнить её.
