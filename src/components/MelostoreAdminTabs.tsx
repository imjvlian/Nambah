"use client";

import { useState } from "react";
import MelostoreCatalogBrowser from "@/components/MelostoreCatalogBrowser";
import MelostoreMappingPanel from "@/components/MelostoreMappingPanel";

/**
 * Dua sudut pandang satu supplier.
 *
 * Katalog Supplier menjawab "apa yang dijual Melostore" - dibaca dari
 * katalog supplier. Pemetaan Produk menjawab "produk internal saya
 * dihubungkan ke SKU mana" - dibaca dari katalog internal. Ditaruh
 * bersebelahan dengan tab, bukan dua halaman, karena keduanya dibuka
 * dalam satu alur kerja yang sama.
 */
export default function MelostoreAdminTabs() {
  const [tab, setTab] = useState<"katalog" | "pemetaan">("katalog");

  return (
    <main className="acc-page-sub">
      <section className="acc-workspace">
        <header className="acc-topbar">
          <div className="acc-topbar-title">
            <small>Admin / Katalog</small>
            <strong>Katalog Melostore</strong>
          </div>
        </header>

        <div className="acc-content">
          <section className="acc-hero acc-hero-standalone">
            <div>
              <span className="acc-eyebrow">Supplier kedua</span>
              <h1>Satu produk, dua pilihan supplier.</h1>
              <p>
                Scan katalog Melostore, tambahkan produk sebagai draft, lalu
                petakan ke produk internal. Order memilih supplier termurah
                yang saldonya cukup - produk tanpa pemetaan Melostore tetap
                memakai Digiflazz.
              </p>
            </div>
          </section>

          <div className="acc-segmented" role="group" aria-label="Tampilan Melostore">
            <button
              type="button"
              aria-pressed={tab === "katalog"}
              className={tab === "katalog" ? "active" : ""}
              onClick={() => setTab("katalog")}
            >
              Katalog Supplier
            </button>
            <button
              type="button"
              aria-pressed={tab === "pemetaan"}
              className={tab === "pemetaan" ? "active" : ""}
              onClick={() => setTab("pemetaan")}
            >
              Pemetaan Produk
            </button>
          </div>

          <div style={{ marginTop: 14 }}>
            {tab === "katalog" ? (
              <MelostoreCatalogBrowser />
            ) : (
              <MelostoreMappingPanel />
            )}
          </div>
        </div>
      </section>
    </main>
  );
}