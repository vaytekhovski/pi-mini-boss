/**
 * Applying an extension selection (onboarding or `/extensions`): the user config
 * records what is chosen, the settings file gets declarations added or dropped.
 */
import {
  DEFAULT_CONFIG_PATH,
  USER_CONFIG_PATH,
  loadAgentConfig,
  saveAgentConfig,
} from "./config.js";
import { deactivateExtensionNames, installExtensionNames } from "./extension-check.js";
import { catalogNames } from "./questions.js";

export interface SelectionResult {
  /** Catalogue names that are chosen now. */
  selected: string[];
  /** Sources declared in settings.json. */
  added: string[];
  /** Sources dropped from settings.json, which switches them off. */
  removed: string[];
}

/** Names chosen in the user config; the shipped defaults before onboarding. */
export function currentSelection(): string[] {
  const config = loadAgentConfig();
  return (config.recommended_extensions ?? [])
    .filter((ext) => ext.selected !== false)
    .map((ext) => ext.name);
}

/**
 * Record `selected` in the user config and reconcile settings.json: newly picked
 * extensions get declared, dropped ones lose their declaration. Names outside
 * the shipped catalogue are ignored, so nothing the module does not own is
 * touched. Onboarding state is left alone.
 */
export function applyExtensionSelection(selected: string[]): SelectionResult {
  const chosen = new Set(selected);
  const catalog = catalogNames();
  const selectedNames = catalog.filter((name) => chosen.has(name));
  const droppedNames = catalog.filter((name) => !chosen.has(name));

  const config = loadAgentConfig();
  const template = loadAgentConfig(DEFAULT_CONFIG_PATH);
  // Keep the shipped `why`/`group` text for the names that survived.
  config.recommended_extensions = (template.recommended_extensions ?? []).filter((ext) =>
    chosen.has(ext.name),
  );
  saveAgentConfig(config, USER_CONFIG_PATH);

  return {
    selected: selectedNames,
    added: installExtensionNames(selectedNames),
    removed: deactivateExtensionNames(droppedNames),
  };
}
