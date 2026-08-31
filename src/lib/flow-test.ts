export function isFlowTestMode() {
  const configured = process.env.NAMBAH_FLOW_TEST_MODE?.trim().toLowerCase();

  if (["true", "1", "yes", "on"].includes(configured ?? "")) return true;
  if (["false", "0", "no", "off"].includes(configured ?? "")) return false;

  // Local `next dev` should be frictionless. Production/deployments stay strict
  // unless flow-test mode is explicitly enabled in their server environment.
  return process.env.NODE_ENV !== "production";
}
