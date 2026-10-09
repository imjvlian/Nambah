"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Formulir pendaftaran affiliate.
 *
 * Hanya untuk user login — endpoint akan menolak 401 kalau belum login, jadi
 * komponen ini lebih baik menampilkan itu sebelum form-nya.
 *
 * Commission rate tidak pernah di sini. Nilai itu keputusan admin saat
 * menyetujui, dan applicant tidak punya alasan untuk mengetahuinya lebih awal.
 */

type AffiliateRequestData = {
  alreadyAffiliate?: boolean;
  code?: string;
  status?: string;
  request?: {
    id: number;
    displayName: string;
    whatsapp: string;
    motivation: string;
    instagram: string;
    tiktok: string;
    youtube: string;
    otherUrl: string;
    status: "pending" | "approved" | "rejected";
    grantedCode: string | null;
    rejectionReason: string | null;
    createdAt: string;
  } | null;
  error?: string;
};

/**
 * Field link channel.
 *
 * `datalist` dipakai, bukan `<select>`: isinya tetap bebas — applicant bisa
 * menempelkan link dengan atau tanpa `https://`, dengan atau tanpa `www`.
 * Saran yang muncul adalah PREFIX (`instagram.com/`), jadi yang diketik hanya
 * username. Satu dropdown berisi daftar platform yang Anda kunci sekarang
 * akan menyaring affiliate yang channel-nya tidak Anda pikirkan saat ini.
 */
const LINK_FIELDS = [
  { key: "instagram", label: "Instagram", placeholder: "instagram.com/namachannel", suggestions: ["instagram.com/"] },
  { key: "tiktok", label: "TikTok", placeholder: "tiktok.com/@namachannel", suggestions: ["tiktok.com/@"] },
  { key: "youtube", label: "YouTube", placeholder: "youtube.com/@namachannel", suggestions: ["youtube.com/@", "youtube.com/c/"] },
  { key: "otherUrl", label: "Link lain", placeholder: "Facebook, Discord, Telegram, atau web kamu", suggestions: [] },
] as const;

type LinkKey = (typeof LINK_FIELDS)[number]["key"];

const STATUS_TEXT: Record<string, { label: string; tone: string; note: string }> = {
  pending: {
    label: "Menunggu ditinjau",
    tone: "wait",
    note: "Permintaan kamu sudah masuk antrean. Admin akan menghubungi lewat WhatsApp kalau perlu.",
  },
  approved: {
    label: "Disetujui",
    tone: "done",
    note: "Kode affiliate kamu sudah aktif. Bagikan link-nya untuk mulai mendapat komisi.",
  },
  rejected: {
    label: "Belum disetujui",
    tone: "bad",
    note: "Kamu bisa mengubah alasan dan mengajukan lagi.",
  },
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(date);
}

type LinkDraft = {
  instagram: string;
  tiktok: string;
  youtube: string;
  otherUrl: string;
};

/**
 * Empat field link channel.
 *
 * Dipakai dua kali — di form pengajuan pertama dan di form pengajuan ulang
 * setelah ditolak. Dipisah supaya `datalist`-nya tidak ditulis dua kali: dua
 * salinan pasti akan berbeda satu karakter saat ada yang menambahkan baris di
 * salah satunya, dan itu yang membuat form yang sama berperilaku tidak
 * konsisten.
 *
 * `datalist` dengan `id` eksplisit karena ID-nya harus unik di dokumen. Kalau
 * dua form pernah tampil bersamaan, `list="…"` yang sama akan menunjuk ke
 * datalist yang salah.
 */
function LinkFields({
  draft,
  onChange,
  uid,
}: {
  draft: LinkDraft;
  onChange: (next: LinkDraft) => void;
  uid: string;
}) {
  return (
    <fieldset className="affiliate-join-links">
      <legend>
        Link channel
        <em>isi minimal satu</em>
      </legend>
      {LINK_FIELDS.map((field) => {
        const listId = `${uid}-${field.key}`;
        return (
          <label key={field.key}>
            <span>{field.label}</span>
            <input
              list={field.suggestions.length ? listId : undefined}
              value={draft[field.key as LinkKey]}
              onChange={(event) => onChange({ ...draft, [field.key]: event.target.value })}
              placeholder={field.placeholder}
              inputMode="url"
            />
            {field.suggestions.length ? (
              <datalist id={listId}>
                {field.suggestions.map((suggestion) => (
                  <option key={suggestion} value={suggestion} />
                ))}
              </datalist>
            ) : null}
          </label>
        );
      })}
    </fieldset>
  );
}

