/**
 * Onboarding questions, built by the extension.
 *
 * The agent only passes a tiny preset name (`ask preset="extensions"`); building
 * the long option lists on the model side cost a slow generation between windows.
 */
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_CONFIG_PATH, PACKAGE_ROOT, loadAgentConfig } from "./config.js";
import { listInstalledPackages } from "./extension-check.js";

export interface AskOption {
  label: string | Record<string, string>;
  description?: string | Record<string, string>;
  selected?: boolean;
  installed?: boolean;
}

export interface AskQuestion {
  question: string | Record<string, string>;
  header?: string | Record<string, string>;
  multiSelect?: boolean;
  uiLanguage?: boolean;
  options: AskOption[];
}

/** Skills implemented in a `skills/<kind>/` directory; stubs carry `disable-model-invocation: true`. */
function listImplemented(kind: string): Array<{ slug: string; description: string }> {
  const dir = path.join(PACKAGE_ROOT, "skills", kind);
  if (!fs.existsSync(dir)) {
    return [];
  }
  const items: Array<{ slug: string; description: string }> = [];
  for (const slug of fs.readdirSync(dir)) {
    const file = path.join(dir, slug, "SKILL.md");
    if (!fs.existsSync(file)) {
      continue;
    }
    const text = fs.readFileSync(file, "utf8");
    if (/^disable-model-invocation:\s*true\s*$/m.test(text)) {
      continue;
    }
    const description = /^description:\s*"?([^"\n]+?)"?\s*$/m.exec(text)?.[1]?.trim() ?? slug;
    items.push({ slug, description });
  }
  return items.sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Window 1: the language question (switches the panel language live). */
export function languageQuestion(): AskQuestion {
  return {
    question: { ru: "Язык общения?", en: "Language?" },
    header: { ru: "Язык", en: "Language" },
    uiLanguage: true,
    options: [
      { label: "ru", description: { ru: "русский", en: "Russian" }, selected: true },
      { label: "en", description: { ru: "английский", en: "English" } },
    ],
  };
}

/** Window 2: role and purpose, taken from the implemented role/purpose skills. */
export function roleQuestions(): AskQuestion[] {
  const roles = listImplemented("roles");
  const purposes = listImplemented("purposes");
  const fallbackRole = [{ slug: "senior backend developer", description: "бэкенд, API, сервисы" }];
  const fallbackPurpose = [{ slug: "веб-приложение / SaaS", description: "продукт для пользователей" }];
  const toOptions = (items: Array<{ slug: string; description: string }>): AskOption[] =>
    items.map((item, index) => ({
      label: item.slug,
      description: item.description,
      ...(index === 0 ? { selected: true } : {}),
    }));
  return [
    { question: "Кто ты?", header: "Роль", options: toOptions(roles.length > 0 ? roles : fallbackRole) },
    {
      question: "Над чем ты работаешь?",
      header: "Назначение",
      options: toOptions(purposes.length > 0 ? purposes : fallbackPurpose),
    },
  ];
}

/** Window 3: the extension catalogue from the template, one tab per group. */
export function extensionQuestions(): AskQuestion[] {
  const extensions = loadAgentConfig(DEFAULT_CONFIG_PATH).recommended_extensions ?? [];
  const installed = listInstalledPackages();
  const isInstalled = (name: string): boolean =>
    installed.some((pkg) => pkg.toLowerCase().includes(name.toLowerCase()));

  if (extensions.length === 0) {
    return [
      {
        question: "Дополнительно",
        header: "Дополнительно",
        multiSelect: true,
        options: [{ label: "ponytail", description: "лаконичный режим", selected: true }],
      },
    ];
  }

  const groups: string[] = [];
  const byGroup = new Map<string, typeof extensions>();
  for (const ext of extensions) {
    const group = ext.group ?? "Дополнительно";
    if (!byGroup.has(group)) {
      byGroup.set(group, []);
      groups.push(group);
    }
    byGroup.get(group)!.push(ext);
  }

  return groups.map((group) => ({
    question: group,
    header: group,
    multiSelect: true,
    options: (byGroup.get(group) ?? []).map((ext) => ({
      label: ext.name,
      description: ext.why,
      ...(ext.selected === false ? {} : { selected: true }),
      ...(isInstalled(ext.name) ? { installed: true } : {}),
    })),
  }));
}

/** Catalogue extension names that are already installed (for the reconcile window). */
export function installedCatalogNames(): string[] {
  const extensions = loadAgentConfig(DEFAULT_CONFIG_PATH).recommended_extensions ?? [];
  const installed = listInstalledPackages();
  return extensions
    .filter((ext) => installed.some((pkg) => pkg.toLowerCase().includes(ext.name.toLowerCase())))
    .map((ext) => ext.name);
}
