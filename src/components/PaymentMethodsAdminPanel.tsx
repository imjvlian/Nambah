"use client";

import { useCallback, useEffect, useState } from "react";
import { useConfirm } from "@/components/AdminConfirmDialog";

type PaymentMethod = {
  id: string;
  name: string;
  detail: string;
  customerFeeFlat: number;
  customerFeePercent: number;
  merchantFeeFlat: number;
  merchantFeePercent: number;
  active: boolean;
  sortOrder: number;
  updatedAt: string;
};

type PaymentMethodsPayload = {
  paymentMethods?: PaymentMethod[];
  error?: string;
};

type EditDraft = {
  id: string;
  customerFeeFlat: string;
  customerFeePercent: string;
};

export default function PaymentMethodsAdminPanel() {
  const [payload, setPayload] = useState<PaymentMethodsPayload | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const confirm = useConfirm();

  const canManage = true;

  async function load() {
    const [dataResponse, sessionResponse] = await Promise.all([
      fetch("/api/admin/payment-methods", { cache: "no-store" }),
      fetch("/api/admin/session", { cache: "no-store" }),
    ]);

    if (dataResponse.status === 401 || sessionResponse.status === 401) {
      window.location.replace("/login?next=%2Fadmin%2Fpayment-methods");
      return;
    }

    const data = (await dataResponse.json()) as PaymentMethodsPayload;
    if (!dataResponse.ok) {
      setNotice(data.error ?? "Daftar metode pembayaran gagal dimuat.");
      return;
    }

    setPayload(data);
  }

  useEffect(() => {
    void load().catch((error) =>
      setNotice(error instanceof Error ? error.message : "Gagal memuat data."),
    );
  }, []);

  async function updateMethod(id: string) {
    const draft = editDraft;
    if (!draft || draft.id !== id) return;

    const flat = Number(draft.customerFeeFlat);
    const pct = Number(draft.customerFeePercent);

    if (!Number.isFinite(flat) || flat < 0) {
      setNotice("Biaya flat harus berupa angka >= 0.");
      return;
    }
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      setNotice("Biaya persen harus berupa angka 0–100.");
      return;
    }

    // QRIS tidak boleh dikenakan biaya apapun (larangan surcharge BI).
    if (id === "qris" && (flat > 0 || pct > 0)) {
      setNotice("QRIS tidak boleh dikenakan biaya layanan (larangan surcharge BI).");
      return;
    }

    setBusy(id);
    setNotice("");
    try {
      const response = await fetch("/api/admin/payment-methods", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          customer_fee_flat: Math.round(flat),
          customer_fee_percent: Number(pct.toFixed(4)),
        }),
      });

      const body = (await response.json()) as { error?: string; paymentMethod?: PaymentMethod };
      if (!response.ok) {
        throw new Error(body.error ?? "Gagal menyimpan biaya layanan.");
      }

      setPayload((prev) => {
        if (!prev?.paymentMethods) return prev;
        return {
          ...prev,
          paymentMethods: prev.paymentMethods.map((m) =>
            m.id === id ? body.paymentMethod! : m,
          ),
        };
      });

      setEditDraft(null);
      const saved = body.paymentMethod;
      if (!saved) throw new Error("Respons server tidak menyertakan data yang disimpan.");
      setNotice(`Biaya layanan ${saved.name} disimpan.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Gagal menyimpan biaya layanan.");
    } finally {
      setBusy(null);
    }
  }

  function cancelEdit() {
    setEditDraft(null);
    setNotice("");
  }

  function startEdit(method: PaymentMethod) {
    setEditDraft({
      id: method.id,
      customerFeeFlat: String(method.customerFeeFlat),
      customerFeePercent: String(method.customerFeePercent),
    });
    setNotice("");
  }

  const isEditing = (id: string) => editDraft?.id === id;

  const moneyInputProps = (value: string, onChange: (v: string) => void) => ({
    value,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      const raw = event.target.value.replace(/[^0-9]/g, "");
      onChange(raw === "" ? "" : raw);
    },
  });

  return (
    <main className="acc-page-sub">
      <section className="acc-workspace">
        <header className="acc-topbar">
          <div className="acc-topbar-title">
            <small>Admin / Keuangan</small>
            <strong>Biaya Layanan per Metode</strong>
          </div>
          <div className="acc-topbar-actions">
            <a href="/admin">← Control Center</a>
          </div>
        </header>

        <div className="acc-content">
          <section className="acc-hero acc-hero-standalone">
            <div>
              <span className="acc-eyebrow">Pengaturan biaya layanan</span>
              <h1>Biaya layanan metode pembayaran</h1>
              <p>
                Atur biaya layanan yang ditampilkan ke pembeli di checkout
                untuk setiap metode pembayaran. Nilai dapat berupa nominal
                tetap (Rp) atau persen dari harga produk. Biaya ini
                ditambahkan ke total yang dibayar pembeli dan dikirim ke
                gateway pembayaran sebagai <code>gross_amount</code>.
              </p>
              <p className="acc-note">
                <strong>QRIS tidak dapat dikenakan biaya</strong> sesuai
                larangan surcharge per Peraturan Bank Indonesia.
              </p>
            </div>
          </section>

          {notice && (
            <div className="acc-global-notice acc-inline-notice" role="status">
              {notice}
            </div>
          )}

          {!payload ? (
            <div className="acc-empty">Memuat data…</div>
          ) : (
            <div className="acc-table-card">
              <div className="acc-receipts-head is-banner">
                <span>Metode</span>
                <span>Detail</span>
                <span>Biaya Flat (Rp)</span>
                <span>Biaya Persen (%)</span>
                <span>Aksi</span>
              </div>
              {(payload.paymentMethods ?? []).map((method) => {
                const editing = isEditing(method.id);
                return (
                  <div
                    className="acc-receipts-row is-banner"
                    key={method.id}
                  >
                    <div className="acc-method-cell">
                      <strong>{method.name}</strong>
                      <span className="acc-method-id">{method.id}</span>
                    </div>
                    <span className="acc-method-detail">{method.detail}</span>

                    {editing ? (
                      <>
                        <label className="acc-field acc-field-compact">
                          <input
                            {...moneyInputProps(
                              editDraft?.customerFeeFlat ?? "",
                              (v) =>
                                setEditDraft((d) =>
                                  d
                                    ? { ...d, customerFeeFlat: v }
                                    : null,
                                ),
                            )}
                            placeholder="0"
                          />
                        </label>
                        <label className="acc-field acc-field-compact">
                          <input
                            {...moneyInputProps(
                              editDraft?.customerFeePercent ?? "",
                              (v) =>
                                setEditDraft((d) =>
                                  d
                                    ? { ...d, customerFeePercent: v }
                                    : null,
                                ),
                            )}
                            placeholder="0"
                          />
                        </label>
                        <div className="acc-action-panel">
                          <button
                            type="button"
                            disabled={busy === method.id}
                            onClick={() => updateMethod(method.id)}
                          >
                            {busy === method.id ? "Menyimpan…" : "Simpan"}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                          >
                            Batal
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <span className="acc-fee-value">
                          {method.customerFeeFlat > 0
                            ? `Rp ${method.customerFeeFlat.toLocaleString("id-ID")}`
                            : "-"}
                        </span>
                        <span className="acc-fee-value">
                          {method.customerFeePercent > 0
                            ? `${method.customerFeePercent}%`
                            : "-"}
                        </span>
                        <div className="acc-action-panel">
                          <button
                            type="button"
                            onClick={() => startEdit(method)}
                          >
                            Ubah biaya
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
              {(payload.paymentMethods ?? []).length === 0 && (
                <div className="acc-empty">Belum ada metode pembayaran terdaftar.</div>
              )}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
