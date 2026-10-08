---
name: role-author
description: "Создавать и дополнять роли pi-mini-boss."
description_en: "Create and extend pi-mini-boss roles."
---

# Автор ролей pi-mini-boss

Роль pi-mini-boss — это **профессиональный профиль**: как агент думает, на что смотрит и что делает в этой специальности. Хранится как скилл `skills/roles/<slug>/SKILL.md`.

## Процесс

1. Уточни у пользователя одним вызовом `ask`: специальность; ключевые задачи; что критично проверять; нужны ли особые `model`/`thinking`/`tools`.
2. Создай `skills/roles/<slug>/SKILL.md` по структуре ниже (slug латиницей, `name: role-<slug>`). У заглушки есть строка `disable-model-invocation: true` — убери её, иначе роль останется скрытой.
3. Регистрировать ничего не нужно: онбординг сам находит все роли из `skills/roles/*/SKILL.md` без этой строки. Заполни `description` (русский) и `description_en` (английский) — оба показываются в окне выбора, второе нужно, когда язык — английский.
4. Подтверди коротко и покажи, как активировать: `agent.yaml` → `role.name` (+ опционально `role.model` / `role.thinking` / `role.tools`).

## Структура файла роли

```markdown
---
name: role-<slug>
description: "<Специальность> — <фокус>. Use when the active pi-mini-boss role is <специальность>."
description_en: "<Speciality> — <focus>. Use when the active pi-mini-boss role is <speciality>."
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
