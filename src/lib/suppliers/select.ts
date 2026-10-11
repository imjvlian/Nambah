import type {
  SupplierBalance,
  SupplierId,
  SupplierQuote,
} from "@/lib/suppliers/types";

/**
 * Pemilihan supplier untuk satu order.
 *
 * MODUL MURNI - tanpa I/O, tanpa `process.env`, tanpa database. Semua
 * keputusan diambil dari argumen.
 *
 * KENAPA HARUS MURNI
 *
 * Aturan ini menentukan uang mana yang dipakai untuk membayar top up.
 * Salah pilih = order gagal setelah pembeli membayar. Test untuk aturan
 * seperti itu harus bisa menuliskan semua keadaan yang mungkin -
 * termasuk yang bizarre seperti saldo negatif atau harga nol - dan itu
 * mustahil kalau aturannya tersembunyi di dalam fungsi yang butuh database.
 *
 * Modul ini juga dipakai di dua tempat yang tidak boleh berbeda
 * jawaban: saat membuat order, dan saat menghitung ulang harga di
 * halaman checkout. Kalau kalkulasi harga dan kalkulasi pilihan memakai
 * aturan berbeda, pembeli melihat angka yang berbeda dari yang dibayar.
 */

export type SupplierChoice = {
  supplierId: SupplierId;
  sku: string;
  cost: number;
};

export type RejectionReason =
  | "no-quotes"
  | "out-of-stock"
  | "insufficient-balance"
  | "invalid-cost";

export type SupplierSelection =
  | { ok: true; choice: SupplierChoice }
  | { ok: false; reason: RejectionReason; detail: string };

/**
 * Saldo yang benar-benar bisa dibelanjakan.
 *
 * `reserved` dikurangi karena saldo itu sudah dipakai order lain yang
 * belum selesai. Tanpa pengurangan ini, selection bisa memilih supplier
 * yang saldonya sudah habis - order yang dipilih akan ditolak supplier
 * setelah pembeli membayar.
 *
 * Saldo negatif tidak mungkin di database (`check (balance >= 0)`), tapi
 * dari API supplier bisa terjadi kalau ada refund atau koreksi yang
 * belum terpropagasi. Di sini dijepit ke nol: saldo negatif berarti
 * "tidak ada yang bisa dibelanjakan", bukan berarti ada saldo.
 */
export function availableBalance(balance: SupplierBalance | undefined): number {
  if (!balance) return 0;
  const free = balance.balance - balance.reserved;
  return free > 0 ? free : 0;
}

/**
 * Nilai satu quote, sekaligus alasannya kalau tidak bisa dipakai.
 *
 * Urutan pemeriksaan penting. Harga diperiksa lebih dulu, karena harga
 * yang rusak adalah masalah data - sedangkan stok habis adalah kondisi
 * normal yang esperado.
 *
 * `stock` negatif diperlakukan sebagai "tidak diketahui", bukan habis.
 * Adapter tidak pernah mengirimnya (`toSupplierStock` mengubahnya jadi
 * `null`), jadi angka negatif di sini berarti ada yang constructing quote
 * manual - dan membatalkan produk karena itu akan lebih buruk daripada
 * mencoba.
 */
function nilaiQuote(quote: SupplierQuote): "usable" | "invalid-cost" | "out-of-stock" {
  if (!Number.isInteger(quote.cost) || quote.cost <= 0) {
    return "invalid-cost";
  }
  if (quote.stock === 0) {
    return "out-of-stock";
  }
  return "usable";
}

/**
 * Pilih supplier termurah yang saldonya cukup.
 *
 * ATURAN, berurutan:
 *
 * 1. Buang SKU yang `\"pasti tidak bisa\`" - harga tidak valid, atau
 *    stok yang benar-benar nol.
 * 2. Buang supplier yang saldo bebasnya di bawah harga.
 * 3. Dari yang tersisa, ambil harga terkecil.
 *
 * CARA MEMILIH YANG TERMINAH
 *
 * Harga termurah dipilih bukan demi nilai utility maksimum. Yang dipakai
 * adalah harga yang bisa dibaca manusia. Kalau termurah hanya dipilih
 * karena memotong daftar, operator yang memeriksa laporan tidak akan
 * pernah bisa mencocokkan angka di tabel dengan alasan di balik pilihan.
 *
 * Karena itu, pada harga yang sama ada supplier yang menang secara stabil:
 * urutan input, lalu id sebagai pemutus terakhir. Tanpa itu, dua request
 * dengan data identik bisa memilih supplier berbeda tergantung urutan
 * array - dan laporan jadi tidak bisa direproduksi.
 */
