/**
 * Aturan tampilan gambar banner dan pesan popup.
 *
 * MURNI: tidak ada DOM, tidak ada database, tidak ada environment. Semua
 * masuk lewat parameter. Itu yang membuat aturan ini bisa diuji, dan
 * aturan di bawah bukan hal yang terlihat benar saat salah.
 */

/**
 * Rasio gambar untuk CSS `aspect-ratio`.
 *
 * Mengembalikan `null` kalau dimensi tidak bisa dipercaya, dan pemanggil
 * harus diperlakukan sebagai "belum tahu" - bukan sebagai "selesai".
 *
 * Ada alasan kuat untuk menolak angka yang tidak masuk akal: angka yang
 * salah di sini tidak akan terlihat sebagai salah. Browser hanya akan
 * menampilkan gambar lebih pendek atau lebih tinggi, dan hasilnya tetap
 * "cukup bagus" sampai ada yang mengeluh dua minggu kemudian.
 *
 * Dimensi nol, negatif, NaN, atau tidak ada batas atas yang masuk akal
 * semuanya menghasilkan `null`. Angka yang sangat besar ditolak karena
 * tidak pernah terjadi pada gambar sungguhan, dan angka sebesar itu hanya
 * bisa berasal dari data yang rusak.
 */
export function imageAspectRatio(
  width: number | string | null | undefined,
  height: number | string | null | undefined,
): number | null {
  const w = Number(width);
  const h = Number(height);

  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  if (w <= 0 || h <= 0) return null;

  // Batas atas: gambar sungguhan tidak pernah juta piksel per sisi.
  if (w > 50_000 || h > 50_000) return null;

  return w / h;
}

/** Dimensi yang layak dipakai, atau `null` kalau tidak ada. */
export function usableDimensions(
  width: number | string | null | undefined,
  height: number | string | null | undefined,
): { width: number; height: number } | null {
  const w = Number(width);
  const h = Number(height);

  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  if (w <= 0 || h <= 0) return null;
  if (w > 50_000 || h > 50_000) return null;

  return { width: Math.round(w), height: Math.round(h) };
}

/**
 * URL untuk `<a href>`.
 *
 * Hanya `http` dan `https` yang diteruskan. Selain menjaga tampilan tetap
 * benar, ini yang mencegah `javascript:` masuk ke `href` - dan `href`
 * javascript adalah cara paling langsung untuk menjalankan kode di beranda
 * orang yang membuka promo.
 *
 * Mengembalikan string kosong kalau tidak aman, supaya pemanggil cukup
 * mengecek `if (href)` tanpa perlu memeriksa lagi.
 */
export function sanitizeExternalUrl(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";

  /*
   * Panjang dibatasi SEBELUM parsing. URL sepanjang ratusan kilobyte akan
   * membuat `new URL` bekerja lambat, dan inputsnya datang dari form.
   */
  if (raw.length > 300) return "";

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    // URL relatif seperti "/promo" tidak punya skema - ditolak di sini.
    return "";
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";

  return parsed.toString();
}

/** Pesan popup yang sudah dibersihkan, atau `null` kalau kosong. */
export function cleanPopupMessage(value: string | null | undefined, max = 500): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}