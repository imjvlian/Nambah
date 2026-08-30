export type ReferralProgram = {
  code: string;
  name: string;
  commissionRate: number;
  userBenefitType: "flat" | "percentage";
  userBenefitValue: number;
  minimumOrder: number;
  maxUserBenefit?: number;
  stackableWithPromotions: boolean;
  status: "active" | "inactive";
};

// Seed referral programs for the MVP only.
// Production referral codes will move to the database and affiliate dashboard.
export const referralPrograms: ReferralProgram[] = [
  {
    code: "TEMAN",
    name: "Referral Teman",
    commissionRate: 0.2,
    userBenefitType: "flat",
    userBenefitValue: 500,
    minimumOrder: 20000,
    stackableWithPromotions: true,
    status: "active",
  },
  {
    code: "CREATOR",
    name: "Referral Creator",
    commissionRate: 0.2,
    userBenefitType: "percentage",
    userBenefitValue: 3,
    minimumOrder: 25000,
    maxUserBenefit: 1500,
    stackableWithPromotions: true,
    status: "active",
  },
];

export function findReferral(code: string) {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return null;

  return (
    referralPrograms.find(
      (referral) => referral.code === normalized && referral.status === "active",
    ) ?? null
  );
}
