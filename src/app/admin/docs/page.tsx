"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { DOC_GROUPS, searchDocs } from "@/lib/admin-docs";
import { BRAND } from "@/lib/brand";
import "@/app/admin-control-center.css";

/**
 * Halaman dokumentasi dashboard admin.
 *
 * Sengaja halaman terpisah dari dashboard, bukan tab baru di dalam
 * `AdminDashboard`. Alasannya dua:
 *
 * 1. Kontennya panjang dan statis. Kalau ikut di dashboard, isinya masuk
 *    ke bundle yang diunduh setiap kali panel dibuka - padahal dokumentasi
 *    jarang dibaca di waktu yang sama dengan pekerjaan.
 *
 * 2. URL-nya bisa dibagikan. Kalau operator butuh Enzym-share jawabannya
 *    rekan kerja, cukup kirim `/admin/docs#merchants`, bukan bilang
 *    "klik Toko Ritel lalu tab Piutang".
 *
 * Halaman ini TIDAK melakukan fetch apa pun. Semua isinya sudah ada di
 * `@/lib/admin-docs` yang diimpor, jadi bisa dibuka tanpa menunggu dan
 * tetap berfungsi saat koneksi sedang lambat.
 */
export default function AdminDocsPage() {
  const [query, setQuery] = useState("");

  const normalized = query.trim();
  const results = useMemo(
    () => (normalized ? searchDocs(normalized) : null),
    [normalized],
  );

  return (
    <main className="acc-page-sub">
      <section className="acc-workspace">
        <header className="acc-topbar">
          <div className="acc-topbar-title">
            <small>Admin / Dokumentasi</small>
            <strong>Panduan Dashboard</strong>
          </div>
          <div className="acc-topbar-actions">
            <Link href="/admin">← Control Center</Link>
          </div>
        </header>

        <div className="acc-content">
          <section className="acc-hero">
            <div>
              <span className="acc-eyebrow">Panduan operator</span>
              <h1>Jelaskan dulu, jangan menebak angka.</h1>
              <p>
                Setiap halaman di bawah ditulis untuk menjawab satu
                pertanyaan: apa yang dikerjakan di sana, dan kesalahan apa
                yang paling sering terjadi di situ.
              </p>
            </div>
          </section>

          {/*
           * Pencarian.
           *
           * `type="search"` bukan `text`, supaya browser menampilkan tombol
           * hapus bawaan - dan `aria-label` wajib karena placeholder
           * hilang begitu diketik, dan tanpa label field ini jadi tidak
           * bernama untuk pembaca layar.
           */}
          <div className="acc-docs-search">
            <label className="acc-field">
              <span>Cari panduan</span>
              <input
                type="search"
                value={query}
                aria-label="Cari panduan"
                placeholder="mis. piutang, margin, IP whitelist, pelunasan"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            {normalized ? (
              <button type="button" onClick={() => setQuery("")}>
                Bersihkan
              </button>
            ) : null}
          </div>

          {results ? (
            <section className="acc-docs-results">
              <p className="acc-docs-count">
                {results.length === 0
                  ? `Tidak ada panduan yang cocok dengan "${normalized}".`
                  : `${results.length} panduan cocok dengan "${normalized}".`}
              </p>

              {results.map((hit) => (
                <a
                  key={`${hit.group}-${hit.title}`}
                  className="acc-docs-hit"
                  href={hit.section ? `/admin#${hit.section}` : "#"}
                  onClick={(event) => {
                    /*
                     * Tautan internal diproses manual: `href` tetap ditulis
                     * supaya bisa diklik tengah dan supaya tetap terlihat
                     * seperti tautan aslinya saat halamannya dibuka tanpa
                     * JavaScript.
                     */
                    if (!hit.section) return;
                    event.preventDefault();
                    window.location.href = `/admin?seksi=${hit.section}`;
                  }}
                >
                  <span className="acc-docs-hit-group">{hit.group}</span>
                  <strong>{hit.title}</strong>
                  <p>{hit.summary}</p>
                  <small>cocok di: {hit.matchedIn}</small>
                </a>
              ))}
            </section>
          ) : (
            <div className="acc-docs-body">
              {DOC_GROUPS.map((group) => (
                <section className="acc-docs-group" key={group.group}>
                  <h2>{group.group}</h2>
                  <p className="acc-docs-intro">{group.intro}</p>

                  {group.entries.map((entry) => (
                    <article
                      className="acc-docs-entry"
                      key={entry.title}
                      id={entry.section}
                    >
                      <h3>{entry.title}</h3>
                      <p>{entry.summary}</p>

                      {entry.steps?.length ? (
                        <>
                          <h4>Langkah</h4>
                          <ol>
                            {entry.steps.map((step) => (
                              <li key={step}>{step}</li>
                            ))}
                          </ol>
                        </>
                      ) : null}

                      {entry.notes?.length ? (
                        <>
                          <h4>Yang perlu diperhatikan</h4>
                          <div className="acc-docs-notes">
                            {entry.notes.map((note) => (
                              <div key={note.label}>
                                <strong>{note.label}</strong>
                                <p>{note.text}</p>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : null}

                      {entry.terms?.length ? (
                        <>
                          <h4>Istilah</h4>
                          <dl>
                            {entry.terms.map((term) => (
                              <div key={term.term}>
                                <dt>{term.term}</dt>
                                <dd>{term.text}</dd>
                              </div>
                            ))}
                          </dl>
                        </>
                      ) : null}
                    </article>
                  ))}
                </section>
              ))}
            </div>
          )}

          <footer className="acc-docs-foot">
            <p>
              Dokumentasi ini menjelaskan {BRAND.name} Control Center versi
              yang sedang kamu pakai. Kalau ada langkah yang tidak sesuai
              dengan yang kamu lihat di layar, laporkan - panduan yang
              sudah tidak akur lebih baik diperbarui daripada dipakai
              begitu saja.
            </p>
          </footer>
        </div>
      </section>
    </main>
  );
}