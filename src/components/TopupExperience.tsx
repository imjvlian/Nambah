"use client";

import { FormEvent, useMemo, useState } from "react";
import { games, paymentMethods } from "@/lib/catalog";

export default function TopupExperience() {
  const [query, setQuery] = useState("");
  const [selectedGameId, setSelectedGameId] = useState(games[0].id);
  const [selectedPackageId, setSelectedPackageId] = useState(games[0].packages[3]?.id ?? games[0].packages[0].id);
  const [paymentId, setPaymentId] = useState(paymentMethods[0].id);
  const [userId, setUserId] = useState("");
  const [serverId, setServerId] = useState("");
  const [notice, setNotice] = useState("");

  const filteredGames = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return games;
    return games.filter((game) =>
      `${game.name} ${game.shortName}`.toLowerCase().includes(keyword),
    );
  }, [query]);

  const selectedGame = games.find((game) => game.id === selectedGameId) ?? games[0];
  const selectedPackage =
    selectedGame.packages.find((item) => item.id === selectedPackageId) ?? selectedGame.packages[0];

  function chooseGame(gameId: string) {
    const nextGame = games.find((game) => game.id === gameId) ?? games[0];
    setSelectedGameId(nextGame.id);
    setSelectedPackageId(nextGame.packages[0].id);
    setNotice("");
    requestAnimationFrame(() => {
      document.getElementById("topup")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId.trim()) {
      setNotice("Masukkan User ID terlebih dahulu.");
      return;
    }

    setNotice(
      `Preview siap: ${selectedGame.shortName} · ${selectedPackage.label}. Transaksi live akan aktif setelah supplier dan payment gateway terhubung.`,
    );
  }

  return (
    <>
      <section className="catalog-section" id="games">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Pilih produk</span>
            <h2>Mau nambah apa?</h2>
          </div>
          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              aria-label="Cari game"
              type="search"
              placeholder="Cari game atau voucher"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>

        <div className="game-grid">
          {filteredGames.map((game) => (
            <button className="game-card" key={game.id} type="button" onClick={() => chooseGame(game.id)}>
              <span className="game-mark" style={{ background: game.accent }}>
                {game.initials}
              </span>
              <span className="game-copy">
                <strong>{game.name}</strong>
                <small>{game.category === "game" ? "Top up instan" : "Voucher digital"}</small>
              </span>
              <span className="card-arrow" aria-hidden="true">↗</span>
            </button>
          ))}
        </div>

        {filteredGames.length === 0 && (
          <div className="empty-state">Belum ada produk yang cocok dengan pencarianmu.</div>
        )}
      </section>

      <section className="topup-section" id="topup">
        <div className="topup-intro">
          <span className="eyebrow">Checkout</span>
          <h2>Top up tanpa muter-muter.</h2>
          <p>
            Isi data akun, pilih nominal, lalu bayar. Harga live akan diambil langsung dari supplier saat integrasi backend diaktifkan.
          </p>
          <div className="trust-list">
            <span><b>01</b> Data jelas</span>
            <span><b>02</b> Harga transparan</span>
            <span><b>03</b> Status terlacak</span>
          </div>
        </div>

        <form className="order-card" onSubmit={submitOrder}>
          <div className="order-head">
            <div className="selected-product">
              <span className="selected-mark" style={{ background: selectedGame.accent }}>
                {selectedGame.initials}
              </span>
              <div>
                <small>Produk dipilih</small>
                <strong>{selectedGame.name}</strong>
              </div>
            </div>
            <span className="preview-badge">MVP Preview</span>
          </div>

          <div className="form-block">
            <div className="form-label">
              <span className="step-number">1</span>
              <div>
                <strong>Data akun</strong>
                <small>Pastikan ID yang dimasukkan benar.</small>
              </div>
            </div>
            <div className={selectedGame.requiresServer ? "input-grid two" : "input-grid"}>
              <label>
                <span>User ID</span>
                <input
                  inputMode="numeric"
                  placeholder="Masukkan User ID"
                  value={userId}
                  onChange={(event) => setUserId(event.target.value)}
                />
              </label>
              {selectedGame.requiresServer && (
                <label>
                  <span>Server / Zone ID</span>
                  <input
                    inputMode="numeric"
                    placeholder="Contoh: 1234"
                    value={serverId}
                    onChange={(event) => setServerId(event.target.value)}
                  />
                </label>
              )}
            </div>
          </div>

          <div className="form-block">
            <div className="form-label">
              <span className="step-number">2</span>
              <div>
                <strong>Pilih nominal</strong>
                <small>Harga supplier akan disinkronkan otomatis.</small>
              </div>
            </div>
            <div className="package-grid">
              {selectedGame.packages.map((item) => (
                <button
                  className={`package-option ${selectedPackageId === item.id ? "active" : ""}`}
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedPackageId(item.id)}
                >
                  <span>{item.label}</span>
                  {item.note && <small>{item.note}</small>}
                </button>
              ))}
            </div>
          </div>

          <div className="form-block">
            <div className="form-label">
              <span className="step-number">3</span>
              <div>
                <strong>Metode pembayaran</strong>
                <small>Pilih cara bayar yang paling nyaman.</small>
              </div>
            </div>
            <div className="payment-list">
              {paymentMethods.map((method) => (
                <label className={`payment-option ${paymentId === method.id ? "active" : ""}`} key={method.id}>
                  <input
                    checked={paymentId === method.id}
                    name="payment"
                    type="radio"
                    value={method.id}
                    onChange={() => setPaymentId(method.id)}
                  />
                  <span className="radio-dot" />
                  <span>
                    <strong>{method.name}</strong>
                    <small>{method.detail}</small>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="order-summary">
            <div>
              <small>Pesanan</small>
              <strong>{selectedPackage.label}</strong>
            </div>
            <div className="price-placeholder">
              <small>Total</small>
              <strong>Harga live</strong>
            </div>
          </div>

          <button className="primary-button full" type="submit">
            Lanjutkan pembayaran <span aria-hidden="true">→</span>
          </button>

          {notice && <p className="form-notice" role="status">{notice}</p>}
        </form>
      </section>
    </>
  );
}
