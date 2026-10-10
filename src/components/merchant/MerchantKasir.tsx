"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import "@/app/merchant-kasir.css";

/**
 * Layar kasir.
 *
 * TIDAK punya form login. Sesi datang dari cookie yang dibuat di
 * `/merchant/login`; server sudah memastikan sesi masih valid sebelum merender
 * komponen ini.
 *
 * `merchantCode` diteruskan sebagai prop karena `/api/merchant/confirm` masih
 * menerima kode + PIN sebagai jalur cadangan untuk perangkat yang tidak
 * menjalankan sesi portal.
 */

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

type ScanPhase = "idle" | "found" | "running" | "done";

function formatIDR(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function MerchantKasir({
  merchantCode,
  merchantName,
  merchantStatus,
}: {
  merchantCode: string;
  merchantName: string;
  merchantStatus: string;
}) {
  const [phase, setPhase] = useState<ScanPhase>("idle");
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

  // Kamera dimatikan saat layar ditinggalkan. Stream yang tetap hidup membuat
  // ikon kamera menyala sepanjang waktu - dan di konter itu membocorkan bahwa
  // kasir meninggalkan meja.
  useEffect(() => stopCamera, [stopCamera]);

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
        body: JSON.stringify({ code: merchantCode, orderCode: value }),
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
        body: JSON.stringify({ code: merchantCode, orderCode: lookup.orderId }),
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

  return (
    <main className="kasir-page">
      <header className="kasir-bar">
        <Link className="kasir-back" href="/merchant" aria-label="Kembali">
          ←
        </Link>
        <div className="kasir-bar-identity">
          <strong>{merchantName}</strong>
          <small>{merchantCode}</small>
        </div>
        <button className="kasir-ghost" type="button" onClick={reset}>
          Ganti pesanan
        </button>
      </header>

      {merchantStatus !== "active" ? (
        <p className="kasir-blocked">
          Toko sedang {merchantStatus === "pending" ? "menunggu persetujuan admin" : "tidak aktif"}.
          Pemindaian dinonaktifkan.
        </p>
      ) : null}

      {phase === "done" ? (
        <div className="kasir-card kasir-done">
          <h1>Pesanan diterima</h1>
          <p className="kasir-done-lead">{doneMessage}</p>
          {lookup ? (
            <p className="kasir-done-detail">
              {lookup.gameName} {lookup.packageLabel} · {formatIDR(lookup.amount)}
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
            Pindai QR dari layar pelanggan, atau ketik kodenya. Cek dulu sebelum
            memproses - top up yang sudah terkirim tidak bisa dibatalkan.
          </p>

          <video
            className={`kasir-camera ${cameraOn ? "on" : ""}`}
            ref={cameraRef}
            muted
            playsInline
          />

          <div className="kasir-camera-actions">
            <button className="kasir-ghost" type="button" onClick={() => void toggleCamera()}>
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
                disabled={merchantStatus !== "active"}
              />
            </label>

            <button
              className="kasir-submit"
              type="submit"
              disabled={scanBusy || !orderCode.trim() || merchantStatus !== "active"}
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
                {lookup.canRun ? `Terima pembayaran ${formatIDR(lookup.amount)}` : "Tidak bisa diproses"}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </main>
  );
}