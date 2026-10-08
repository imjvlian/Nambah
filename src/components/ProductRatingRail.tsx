"use client";

import { useEffect, useState } from "react";

type GameRating = {
  average: number | null;
  total: number;
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
  topProducts: Array<{
    productId: string;
    label: string;
    average: number;
    total: number;
  }>;
  highlights: Array<{
    rating: number;
    comment: string;
    createdAt: string;
    productLabel: string;
  }>;
};

/**
 * Rating & ulasan untuk kolom kiri halaman produk (menggantikan card checkout
 * lama). Satu permintaan per game — bukan satu per nominal, karena satu game
 * punya ratusan nominal.
 *
 * Rating hanya berisi vote dari order yang statusnya `success`, jadi angka di
 * sini selalu berasal dari transaksi nyata.
 */
export default function ProductRatingRail({ gameId }: { gameId: string }) {
  const [data, setData] = useState<GameRating | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);

    void (async () => {
      try {
        const response = await fetch(`/api/games/${encodeURIComponent(gameId)}/reviews`, {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) return;
        const payload = (await response.json()) as GameRating;
        if (active) setData(payload);
      } catch {
        // Ulasan bersifat tambahan; kegagalan tidak merusak halaman produk.
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [gameId]);

  if (loading) {
    return (
      <div className="rating-rail-skeleton" aria-busy="true">
        <span>Memuat rating…</span>
      </div>
    );
  }

  const total = data?.total ?? 0;

  return (
    <div className="rating-rail">
      <div className="rating-rail-head">
        <span className="eyebrow">Rating</span>
        <h2>Rating &amp; ulasan</h2>
      </div>

      {total === 0 ? (
        <p className="rating-empty">
          Belum ada ulasan untuk produk ini. Ulasan ditulis sendiri oleh pembeli
          setelah transaksinya selesai.
        </p>
      ) : (
        <>
          <div className="rating-rail-score">
            <strong>{data?.average?.toFixed(1)}</strong>
            <div>
              <span className="rating-head-stars" aria-hidden="true">
                {[1, 2, 3, 4, 5].map((value) => (
                  <b key={value} className={(data?.average ?? 0) >= value - 0.5 ? "on" : ""}>
                    ★
                  </b>
                ))}
              </span>
              <small>{total} ulasan</small>
            </div>
          </div>

          <div className="rating-bars">
            {[5, 4, 3, 2, 1].map((star) => {
              const count = data?.distribution[String(star) as "1"] ?? 0;
              const percent = total > 0 ? Math.round((count / total) * 100) : 0;
              return (
                <div className="rating-bar" key={star}>
                  <span>{star}★</span>
                  <span className="rating-bar-track">
                    <span className="rating-bar-fill" style={{ width: `${percent}%` }} />
                  </span>
                  <small>{count}</small>
                </div>
              );
            })}
          </div>

          {data && data.highlights.length > 0 && (
            <ul className="rating-highlights">
              {data.highlights.map((item, index) => (
                <li key={`${item.createdAt}-${index}`}>
                  <span className="rating-highlight-stars" aria-label={`${item.rating} dari 5`}>
                    <b>{"★".repeat(item.rating)}</b>
                    <span>{"★".repeat(5 - item.rating)}</span>
                  </span>
                  <p>{item.comment}</p>
                  <small>{item.productLabel}</small>
                </li>
              ))}
            </ul>
          )}

          {data && data.topProducts.length > 0 && (
            <div className="rating-top">
              <h3>Nominal teratas</h3>
              <ul>
                {data.topProducts.map((item) => (
                  <li key={item.productId}>
                    <span>{item.label}</span>
                    <b>
                      {item.average.toFixed(1)} ★<small>{item.total}</small>
                    </b>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}