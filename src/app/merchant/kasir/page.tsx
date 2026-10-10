"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toDataURL } from "qrcode";
import "@/app/merchant-kasir.css";

/**
 * Layar kasir.
 *
 * ALURNYA DUA TAHAP, dan itu bukan pilihan gaya:
 *
 *   1. LOOKUP  - cek kode, tampilkan pratinjau. Tidak mengubah apa pun.
 *   2. KONFIRMASI - baru jalankan top up.
 *
 * Memindai kode yang salah berarti menagih top up orang yang tidak ada di
 * depan kasir, dan sekali terkirim ke supplier tidak ada yang bisa
 * membatalkannya. Jadi kasir selalu sempathajinya memeriksa dulu: nama toko,
 * paket, nominal, dan ID akun tujuan.
 *
 * KODE BISA DATANG DUA CARA dari modal yang sama:
 *   - dipindai QR oleh kamera, ATAU
 *   - diketik manual (kasir atau pelanggan yang membacakan).
 *
 * Keduanya memanggil endpoint yang persis sama, jadi tidak mungkin jalurnya
 * berbeda - dan kasir yang kameranya rusak tetap bisa bekerja.
 */

type ScanPhase = "login" | "idle" | "found" | "running" | "done";

type LoginResult = {
  id: string;
  name: string;
};

type LookupResult = {
  canRun: boolean;
  orderId: string;
  merchantName: string;
  amount: number;
  serviceFee: number;
  packageLabel: string;
  gameName: string;
  targetUserId: string;
  status: string;
  blockedReason: string | null;
};

