export type DigiflazzNormalizedStatus = "pending" | "success" | "failed" | "unknown";

export function normalizeDigiflazzStatus(value: string): DigiflazzNormalizedStatus {
  const normalized = value.trim().toLowerCase();
  if (normalized === "sukses" || normalized === "success") return "success";
  if (normalized === "gagal" || normalized === "failed") return "failed";
  if (normalized === "pending") return "pending";
  return "unknown";
}

export function isSupplierTerminalStatus(
  value: DigiflazzNormalizedStatus,
): value is "success" | "failed" {
  return value === "success" || value === "failed";
}
