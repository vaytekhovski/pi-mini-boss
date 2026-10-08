/**
 * pi-mini-boss agent config — read/write the configurable `agent.yaml`.
 *
 * The package ships a default template (`config/agent.yaml`); the user's resolved
 * config lives under the Pi agent dir. Onboarding is needed until the user config
 * exists and is marked `onboarded: true`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { AGENT_ROOT } from "../paths.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = path.resolve(MODULE_DIR, "..", "..");

/** Shipped default template. */
export const DEFAULT_CONFIG_PATH = path.join(PACKAGE_ROOT, "config", "agent.yaml");
/** User's resolved config. */
export const USER_CONFIG_PATH = path.join(AGENT_ROOT, "pi-mini-boss", "agent.yaml");

/** A recommended optional extension and why it is worth installing. */
export interface RecommendedExtension {
  name: string;
  why: string;
  /** Pre-selected in onboarding; false makes it an optional choice. */
  selected?: boolean;
}

/** The `role` block — the part a user is expected to change. */
export interface AgentRole {
  name: string;
  purpose: string;
  language: string;
  /** Optional model applied at session start, `provider/modelId`. */
  model?: string;
  /** Optional thinking level applied at session start. */
  thinking?: string;
  /** Optional active-tool allowlist applied at session start. */
  tools?: string[];
}

/** Thinking level and whether thinking blocks are hidden. */
export interface ThinkingConfig {
  level: string;
  hide: boolean;
}

/** The resolved pi-mini-boss agent configuration. */
export interface AgentConfig {
  role: AgentRole;
  base_behavior: string[];
  required_extensions: string[];
  recommended_extensions: RecommendedExtension[];
  workflow: string[];
  thinking: ThinkingConfig;
  /** Set to true once the user has completed onboarding. */
  onboarded?: boolean;
}

function parseConfig(filePath: string): AgentConfig {
  const raw = yaml.load(fs.readFileSync(filePath, "utf8"));
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`pi-mini-boss: config ${filePath} is not a YAML mapping`);
  }
  return raw as AgentConfig;
}

/** Read the user config when present, otherwise the shipped default template. */
export function loadAgentConfig(configPath: string = USER_CONFIG_PATH): AgentConfig {
  return fs.existsSync(configPath) ? parseConfig(configPath) : parseConfig(DEFAULT_CONFIG_PATH);
}

/** True when onboarding has not been completed yet. */
export function needsOnboarding(configPath: string = USER_CONFIG_PATH): boolean {
  if (!fs.existsSync(configPath)) {
    return true;
  }
  return parseConfig(configPath).onboarded !== true;
}

/** Persist a resolved config (creates the parent directory). */
export function saveAgentConfig(config: AgentConfig, configPath: string = USER_CONFIG_PATH): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, yaml.dump(config, { lineWidth: 100 }), "utf8");
}
