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

/** Runs a command; matches `pi.exec` closely enough for our one call. */
export type ExecFn = (command: string, args: string[]) => Promise<unknown>;

/**
 * Make Pi fetch the declared packages right away, so a restart only has to load
 * them. The running process is already Node, so we re-use its own entry point:
 * `pi` may be reachable from a shell where `node` is not, and then the CLI dies
 * with "exec: node: not found". Returns false when the update could not run.
 */
export async function syncDeclaredPackages(exec: ExecFn): Promise<boolean> {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    await exec(process.execPath, [entry, "update", "--extensions"]);
    return true;
  } catch {
    return false;
  }
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
