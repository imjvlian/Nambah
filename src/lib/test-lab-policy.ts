export type TestLabScenario =
  | "success"
  | "failed"
  | "pending-success"
  | "pending-failed";

export type TestLabScope = "next-order" | "next-n" | "until-changed";

const SCENARIOS = new Set<TestLabScenario>([
  "success",
  "failed",
  "pending-success",
  "pending-failed",
]);

const SCOPES = new Set<TestLabScope>([
  "next-order",
  "next-n",
  "until-changed",
]);

export function isTestLabScenario(value: unknown): value is TestLabScenario {
  return typeof value === "string" && SCENARIOS.has(value as TestLabScenario);
}

export function isTestLabScope(value: unknown): value is TestLabScope {
  return typeof value === "string" && SCOPES.has(value as TestLabScope);
}

export function normalizeTestLabRemainingUses(
  scope: TestLabScope,
  requested: unknown,
) {
  if (scope === "until-changed") return null;
  if (scope === "next-order") return 1;

  const parsed = Number(requested);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error("Jumlah order Test Lab harus antara 1 sampai 100.");
  }
  return parsed;
}
