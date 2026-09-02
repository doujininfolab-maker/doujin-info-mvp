import {
  buildVisibilityPlan,
  executeVisibilityChange,
  getVisibilityOperation,
  type VisibilityAction,
  type VisibilityEntityType,
  type VisibilityTarget,
} from "../visibility/contentVisibilityAdmin";
import type { Platform } from "../types";
import { getApp } from "firebase-admin/app";

type Arguments = Record<string, string | boolean>;

function parseArguments(values: string[]): { positional: string[]; options: Arguments } {
  const positional: string[] = [];
  const options: Arguments = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) options[key] = true;
    else {
      options[key] = next;
      index += 1;
    }
  }
  return { positional, options };
}

function option(options: Arguments, name: string): string | undefined {
  const value = options[name];
  return typeof value === "string" ? value.trim() : undefined;
}

function requiredOption(options: Arguments, name: string): string {
  const value = option(options, name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function parsePlatform(options: Arguments): Platform {
  const value = requiredOption(options, "platform");
  if (value !== "dlsite" && value !== "fanza") {
    throw new Error("--platform must be dlsite or fanza");
  }
  return value;
}

function parseEntity(value: string | undefined): VisibilityEntityType {
  if (value !== "product" && value !== "seller") {
    throw new Error("entity must be product or seller");
  }
  return value;
}

function parseAction(value: string | undefined): VisibilityAction {
  if (value !== "hide" && value !== "restore") {
    throw new Error("action must be hide or restore");
  }
  return value;
}

function buildTarget(entityType: VisibilityEntityType, options: Arguments): VisibilityTarget {
  const platform = parsePlatform(options);
  return entityType === "product"
    ? { entityType, platform, productId: requiredOption(options, "product-id") }
    : { entityType, platform, sourceSellerId: requiredOption(options, "seller-id") };
}

function isEmulator(): boolean {
  return Boolean(process.env.FIRESTORE_EMULATOR_HOST);
}

function assertMutationSafety(options: Arguments): void {
  if (isEmulator()) return;
  const project = option(options, "project") || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  if (!project) throw new Error("--project is required outside the emulator");
  const actualProject = getApp().options.projectId;
  if (actualProject && actualProject !== project) {
    throw new Error(`Admin SDK project mismatch: expected ${project}, actual ${actualProject}`);
  }
  if (options["allow-production"] !== true) {
    throw new Error("--allow-production is required outside the emulator");
  }
  if (option(options, "confirm-production") !== `I_UNDERSTAND_${project}`) {
    throw new Error(`--confirm-production I_UNDERSTAND_${project} is required`);
  }
}

function json(value: unknown): void {
  console.log(JSON.stringify(value, (_key, current) => {
    if (current && typeof current === "object" && typeof current.toDate === "function") {
      return current.toDate().toISOString();
    }
    return current;
  }, 2));
}

function printUsage(): void {
  console.error([
    "Usage:",
    "  visibility preview <product|seller> --action <hide|restore> --platform <platform> --product-id <id>|--seller-id <id>",
    "  visibility <hide|restore> <product|seller> --platform <platform> --product-id <id>|--seller-id <id> --case-id <id> --confirm <planHash>",
    "  visibility status --operation-id <id>",
    "Options:",
    "  --performed-by <operator>  defaults to USER/USERNAME",
    "  --skip-rebuild             emulator only",
  ].join("\n"));
}

async function main(): Promise<void> {
  const { positional, options } = parseArguments(process.argv.slice(2));
  const command = positional[0];
  if (command === "status") {
    const result = await getVisibilityOperation(requiredOption(options, "operation-id"));
    if (!result) process.exitCode = 2;
    json(result);
    return;
  }

  if (command === "preview") {
    const entity = parseEntity(positional[1]);
    const action = parseAction(option(options, "action") ?? "hide");
    json(await buildVisibilityPlan(buildTarget(entity, options), action));
    return;
  }

  if (command === "hide" || command === "restore") {
    assertMutationSafety(options);
    const entity = parseEntity(positional[1]);
    const skipRebuild = options["skip-rebuild"] === true;
    if (skipRebuild && !isEmulator()) {
      throw new Error("--skip-rebuild is only allowed with FIRESTORE_EMULATOR_HOST");
    }
    json(await executeVisibilityChange({
      target: buildTarget(entity, options),
      action: command,
      confirmPlanHash: requiredOption(options, "confirm"),
      caseId: requiredOption(options, "case-id"),
      performedBy: option(options, "performed-by") || process.env.USERNAME || process.env.USER || "unknown",
      skipRebuild,
    }));
    return;
  }

  printUsage();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