function formatIDR(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

export default function MerchantKasirPage() {
  const [phase, setPhase] = useState<ScanPhase>("login");
  const [merchant, setMerchant] = useState<LoginResult | null>(null);

  // Login
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState("");

  // Scan
  const [orderCode, setOrderCode] = useState("");
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanError, setScanError] = useState("");
  const [doneMessage, setDoneMessage] = useState("");

  const cameraRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState("");
  const [cameraOn, setCameraOn] = useState(false);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOn(false);
  }, []);

  // Kamera dimatikan saat layar ditinggalkan. Stream yang tetap hidup akan
  // membuat ikon kamera menyala sepanjang waktu - dan di konter, itu membocorkan
  // bahwa kasir meninggalkan meja.
  useEffect(() => stopCamera, [stopCamera]);

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginBusy(true);
    setLoginError("");

    try {
      const response = await fetch("/api/merchant/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, pin }),
      });
      const data = (await response.json()) as {
        error?: string;
        merchant?: { name?: string };
      };

      if (!response.ok || !data.merchant) {
        setLoginError(data.error ?? "Kode toko atau PIN salah.");
        return;
      }

      setMerchant({ id: data.merchant.name ?? "", name: data.merchant.name ?? "" });
      setPhase("idle");
    } catch {
      setLoginError("Tidak bisa menghubungi server.");
    } finally {
      setLoginBusy(false);
    }
  }

  function reset() {
    setOrderCode("");
    setLookup(null);
    setScanError("");
    setDoneMessage("");
    setPhase("idle");
  }

  async function runLookup(codeToCheck: string) {
    const value = codeToCheck.trim();
    if (!value) return;

    setScanBusy(true);
    setScanError("");
    setDoneMessage("");

    try {
      const response = await fetch("/api/merchant/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, pin, orderCode: value }),
      });
      const data = (await response.json()) as LookupResult & { error?: string };

      if (!response.ok || !data.orderId) {
        setLookup(null);
        setScanError(data.error ?? "Kode tidak ditemukan.");
        return;
      }

      setLookup(data);
      setPhase("found");
    } catch {
      setLookup(null);
      setScanError("Tidak bisa menghubungi server.");
    } finally {
      setScanBusy(false);
    }
  }

  async function confirmRun() {
    if (!lookup) return;

    setScanBusy(true);
    setScanError("");

    try {
      const response = await fetch("/api/merchant/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, pin, orderCode: lookup.orderId }),
      });
      const data = (await response.json()) as { error?: string; message?: string };

      if (!response.ok) {
        setScanError(data.error ?? "Pesanan gagal diproses.");
        return;
      }

      setDoneMessage(data.message ?? "Pesanan diterima.");
      setPhase("done");
      stopCamera();
    } catch {
      setScanError("Tidak bisa menghubungi server.");
    } finally {
      setScanBusy(false);
    }
  }

  async function toggleCamera() {
    if (cameraOn) {
      stopCamera();
      return;
    }

    setCameraError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (cameraRef.current) {
        cameraRef.current.srcObject = stream;
        await cameraRef.current.play();
      }
      setCameraOn(true);
      await attachScanner();
    } catch {
      setCameraError(
        "Kamera tidak bisa dibuka. Cek izin kamera, atau ketik kodenya manual.",
      );
    }
  }

  /*
   * Pembacaan QR lewat BarcodeDetector.
   *
   * API ini tidak ada di semua browser, jadi input manual selalu tersedia -
   * kasir tidak boleh terjebak kalau kameranya tidak didukung atau izinnya
   * ditolak.
   */
  async function attachScanner() {
    const Detector = (
      window as unknown as {
        BarcodeDetector?: new (options: { formats: string[] }) => {
          detect: (source: unknown) => Promise<Array<{ rawValue?: string }>>;
        };
      }
    ).BarcodeDetector;

    if (!Detector) {
      setCameraError("Browser ini tidak bisa membaca QR otomatis. Ketik kodenya manual.");
      return;
    }

    let detector: InstanceType<typeof Detector>;
    try {
      detector = new Detector({ formats: ["qr_code"] });
    } catch {
      setCameraError("Format QR tidak didukung browser ini. Ketik kodenya manual.");
      return;
    }

    const tick = async () => {
      const video = cameraRef.current;
      if (!video || !streamRef.current) return;

      try {
        const found = await detector.detect(video);
        const value = found[0]?.rawValue?.trim();
        if (value) {
          stopCamera();
          setOrderCode(value);
          await runLookup(value);
          return;
        }
      } catch {
        // Frame belum siap / terlalu gelap. Lanjut coba frame berikutnya -
        // berhenti di sini akan membuat kamera mati sendiri saat pertama gagal.
      }

      window.requestAnimationFrame(() => void tick());
    };

    window.requestAnimationFrame(() => void tick());
  }

  if (phase === "login") {
    return (
      <main className="kasir-page">
        <div className="kasir-login-card">
          <h1>Buka konter</h1>
          <p className="kasir-lead">
            Masukkan kode toko dan PIN kasir. Kode ada di kertas yang diberikan
            Lacte saat toko dibuat.
          </p>

          <form onSubmit={login}>
            <label className="kasir-field">
              <span>Kode toko</span>
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                autoComplete="username"
                autoCapitalize="characters"
                spellCheck={false}
                required
              />
            </label>

            <label className="kasir-field">
              <span>PIN kasir</span>
              <input
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(event) => setPin(event.target.value)}
                autoComplete="current-password"
                required
              />
            </label>

            {loginError ? (
              <p className="kasir-error" role="alert">
                {loginError}
              </p>
            ) : null}

            <button
              className="kasir-submit"
              type="submit"
              disabled={loginBusy || !code.trim() || !pin}
            >
              {loginBusy ? "Memeriksa..." : "Masuk"}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="kasir-page">
      <header className="kasir-bar">
        <div>
          <strong>{merchant?.name}</strong>
          <small>{code}</small>
        </div>
        <button className="kasir-ghost" type="button" onClick={reset}>
          Ganti pesanan
        </button>
      </header>

      {phase === "done" ? (
        <div className="kasir-card kasir-done">
          <h1>Pesanan diterima</h1>
          <p className="kasir-done-lead">{doneMessage}</p>
          {lookup ? (
            <p className="kasir-done-detail">
              {lookup.gameName} {lookup.packageLabel} ·{" "}
              {formatIDR(lookup.amount)}
            </p>
          ) : null}
          <button className="kasir-submit" type="button" onClick={reset}>
            Pesanan berikutnya
          </button>
        </div>
      ) : (
        <div className="kasir-card">
          <h2>Periksa pesanan</h2>
          <p className="kasir-hint">
            Pindai QR dari layar pelanggan, atau ketik kodenya. Cek dulu
            sebelum memproses - top up yang sudah terkirim tidak bisa dibatalkan.
          </p>

          <video
            className={`kasir-camera ${cameraOn ? "on" : ""}`}
            ref={cameraRef}
            muted
            playsInline
          />

          <div className="kasir-camera-actions">
            <button
              className="kasir-ghost"
              type="button"
              onClick={() => void toggleCamera()}
            >
              {cameraOn ? "Matikan kamera" : "Pindai dengan kamera"}
            </button>
          </div>

          {cameraError ? <p className="kasir-note">{cameraError}</p> : null}

          <form
            className="kasir-code-form"
            onSubmit={(event) => {
              event.preventDefault();
              void runLookup(orderCode);
            }}
          >
            <label className="kasir-field">
              <span>Kode pesanan</span>
              <input
                value={orderCode}
                onChange={(event) => setOrderCode(event.target.value.toUpperCase())}
                placeholder="MR7K2-X9Q"
                autoCapitalize="characters"
                spellCheck={false}
                inputMode="text"
              />
            </label>

            <button
              className="kasir-submit"
              type="submit"
              disabled={scanBusy || !orderCode.trim()}
            >
              {scanBusy ? "Mencari..." : "Periksa"}
            </button>
          </form>

          {scanError ? (
            <p className="kasir-error" role="alert">
              {scanError}
            </p>
          ) : null}

          {phase === "found" && lookup ? (
            <div className="kasir-preview">
              <div className="kasir-preview-row">
                <span>Toko</span>
                <strong>{lookup.merchantName}</strong>
              </div>
              <div className="kasir-preview-row">
                <span>Produk</span>
                <strong>
                  {lookup.gameName} {lookup.packageLabel}
                </strong>
              </div>
              <div className="kasir-preview-row">
                <span>Akun tujuan</span>
                <strong className="kasir-mono">{lookup.targetUserId}</strong>
              </div>
              <div className="kasir-preview-row">
                <span>Biaya layanan toko</span>
                <strong>{formatIDR(lookup.serviceFee)}</strong>
              </div>
              <div className="kasir-preview-row kasir-preview-total">
                <span>Yang dibayar pelanggan</span>
                <strong>{formatIDR(lookup.amount)}</strong>
              </div>

              {lookup.blockedReason ? (
                <p className="kasir-blocked">{lookup.blockedReason}</p>
              ) : null}

              <button
                className="kasir-submit kasir-confirm"
                type="button"
                disabled={scanBusy || !lookup.canRun}
                onClick={() => void confirmRun()}
              >
                {lookup.canRun
                  ? `Terima pembayaran ${formatIDR(lookup.amount)}`
                  : "Tidak bisa diproses"}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </main>
  );
}