/**
 * Onboarding questions, built by the extension.
 *
 * The agent only passes a tiny preset name (`ask preset="extensions"`); building
 * the long option lists on the model side cost a slow generation between windows.
 */
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_CONFIG_PATH, PACKAGE_ROOT, loadAgentConfig, needsOnboarding } from "./config.js";
import { listInstalledPackages } from "./extension-check.js";

export interface AskOption {
  label: string | Record<string, string>;
  description?: string | Record<string, string>;
  selected?: boolean;
  recommended?: boolean;
  installed?: boolean;
}

export interface AskQuestion {
  question: string | Record<string, string>;
  header?: string | Record<string, string>;
  note?: string | Record<string, string>;
  multiSelect?: boolean;
  uiLanguage?: boolean;
  options: AskOption[];
}

/** A description in both supported languages. */
export interface LocalizedText {
  ru: string;
  en: string;
  [language: string]: string;
}

/**
 * Skills implemented in a `skills/<kind>/` directory; stubs carry
 * `disable-model-invocation: true`. `description_en` is our own optional
 * frontmatter key — without it the Russian description is reused.
 */
function listImplemented(kind: string): Array<{ slug: string; description: LocalizedText }> {
  const dir = path.join(PACKAGE_ROOT, "skills", kind);
  if (!fs.existsSync(dir)) {
    return [];
  }
  const items: Array<{ slug: string; description: LocalizedText }> = [];
  for (const slug of fs.readdirSync(dir)) {
    const file = path.join(dir, slug, "SKILL.md");
    if (!fs.existsSync(file)) {
      continue;
    }
    const text = fs.readFileSync(file, "utf8");
    if (/^disable-model-invocation:\s*true\s*$/m.test(text)) {
      continue;
    }
    const read = (key: string): string | undefined =>
      new RegExp(`^${key}:\\s*"?([^"\\n]+?)"?\\s*$`, "m").exec(text)?.[1]?.trim();
    const ru = read("description") ?? slug;
    items.push({ slug, description: { ru, en: read("description_en") ?? ru } });
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
  const fallbackRole = [
    { slug: "senior backend developer", description: { ru: "бэкенд, API, сервисы", en: "backend, API, services" } },
  ];
  const fallbackPurpose = [
    { slug: "веб-приложение / SaaS", description: { ru: "продукт для пользователей", en: "a product for end users" } },
  ];
  const toOptions = (items: Array<{ slug: string; description: LocalizedText }>): AskOption[] =>
    items.map((item, index) => ({
      label: item.slug,
      description: item.description,
      ...(index === 0 ? { selected: true } : {}),
    }));
  return [
    {
      question: { ru: "Кто ты?", en: "Who are you?" },
      header: { ru: "Роль", en: "Role" },
      options: toOptions(roles.length > 0 ? roles : fallbackRole),
    },
    {
      question: { ru: "Над чем ты работаешь?", en: "What do you work on?" },
      header: { ru: "Назначение", en: "Purpose" },
      options: toOptions(purposes.length > 0 ? purposes : fallbackPurpose),
    },
  ];
}

/** Window 3: the extension catalogue from the template, one tab per group. */
export function extensionQuestions(): AskQuestion[] {
  const extensions = loadAgentConfig(DEFAULT_CONFIG_PATH).recommended_extensions ?? [];
  const installed = listInstalledPackages();
  // ★ is the shipped recommendation, the tick is the user's own choice. Before
  // onboarding the two are the same set.
  const recommendedNames = new Set(
    extensions.filter((ext) => ext.selected !== false).map((ext) => ext.name),
  );
  const chosen = needsOnboarding()
    ? recommendedNames
    : new Set(
        (loadAgentConfig().recommended_extensions ?? [])
          .filter((ext) => ext.selected !== false)
          .map((ext) => ext.name),
      );
  // Explain what this window is and what the glyphs mean, on every tab.
  const note = {
    ru: "Выбери, что должно быть установлено (снятое отключается). ★ — рекомендую, ✓ — уже установлено",
    en: "Pick what should be installed (unchecked ones get switched off). ★ — recommended, ✓ — already installed",
  };
  const isInstalled = (name: string): boolean =>
    installed.some((pkg) => pkg.toLowerCase().includes(name.toLowerCase()));

  if (extensions.length === 0) {
    return [
      {
        question: "Дополнительно",
        header: "Дополнительно",
        note,
        multiSelect: true,
        options: [{ label: "ponytail", description: "лаконичный режим", selected: true, recommended: true }],
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
    note,
    multiSelect: true,
    options: (byGroup.get(group) ?? []).map((ext) => ({
      label: ext.name,
      description: ext.why,
      ...(chosen.has(ext.name) ? { selected: true } : {}),
      ...(recommendedNames.has(ext.name) ? { recommended: true } : {}),
      ...(isInstalled(ext.name) ? { installed: true } : {}),
    })),
  }));
}

/** Names of every extension in the shipped catalogue. */
export function catalogNames(): string[] {
  return (loadAgentConfig(DEFAULT_CONFIG_PATH).recommended_extensions ?? []).map((ext) => ext.name);
}

/** Catalogue extension names that are already installed (for the reconcile window). */
export function installedCatalogNames(): string[] {
  const extensions = loadAgentConfig(DEFAULT_CONFIG_PATH).recommended_extensions ?? [];
  const installed = listInstalledPackages();
  return extensions
    .filter((ext) => installed.some((pkg) => pkg.toLowerCase().includes(ext.name.toLowerCase())))
    .map((ext) => ext.name);
}