export default function AffiliateJoinPanel() {
  const [data, setData] = useState<AffiliateRequestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({
    displayName: "",
    whatsapp: "",
    motivation: "",
    instagram: "",
    tiktok: "",
    youtube: "",
    otherUrl: "",
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  // Minimal satu link harus terisi. Dicek di sini supaya affordance-nya jelas
  // SEBELUM ada request terkirim, dan supaya pesan errornya spesifik — bukan
  // "sesuatu tidak valid" dari server.
  const hasAnyLink = LINK_FIELDS.some(
    (field) => draft[field.key as LinkKey].trim().length > 0,
  );

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/account/affiliate-request", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (response.status === 401) {
        setData(null);
        return;
      }
      const payload = (await response.json()) as AffiliateRequestData;
      setData(payload);
      if (payload.error) setError(payload.error);
    } catch {
      setError("Pendaftaran tidak dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    setError("");

    if (!hasAnyLink) {
      setError("Isi minimal satu link channel kamu.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/account/affiliate-request", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const payload = (await response.json()) as AffiliateRequestData;
      if (!response.ok) {
        setError(payload.error ?? "Permintaan gagal dikirim.");
        return;
      }
      setNotice("Permintaan terkirim. Admin akan meninjaunya.");
      setDraft({
        displayName: "",
        whatsapp: "",
        motivation: "",
        instagram: "",
        tiktok: "",
        youtube: "",
        otherUrl: "",
      });
      await load();
    } catch {
      setError("Permintaan gagal dikirim.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="affiliate-join-loading">Memuat status pendaftaran...</div>;
  }

  if (!data) {
    return (
      <section className="affiliate-join-card">
        <div className="account-section-head">
          <div>
            <span className="eyebrow">Afiliasi</span>
            <h2>Jadi afiliasi Nambah.</h2>
          </div>
        </div>
        <div className="affiliate-join-body">
          <p>Login dulu untuk mendaftar menjadi afiliasi.</p>
          <a className="primary-button" href="/login?next=%2Faccount" data-link="login">
            Masuk ke akun <span>→</span>
          </a>
        </div>
      </section>
    );
  }

  if (data.alreadyAffiliate) {
    return (
      <section className="affiliate-join-card">
        <div className="account-section-head">
          <div>
            <span className="eyebrow">Afiliasi</span>
            <h2>Akun ini sudah jadi afiliasi.</h2>
          </div>
        </div>
        <div className="affiliate-join-body">
          <p>
            Kode kamu: <b>{data.code}</b>
          </p>
          <p className="affiliate-join-hint">
            Bagikan <code>/r/{data.code}</code> untuk mulai mendapat komisi.
          </p>
        </div>
      </section>
    );
  }

  const existing = data.request;
  const statusInfo = existing ? STATUS_TEXT[existing.status] : null;

  return (
    <section className="affiliate-join-card" id="jadi-affiliate">
      <div className="account-section-head">
        <div>
          <span className="eyebrow">Afiliasi</span>
          <h2>Jadi afiliasi Nambah.</h2>
        </div>
        {existing && (
          <span className={"affiliate-join-status tone-" + (statusInfo?.tone ?? "wait")}>
            {statusInfo?.label ?? existing.status}
          </span>
        )}
      </div>

      <div className="affiliate-join-body">
        {existing ? (
          <>
            <p>{statusInfo?.note}</p>
            <p className="affiliate-join-meta">
              Diajukan {formatDate(existing.createdAt)}
            </p>
            {existing.grantedCode && (
              <p className="affiliate-join-hint">
                Kode affiliate: <b>{existing.grantedCode}</b>
                <br />
                Bagikan <code>/r/{existing.grantedCode}</code> untuk mulai
                mendapat komisi.
              </p>
            )}
            {existing.status === "rejected" && existing.rejectionReason && (
              <p className="affiliate-join-reason">
                Alasan: {existing.rejectionReason}
              </p>
            )}
            {existing.status !== "pending" && (
              <form onSubmit={submit} className="affiliate-join-form">
                <label>
                  <span>Nama yang akan ditampilkan</span>
                  <input
                    value={draft.displayName}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, displayName: event.target.value }))
                    }
                    placeholder="Nama channel kamu"
                  />
                </label>
                <label>
                  <span>WhatsApp</span>
                  <input
                    inputMode="tel"
                    value={draft.whatsapp}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, whatsapp: event.target.value }))
                    }
                    placeholder="081234567890"
                  />
                </label>
                <label>
                  <span>Ceritakan channel kamu</span>
                  <textarea
                    rows={3}
                    value={draft.motivation}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, motivation: event.target.value }))
                    }
                    placeholder="Di mana kamu mengiklankan? Berapa perkiraan orang yang lihat?"
                  />
                </label>
                <LinkFields
                  draft={draft}
                  uid="ulang"
                  onChange={(links) => setDraft((current) => ({ ...current, ...links }))}
                />
                <button type="submit" disabled={busy}>
                  {busy ? "Mengirim..." : "Ajukan lagi"}
                </button>
              </form>
            )}
          </>
        ) : (
          <>
            <p>
              Daftar sebagai afiliasi, dapat komisi dari setiap order yang kamu
              arahkan ke Nambah. Rate komisinya ditentukan admin setelah
              pengajuan kamu ditinjau.
            </p>
            <form onSubmit={submit} className="affiliate-join-form">
              <label>
                <span>Nama yang akan ditampilkan</span>
                <input
                  value={draft.displayName}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, displayName: event.target.value }))
                  }
                  placeholder="Nama channel kamu"
                />
              </label>
              <label>
                <span>WhatsApp</span>
                <input
                  inputMode="tel"
                  value={draft.whatsapp}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, whatsapp: event.target.value }))
                  }
                  placeholder="081234567890"
                />
              </label>
              <label>
                <span>Ceritakan channel kamu</span>
                <textarea
                  rows={3}
                  value={draft.motivation}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, motivation: event.target.value }))
                  }
                  placeholder="Di mana kamu mengiklankan? Berapa perkiraan orang yang lihat?"
                />
              </label>
              <LinkFields
                draft={draft}
                uid="baru"
                onChange={(links) => setDraft((current) => ({ ...current, ...links }))}
              />
              <button type="submit" disabled={busy || !hasAnyLink}>
                {busy ? "Mengirim..." : "Ajukan jadi afiliasi"}
              </button>
            </form>
          </>
        )}

        {notice && <p className="affiliate-join-notice">{notice}</p>}
        {error && <p className="affiliate-join-error">{error}</p>}
      </div>
    </section>
  );
}
