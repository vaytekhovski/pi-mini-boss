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

function readInstalledPackages(settingsPath: string): string[] {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as { packages?: unknown };
    return Array.isArray(raw.packages)
      ? raw.packages.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
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
