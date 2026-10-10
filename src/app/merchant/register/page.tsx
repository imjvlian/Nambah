"use client";

import { useState } from "react";
import "@/app/merchant-register.css";

/**
 * Halaman daftar toko ritel.
 *
 * PUBLIK, tanpa autentikasi - sama seperti halaman checkout. Yang dikirim ke
 * server hanya nama, alamat, dan kontak. Kode toko dan PIN kasir DIBALIK
 * sekali di halaman ini, karena inilah tempat pemilik toko pertama kali
 * perlu mencatatnya.
 *
 * Status awal SELALU `pending`. Admin yang mengaktifkan, dan sampai itu
 * terjadi toko ini tidak muncul di checkout dan tidak bisa memindai
 * pesanan.
 */

type RegistrationState =
  | { phase: "idle"; error: string; busy: boolean }
  | { phase: "done"; name: string; code: string; pin: string; message: string };

export default function MerchantRegisterPage() {
  return (
    <main className="merchant-register-page">
      <MerchantRegisterForm />
    </main>
  );
}

function MerchantRegisterForm() {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [contact, setContact] = useState("");
  const [state, setState] = useState<RegistrationState>({
    phase: "idle",
    error: "",
    busy: false,
  });

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ phase: "idle", error: "", busy: true });

    try {
      const response = await fetch("/api/merchants/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, address, contact }),
      });

      const data = (await response.json()) as {
        error?: string;
        name?: string;
        code?: string;
        pin?: string;
        message?: string;
      };

      if (!response.ok || !data.code || !data.pin) {
        setState({
          phase: "idle",
          error: data.error ?? "Pendaftaran gagal. Coba lagi sebentar.",
          busy: false,
        });
        return;
      }

      setState({
        phase: "done",
        name: data.name ?? name,
        code: data.code,
        pin: data.pin,
        message: data.message ?? "",
      });
    } catch {
      setState({
        phase: "idle",
        error: "Tidak bisa menghubungi server. Cek koneksi lalu coba lagi.",
        busy: false,
      });
    }
  }

  if (state.phase === "done") {
    return (
      <div className="merchant-register-card">
        <h1>Pendaftaran diterima</h1>
        <p className="merchant-register-lead">{state.message}</p>

        <div className="merchant-credentials">
          <div>
            <small>Toko</small>
            <strong>{state.name}</strong>
          </div>
          <div>
            <small>Kode toko</small>
            <strong className="merchant-credential-code">{state.code}</strong>
          </div>
          <div>
            <small>PIN kasir</small>
            <strong className="merchant-credential-pin">{state.pin}</strong>
          </div>
        </div>

        <p className="merchant-register-warning">
          Kode dan PIN ini ditampilkan satu kali dan tidak bisa diambil lagi.
          Catat sekarang. Kalau hilang, pemilik toko harus meminta admin
          menggantinya.
        </p>

        <p className="merchant-register-note">
          Toko belum bisa menerima pesanan. Admin akan meninjau pendaftaran,
          dan toko aktif setelah disetujui.
        </p>
      </div>
    );
  }

  return (
    <div className="merchant-register-card">
      <h1>Daftar toko ritel</h1>
      <p className="merchant-register-lead">
        Daftarkan toko Anda untuk menerima pembayaran top up langsung di
        tempat. Biaya layanan yang ditetapkan Lacte dibebankan ke pembeli dan
        menjadi pendapatan toko Anda.
      </p>

      <form onSubmit={submit}>
        <label className="merchant-register-field">
          <span>Nama toko</span>
          <input
            value={name}
            maxLength={120}
            required
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <label className="merchant-register-field">
          <span>Alamat toko</span>
          <input
            value={address}
            maxLength={240}
            required
            placeholder="Nama jalan, nomor, kelurahan, kota"
            onChange={(event) => setAddress(event.target.value)}
          />
        </label>

        <label className="merchant-register-field">
          <span>Nomor HP / WhatsApp (opsional)</span>
          <input
            value={contact}
            maxLength={24}
            placeholder="08xx"
            onChange={(event) => setContact(event.target.value)}
          />
        </label>

        {state.error ? (
          <p className="merchant-register-error" role="alert">
            {state.error}
          </p>
        ) : null}

        <button
          className="merchant-register-submit"
          type="submit"
          disabled={state.busy || !name.trim() || address.trim().length < 5}
        >
          {state.busy ? "Mengirim..." : "Daftar"}
        </button>
      </form>

      <p className="merchant-register-note">
        Pendaftaran tidak langsung mengaktifkan toko. Admin meninjau lebih
        dulu sebelum toko bisa menerima pesanan.
      </p>
    </div>
  );
}