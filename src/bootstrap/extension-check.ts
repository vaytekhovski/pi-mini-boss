/**
 * pi-mini-boss extension check — compares the config's required/recommended
 * extensions with the packages installed in the user's Pi settings.
 */
import fs from "node:fs";
import path from "node:path";
import { AGENT_ROOT } from "../paths.js";
import type { AgentConfig, RecommendedExtension } from "./config.js";

/** User-level Pi settings that list configured packages. */
export const SETTINGS_PATH = path.join(AGENT_ROOT, "settings.json");

/**
 * Parsed settings file. An empty object when there is no file yet (a fresh one
 * is ours to create); `undefined` when the file exists but cannot be read or
 * parsed — such a file must never be rewritten.
 */
function readSettings(settingsPath: string): Record<string, unknown> | undefined {
  let text: string;
  try {
    text = fs.readFileSync(settingsPath, "utf8");
  } catch {
    return {};
  }
  try {
    const raw = JSON.parse(text) as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Package sources declared in a parsed settings file. */
function packagesOf(settings: Record<string, unknown>): string[] {
  return Array.isArray(settings.packages)
    ? settings.packages.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function readInstalledPackages(settingsPath: string): string[] {
  return packagesOf(readSettings(settingsPath) ?? {});
}

/** Package sources from the user's Pi settings (for the onboarding markers). */
export function listInstalledPackages(settingsPath: string = SETTINGS_PATH): string[] {
  return readInstalledPackages(settingsPath);
}

/** Loose match: a short config name ("todo") against a package source ("npm:@juicesharp/rpiv-todo"). */
function isInstalled(installed: string[], name: string): boolean {
  const needle = name.toLowerCase();
  return installed.some((pkg) => pkg.toLowerCase().includes(needle));
}

/** Missing required/recommended extensions for the current config. */
export interface ExtensionCheck {
  missingRequired: string[];
  missingRecommended: RecommendedExtension[];
}

/** Report which configured extensions are not installed yet. */
export function checkExtensions(
  config: AgentConfig,
  settingsPath: string = SETTINGS_PATH,
): ExtensionCheck {
  const installed = readInstalledPackages(settingsPath);
  return {
    missingRequired: (config.required_extensions ?? []).filter((name) => !isInstalled(installed, name)),
    missingRecommended: (config.recommended_extensions ?? []).filter(
      (ext) => !isInstalled(installed, ext.name),
    ),
  };
}

/**
 * Declare every selected extension of the config in the user's settings file —
 * the same state `pi install npm:<name>` produces, without spawning a process.
 * Pi fetches declared packages when it starts, so the caller has to ask the user
 * for a restart. Returns the sources that were added.
 */
export function installSelectedExtensions(
  config: AgentConfig,
  settingsPath: string = SETTINGS_PATH,
): string[] {
  const selected = (config.recommended_extensions ?? []).filter((ext) => ext.selected !== false);
  if (selected.length === 0) {
    return [];
  }
  const settings = readSettings(settingsPath);
  if (!settings) {
    // Unreadable settings must never be replaced by a partial rewrite.
    return [];
  }
  const installed = packagesOf(settings);
  const added = selected
    .filter((ext) => !isInstalled(installed, ext.name))
    .map((ext) => `npm:${ext.name}`);
  if (added.length === 0) {
    return [];
  }
  settings.packages = [...installed, ...added];
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return added;
}
