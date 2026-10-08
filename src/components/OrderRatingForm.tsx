"use client";

import { useEffect, useState } from "react";
import { MAX_COMMENT_LENGTH } from "@/lib/reviews";

type ReviewState = {
  eligible: boolean;
  reason: string;
  productLabel: string | null;
  review: { rating: number; comment: string | null; createdAt: string } | null;
};

const REASON_COPY: Record<string, string> = {
  "order-not-finished": "Ulasan bisa diberikan setelah transaksi selesai.",
  "order-not-found": "Order ini tidak ditemukan.",
  unauthorized: "Kamu tidak punya akses ke order ini.",
  "missing-order-access": "Buka halaman order dari link yang kamu terima untuk memberi ulasan.",
};

const RATING_LABELS = ["Buruk", "Kurang", "Cukup", "Bagus", "Sangat bagus"];

/**
 * Form rating untuk order yang sudah selesai. Rating hanya bisa dikirim ke
 * server bersama access token order, jadi komponen ini tidak pernah menentukan
 * sendiri apakah pengulas berhak.
 */
export default function OrderRatingForm({
  orderId,
  accessToken,
  isSuccess,
}: {
  orderId: string;
  accessToken: string | null;
  isSuccess: boolean;
}) {
  const [state, setState] = useState<ReviewState | null>(null);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!orderId || !accessToken) return;
    let active = true;

    void (async () => {
      try {
        const response = await fetch(
          `/api/orders/${encodeURIComponent(orderId)}/review?access_token=${encodeURIComponent(accessToken)}`,
          { cache: "no-store", credentials: "same-origin" },
        );
        if (!response.ok) return;
        const data = (await response.json()) as ReviewState;
        if (!active) return;
        setState(data);
        if (data.review) {
          setRating(data.review.rating);
          setComment(data.review.comment ?? "");
        }
      } catch {
        // Form tetap tampil; kesalahan jaringan tidak perlu diblokir.
      }
    })();

    return () => {
      active = false;
    };
  }, [orderId, accessToken]);

  if (!isSuccess) return null;

  if (state && !state.eligible && !state.review) {
    return (
      <div className="form-block order-rating order-rating-locked">
        <div className="form-label">
          <span className="step-number">★</span>
          <div>
            <strong>Beri ulasan</strong>
            <small>{REASON_COPY[state.reason] ?? "Ulasan belum bisa diberikan."}</small>
          </div>
        </div>
      </div>
    );
  }

  async function submit() {
    if (!accessToken || rating < 1 || busy) return;
    setBusy(true);
    setNotice("");
    setError("");

    try {
      const response = await fetch(
        `/api/orders/${encodeURIComponent(orderId)}/review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ rating, comment }),
        },
      );
      const data = (await response.json()) as {
        error?: string;
        review?: { rating: number; comment: string | null; createdAt: string };
      };

      if (!response.ok || !data.review) {
        setError(data.error ?? "Ulasan gagal disimpan.");
        return;
      }

      setState((current) =>
        current
          ? { ...current, eligible: true, review: data.review! }
          : current,
      );
      setNotice("Terima kasih, ulasanmu sudah tersimpan.");
    } catch {
      setError("Ulasan gagal disimpan. Coba lagi sebentar.");
    } finally {
      setBusy(false);
    }
  }

  const activeRating = hoverRating || rating;
  const submitted = Boolean(state?.review) && !notice;

  return (
    <div className="form-block order-rating">
      <div className="form-label">
        <span className="step-number">★</span>
        <div>
          <strong>{submitted ? "Ulasanmu" : "Beri ulasan"}</strong>
          <small>
            {submitted
              ? "Kamu bisa mengubah ulasan ini kapan saja."
              : `Bagaimana pengalaman kamu untuk ${state?.productLabel ?? "produk ini"}?`}
          </small>
        </div>
      </div>

      <div
        className="order-rating-stars"
        role="radiogroup"
        aria-label="Rating"
        onMouseLeave={() => setHoverRating(0)}
      >
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={rating === value}
            aria-label={`${value} bintang, ${RATING_LABELS[value - 1]}`}
            className={`order-rating-star ${activeRating >= value ? "active" : ""}`}
            onMouseEnter={() => setHoverRating(value)}
            onFocus={() => setHoverRating(value)}
            onBlur={() => setHoverRating(0)}
            onClick={() => setRating(value)}
          >
            ★
          </button>
        ))}
        <span className="order-rating-label">
          {activeRating > 0 ? RATING_LABELS[activeRating - 1] : "Pilih rating"}
        </span>
      </div>

      <label className="order-rating-comment">
        <span>Ulasan (opsional)</span>
        <textarea
          value={comment}
          maxLength={MAX_COMMENT_LENGTH}
          rows={3}
          placeholder="Ceritakan pengalaman top up kamu."
          onChange={(event) => setComment(event.target.value)}
        />
        <small>{comment.length}/{MAX_COMMENT_LENGTH}</small>
      </label>

      <button
        type="button"
        className="primary-button full"
        disabled={busy || rating < 1}
        onClick={() => void submit()}
      >
        {busy ? "Menyimpan..." : submitted ? "Perbarui ulasan" : "Kirim ulasan"}
      </button>

      {notice && <p className="inline-message">{notice}</p>}
      {error && <p className="inline-message warning" role="alert">{error}</p>}
    </div>
  );
}