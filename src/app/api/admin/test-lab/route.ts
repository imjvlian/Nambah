import { authorizeAdminRequest } from "@/lib/admin-api";
import { auditAdminAction } from "@/lib/admin-audit";
import {
  configureDigiflazzTestLab,
  getDigiflazzTestLabState,
} from "@/lib/test-lab";
import {
  isTestLabScenario,
  isTestLabScope,
} from "@/lib/test-lab-policy";
import {
  TEST_LAB_DISABLED_MESSAGE,
  isTestLabEnabled,
} from "@/lib/test-lab-access";

export const runtime = "nodejs";

/**
 * Route ini mengubah perilaku fulfilment supplier - membuat order berikutnya
 * gagal atau menggantung dengan sengaja. Di build produksi itu tidak boleh
 * bisa dipanggil sama sekali, bukan sekadar disembunyikan dari UI: UI bisa
 * dibuka lewat fetch langsung, dan sidebar yang hilang tidak melindungi
 * endpoint dari request langsung.
 */
function refuseWhenDisabled() {
  if (isTestLabEnabled()) return null;

  return Response.json({ error: TEST_LAB_DISABLED_MESSAGE }, { status: 404 });
}

export async function GET(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  const refused = refuseWhenDisabled();
  if (refused) return refused;

  try {
    return Response.json({ testLab: await getDigiflazzTestLabState() });
  } catch (error) {
    console.error("Admin Test Lab GET failed", error);
    return Response.json(
      {
        error:
          "Laboratorium uji tidak dapat dimuat. Pastikan migration 019 sudah diterapkan.",
      },
      { status: 502 },
    );
  }
}

export async function PATCH(request: Request) {
  const auth = authorizeAdminRequest(request);
  if (!auth.ok) return auth.response;

  const refused = refuseWhenDisabled();
  if (refused) return refused;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const scenario = body.scenario;
    const scope = body.scope;

    if (!isTestLabScenario(scenario) || !isTestLabScope(scope)) {
      return Response.json(
        { error: "Skenario atau cakupan laboratorium uji tidak valid." },
        { status: 400 },
      );
    }

    const nextState = await configureDigiflazzTestLab({
      enabled: body.enabled === true,
      scenario,
      scope,
      remainingUses: body.remainingUses,
    });

    await auditAdminAction(request, {
      action: "test_lab.configure",
      targetType: "staging_test_lab",
      targetId: "digiflazz",
      metadata: {
        enabled: nextState.enabled,
        scenario: nextState.scenario,
        scope: nextState.scope,
        remainingUses: nextState.remainingUses,
      },
    });

    return Response.json({ testLab: nextState });
  } catch (error) {
    console.error("Admin Test Lab PATCH failed", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Test Lab gagal diperbarui." },
      { status: 400 },
    );
  }
}
