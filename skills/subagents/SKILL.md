---
name: subagents
description: Каталог субагентов pi-mini-boss — кого запускать на каждой стадии пайплайна (модель, thinking, промпт). Use when delegating pipeline steps to subagents via the subagent tool.
---

# Каталог субагентов

Ты (оркестратор) делегируешь стадии пайплайна субагентам через инструмент `subagent` из пакета `pi-subagents`. Каждому субагенту задаётся своя **модель** и **уровень мышления** (thinking). Полный промпт — в файле `skills/subagents/<name>.md` рядом с этим скиллом: прочитай нужный файл и передай его содержимое субагенту как задачу.

## Таблица

| Стадия | Субагент | Модель | Thinking | Роль |
|---|---|---|---|---|
| analysis | `analyst` | deepseek/deepseek-flash | low | разбор задачи, требования, контекст, риски |
| planning | `planner` | deepseek/deepseek-v4-pro | high | декомпозиция на шаги, критерии приёмки, тест-план |
| development | `implementer` | deepseek/deepseek-flash | minimal | пишет и правит код |
| review | `reviewer` | deepseek/deepseek-v4-pro | high | проверка логики, безопасности, соответствия решениям |
| testing | `tester` | deepseek/deepseek-flash | low | сборка/линт/тесты, крайние случаи, доказательства |
| report | `reporter` | deepseek/deepseek-flash | minimal | итоговый отчёт пользователю |

## Как запустить

1. Выбери субагента по стадии.
2. Прочитай `skills/subagents/<name>.md` — там модель, thinking и готовый промпт.
3. Запусти через `subagent` с переопределением модели: `model = <provider>/<modelId>` + суффикс thinking (`:minimal`/`:low`/`:high`), и передай промпт из файла как `task`.
4. Отметь запуск на дашборде: `boss subagent name=<name> status=running detail="<что делает>"`.
5. Когда субагент вернул результат — `boss subagent name=<name> status=done|error detail="<итог>"` и забери результат.

## Правила

- Не запускай субагента без задачи: читай его файл и собирай промпт по нему, а не на глаз.
- Тяжёлое рассуждение (планирование, ревью) — pro; сбор и исполнение — flash.
- Субагент работает в чистом контексте: всё нужное (пути, цель, ограничения, факты из уже прочитанных файлов) клади в промпт сам.
- Ты — единственный, кто пишет в файлы итогово: применяешь правки субагента-разработчика сам после ревью.
