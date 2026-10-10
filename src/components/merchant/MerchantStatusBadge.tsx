/**
 * Status toko untuk pemilik toko.
 *
 * Bahasa di sini untuk pemilik toko, bukan admin.
 * "Dibekukan" tanpa penjelasan akan membuat orang menebak-nebak apa yang
 * salah; makanya setiap status selalu punya satu kalimat yang menyebut
 * tindakan berikutnya.
 */
const STATUS: Record<
  string,
  { label: string; tone: "ok" | "wait" | "warn" | "off"; hint: string }
> = {
  active: {
    label: "Aktif",
    tone: "ok",
    hint: "Toko Anda menerima pesanan.",
  },
  pending: {
    label: "Menunggu persetujuan",
    tone: "wait",
    hint: "Pendaftaran sudah masuk. Toko bisa dipakai setelah disetujui admin.",
  },
  frozen: {
    label: "Dibekukan",
    tone: "warn",
    hint: "Ada piutang yang lewat tenggat. Lunasi dulu, lalu minta admin mengaktifkan kembali.",
  },
  inactive: {
    label: "Nonaktif",
    tone: "off",
    hint: "Toko tidak menerima pesanan. Hubungi admin bila ini tidak disengaja.",
  },
};

export function MerchantStatusBadge({ status }: { status: string }) {
  const entry = STATUS[status] ?? {
    label: status,
    tone: "off" as const,
    hint: "",
  };

  return (
    <div className={`merchant-status merchant-status-${entry.tone}`}>
      <strong>{entry.label}</strong>
      {entry.hint ? <span>{entry.hint}</span> : null}
    </div>
  );
}