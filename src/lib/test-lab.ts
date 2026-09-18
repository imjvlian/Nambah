import { isFlowTestMode } from "@/lib/flow-test";
import {
  isTestLabScenario,
  isTestLabScope,
  normalizeTestLabRemainingUses,
  type TestLabScenario,
  type TestLabScope,
} from "@/lib/test-lab-policy";
import {
  supabaseRpc,
  supabaseSelect,
  supabaseUpdate,
} from "@/lib/supabase/server";

type TestLabRow = {
  provider: string;
  enabled: boolean;
  scenario: TestLabScenario;
  scope: TestLabScope;
  remaining_uses: number | null;
  updated_at: string;
};

type TestLabConsumeResult = {
  enabled?: boolean;
  scenario?: unknown;
  scope?: unknown;
  remainingUses?: unknown;
  source?: unknown;
};

export type TestLabState = {
  provider: "digiflazz";
  enabled: boolean;
  scenario: TestLabScenario;
  scope: TestLabScope;
  remainingUses: number | null;
  updatedAt: string | null;
  safeToEnable: boolean;
  safetyReason: string;
};

export type TestLabAssignment = {
  scenario: TestLabScenario;
  source: "env" | "admin-next-order" | "admin-next-n" | "admin-until-changed";
};

function currentFulfillmentMode() {
  const configured = process.env.NAMBAH_FULFILLMENT_MODE?.trim().toLowerCase();
  return configured || (isFlowTestMode() ? "simulate" : "disabled");
}

function safety() {
  const flowTest = isFlowTestMode();
  const mode = currentFulfillmentMode();
  const safeToEnable = flowTest && mode === "digiflazz-test";
  return {
    safeToEnable,
    safetyReason: safeToEnable
      ? "Flow test aktif dan fulfillment terkunci ke digiflazz-test."
      : `Test Lab hanya dapat diaktifkan saat NAMBAH_FLOW_TEST_MODE=true dan NAMBAH_FULFILLMENT_MODE=digiflazz-test. Mode saat ini: ${mode}.`,
  };
}

export async function getDigiflazzTestLabState(): Promise<TestLabState> {
  const [row] = await supabaseSelect<TestLabRow>("staging_test_lab", {
    select: "provider,enabled,scenario,scope,remaining_uses,updated_at",
    filters: { provider: "eq.digiflazz" },
    limit: 1,
  });
  const guard = safety();

  return {
    provider: "digiflazz",
    enabled: Boolean(row?.enabled),
    scenario: row?.scenario ?? "success",
    scope: row?.scope ?? "next-order",
    remainingUses: row?.remaining_uses ?? 0,
    updatedAt: row?.updated_at ?? null,
    ...guard,
  };
}

export async function configureDigiflazzTestLab(input: {
  enabled: boolean;
  scenario: TestLabScenario;
  scope: TestLabScope;
  remainingUses?: unknown;
}) {
  if (!isTestLabScenario(input.scenario)) {
    throw new Error("Scenario Test Lab tidak valid.");
  }
  if (!isTestLabScope(input.scope)) {
    throw new Error("Scope Test Lab tidak valid.");
  }

  const guard = safety();
  if (input.enabled && !guard.safeToEnable) {
    throw new Error(guard.safetyReason);
  }

  const remainingUses = input.enabled
    ? normalizeTestLabRemainingUses(input.scope, input.remainingUses)
    : 0;

  await supabaseUpdate(
    "staging_test_lab",
    {
      enabled: input.enabled,
      scenario: input.scenario,
      scope: input.scope,
      remaining_uses: remainingUses,
      updated_at: new Date().toISOString(),
    },
    { filters: { provider: "eq.digiflazz" } },
  );

  return getDigiflazzTestLabState();
}

export async function consumeDigiflazzTestScenario(
  fallback: TestLabScenario,
): Promise<TestLabAssignment> {
  if (!isFlowTestMode() || currentFulfillmentMode() !== "digiflazz-test") {
    return { scenario: fallback, source: "env" };
  }

  try {
    const result = await supabaseRpc<TestLabConsumeResult>(
      "nambah_test_lab_consume",
      { p_provider: "digiflazz" },
    );

    if (!result?.enabled || !isTestLabScenario(result.scenario)) {
      return { scenario: fallback, source: "env" };
    }

    const source =
      result.source === "admin-next-order" ||
      result.source === "admin-next-n" ||
      result.source === "admin-until-changed"
        ? result.source
        : "env";

    return { scenario: result.scenario, source };
  } catch (error) {
    console.error("Test Lab scenario consume failed; using ENV fallback.", error);
    return { scenario: fallback, source: "env" };
  }
}