export function pilihSupplier(
  quotes: readonly SupplierQuote[],
  balances: readonly SupplierBalance[],
): SupplierSelection {
  const kandidat: SupplierQuote[] = [];
  let adaHargaInvalid = false;
  let adaStokHabis = false;

  for (const quote of quotes) {
    /*
     * Penolakan harus menyertakan SEBABnya, bukan cuma "tidak bisa
     * dipakai". predicate lama memakai satu predicate untuk
     * menolak dan predicate berbeda untuk mencari alasannya - dan dua
     * predicate itu tidak selalu sepakat. Harga pecahan ditolak karena
     * bukan bilangan bulat, tapi diklasifikasikan sebagai "stok habis",
     * karena pemeriksaan alasannya hanya menanyakan "apakah <= 0".
     *
     * Memberi alasan yang salah akan menyesatkan operator ke tempat
     * salah. Satu penilaian, satu jawaban.
     */
    switch (nilaiQuote(quote)) {
      case "invalid-cost":
        adaHargaInvalid = true;
        break;
      case "out-of-stock":
        adaStokHabis = true;
        break;
      case "usable":
        kandidat.push(quote);
    }
  }

  if (kandidat.length === 0) {
    if (quotes.length === 0) {
      return {
        ok: false,
        reason: "no-quotes",
        detail: "Tidak ada supplier yang menawarkan produk ini.",
      };
    }
    if (adaHargaInvalid && !adaStokHabis) {
      return {
        ok: false,
        reason: "invalid-cost",
        detail: "Harga modal dari supplier tidak valid.",
      };
    }
    return {
      ok: false,
      reason: "out-of-stock",
      detail: "Semua supplier untuk produk ini sedang kehabisan stok.",
    };
  }

  const saldoPerSupplier = new Map(
    balances.map((b) => [b.supplierId, availableBalance(b)] as const),
  );

  /*
   * saldo nol, bukan "take without checking".
   * saldo nol, bukan "take without checking".
   *
   * Dua alasan sekaligus. Pertama, entri saldo bisa belum pernah dibuat
   * untuk supplier yang baru ditambahkan - dan membiarkan order masuk
   * berarti menemukan masalahnya setelah uang diterima. Kedua, map
   * yang tidak punya key tidak boleh dianggap infinitely rich.
   */
  const layak = kandidat.filter((quote) => {
    const saldo = saldoPerSupplier.get(quote.supplierId) ?? 0;
    return saldo >= quote.cost;
  });

  if (layak.length === 0) {
    /*
     * sebabnya saldo - kalau tidak, penyebabnya shortage, bukan saldo,
     * sebabnya saldo - kalau tidak, penyebabnya shortage, bukan saldo,
     * dan pesannya akan salah.
     */
    const shortage = kandidat.some((q) => q.supplierId.length > 0);
    return {
      ok: false,
      reason: shortage ? "insufficient-balance" : "no-quotes",
      detail: shortage
        ? "Saldo supplier tidak cukup untuk menutup order ini."
        : "Tidak ada supplier yang menawarkan produk ini.",
    };
  }

  let terbaik = layak[0];
  for (const quote of layak.slice(1)) {
    if (quote.cost < terbaik.cost) {
      terbaik = quote;
      continue;
    }
    if (quote.cost > terbaik.cost) continue;

    // Harga sama: pakai yang sudah ada, kecuali ini menarik secara stabil.
    if (quote.supplierId < terbaik.supplierId) {
      terbaik = quote;
    }
  }

  return {
    ok: true,
    choice: {
      supplierId: terbaik.supplierId,
      sku: terbaik.sku,
      cost: terbaik.cost,
    },
  };
}

/**
 * supplier mana yang akan dipakai kalau SKU-nya cuma tersedia di situ.
 *
 * Dipakai admin saat memetakan SKU supplier ke produk Nambah: supaya
 * operator melihat jawaban yang sama dengan yang akan dipakai engine,
 * bukan tebakan.
 */
export function supplierForSku(
  quotes: readonly SupplierQuote[],
  sku: string,
): SupplierId | null {
  const cocok = quotes.find((quote) => quote.sku === sku);
  return cocok ? cocok.supplierId : null;
}