"use client";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="id">
      <body>
        <main className="shell" style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: "20px", padding: "40px 20px" }}>
            <h1 className="display" style={{ fontSize: "clamp(40px, 8vw, 64px)" }}>Terjadi kesalahan</h1>
            <p style={{ color: "var(--muted)" }}>{BRAND.tagline}</p>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "12px" }}>
              <button onClick={() => reset()} className="header-cta">Coba lagi</button>
              <Link href="/" className="header-cta" style={{ background: "transparent", border: "1px solid var(--line)" }}>Kembali ke beranda</Link>
            </div>
            {error?.digest && <small style={{ color: "var(--muted)" }}>Error ID: {error.digest}</small>}
          </div>
        </main>
      </body>
    </html>
  );
}