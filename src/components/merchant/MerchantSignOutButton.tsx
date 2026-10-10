"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Keluar dari sesi toko.
 *
 * `router.refresh()` supaya `/merchant` langsung membaca ulang cookie dan
 * kembali ke form login.
 */
export function MerchantSignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      className="merchant-portal-signout"
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void fetch("/api/merchant/session", { method: "DELETE" }).finally(() => {
          router.refresh();
        });
      }}
    >
      Keluar
    </button>
  );
}