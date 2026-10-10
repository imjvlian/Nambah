/**
 * Aturan pelunasan merchant — bagian MURNI, tanpa I/O.
 *
 * File ini sengaja terpisah dari `merchant-payment.ts` karena modul itu
 * mengimpor `server-only` dan Supabase. Alokasi FIFO adalah inti bisnis
 * yang paling rawan salah: kalau urutan pembayarannya keliru, merchant
 * yang sudah melunasi tagihan lamanya masih ditagih — atau sebaliknya,
 * piutang yang sebenarnya belum dibayar ikut dianggap lunas.
 *
 * TIDAK ADA QUERY DALAM FILE INI. Kalau suatu saat butuh akses database
 * untuk keputusan, pindahkan ke `merchant-payment.ts` dan biarkan test
 * menguji bentuk finalnya di sana.
 */

/**
 * Satu piutang yang layak dilunasi.
 *
 * `receivable_due_at` boleh null: order merchant yang fulfillment-nya
 * belum pernah berjalan belum punya tenggat. order itu tetap PIUTANG dan
 * tetap harus bisa dibayar — hanya tidak bisa dikategorikan sebagai
 * "segera" atau "terlambat".
 */
export type PayableInvoice = {
  orderId: string;
  /** Harga katalog yang menjadi piutang Lacte. Bukan `service_fee_amount`. */
  finalPrice: number;
  /** Tenggat pelunasan. Null kalau fulfillment belum pernah mengisi. */
  receivableDueAt: string | null;
  /** Dipakai sebagai urutan FIFO saat tenggat tidak tersedia. */
  createdAt: string;
};

/** Hasil akhir satu order setelah alokasi. */
export type SettledInvoice = {
  orderId: string;
  /** Nominal yang benar-benar menutup order ini. */
  applied: number;
  /** True kalau pembayaran lebih besar dari sisa piutang order ini. */
  partial: boolean;
};

export type PaymentAllocation = {
  settled: SettledInvoice[];
  /** Total nominal yang benar-benar mengurangi piutang. */
  applied: number;
  /**
   * Sisa bayar (kelebihan bayar).
   *
   * Ini BUKAN pembulatan: merchant boleh transfer lebih besar dari piutang
   * yang sedang berjalan. Uangnya adalah kredit yang akan mengurangi piutang
   * berikutnya, dan `merchant_balances.balance` sengaja tidak punya
   * `check >= 0` supaya keadaan itu bisa tersimpan.
   *
   * Melemparnya sebagai error akan memaksa admin mencatat transfer
   * pecahan, padahal dokumen bukti yang benar-benar diterima sudah utuh.
   */
  credit: number;
  /** Order yang tidak tersentuh karena pembayaran habis lebih dulu. */
  remaining: PayableInvoice[];
};

/**
 * Normalisasi satu nominal uang.
 *
 * Pembulatan ke rupiah penuh bukan reluctantly: koma dua di UI admin akan
 * menghasilkan `1234.56`, dan kalau itu diteruskan ke `merchant_payments`
 * yang kolomnya `bigint`, PostgREST menolak dengan error yang tidak
 * menjelaskan apa pun yang salah.
 */
export function normalizeAmount(value: unknown): number {
  const parsed = Math.round(Number(value));

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Nominal pelunasan harus berupa angka bulat positif.");
  }

  return parsed;
}

/**
 * Urutkan piutang dari yang paling tua.
 *
 * Urutan PENUH dipakai, bukan hanya `receivable_due_at`. Order tanpa
 * tenggat punya `null` di kolom itu, dan pengurutan akan melemparnya ke
 * ujung daftar atau mendahului seluruh daftar, tergantung collation database -
 * hasil yang sama sekali tidak bisa diprediksi. `created_at` dipakai
 * sebagai penentu sehingga order tanpa tenggat tetap masuk antrean FIFO
 * di posisi yang benar: setelah order yang lebih tua.
 */
function sortByAge(invoices: PayableInvoice[]) {
  return [...invoices].sort((left, right) => {
    const leftDue = left.receivableDueAt
      ? Date.parse(left.receivableDueAt)
      : Number.NaN;
    const rightDue = right.receivableDueAt
      ? Date.parse(right.receivableDueAt)
      : Number.NaN;

    const leftValid = Number.isFinite(leftDue);
    const rightValid = Number.isFinite(rightDue);

    // Satu punya tenggat, satu tidak: yang bertenggat lebih dulu.
    if (leftValid !== rightValid) return leftValid ? -1 : 1;

    if (leftValid && rightValid && leftDue !== rightDue) {
      return leftDue - rightDue;
    }

    // Tenggat sama, atau keduanya tidak punya:ORDER lama lebih dulu.
    return Date.parse(left.createdAt) - Date.parse(right.createdAt);
  });
}

/**
 * Bagikan satu pembayaran ke piutang yang sedang berjalan.
 *
 * FIFO dipilih supaya admin tidak perlu memutuskan order mana yang dibayar
 * transfer tersebut. Urutan "lama dulu dilunasi dulu" adalah satu-satunya
 * aturan yang bisa ditebak merchant juga, dan itu penting: kalau alokasi
 * tidak bisa ditebak merchant, dia akan ragu-ragu transaksi.
 *
 * Nominal hanya sampai ke piutang yang ada. Sisanya dikembalikan sebagai
 * `credit`, bukan hilang dan bukan error.
 */
export function planPaymentAllocation(
  invoices: PayableInvoice[],
  amount: number,
): PaymentAllocation {
  const remaining = Math.round(amount);
  if (!Number.isFinite(remaining) || remaining <= 0) {
    throw new Error("Nominal pelunasan harus berupa angka bulat positif.");
  }

  // Order dengan piutang nol atau tidak valid diabaikan, bukan dihitung
  // sebagai "sudah lunas". Kalau `final_price`-nya rusak, menandainya
  // lunas akan menghapus piutang yang masih nyata tanpa jejak.
  const payable = sortByAge(
    invoices.filter((invoice) => {
      const price = Number(invoice.finalPrice);
      return Number.isFinite(price) && price > 0;
    }),
  );

  const settled: SettledInvoice[] = [];
  // Order yang TERPABAI sebagian, beserta sisa tagihannya yang masih harus
  // dibayar pada pembayaran berikutnya.
  const leftovers: PayableInvoice[] = [];
  const untouched: PayableInvoice[] = [];
  let budget = remaining;

  for (const invoice of payable) {
    if (budget <= 0) {
      untouched.push(invoice);
      continue;
    }

    const due = Number(invoice.finalPrice);
    const used = Math.min(due, budget);
    budget -= used;

    settled.push({ orderId: invoice.orderId, applied: used, partial: used < due });

    /*
     * Order parsial TETAP masuk `remaining`, hanya dengan sisa tagihannya.
     *
     * Kalau tidak, pembayaran berikutnya akan melompat ke order yang lebih
     * baru dan meninggalkan sisa tagihan order lama menggantung - merchant
     * ditagih untuk sesuatu yang sebenarnya sudah mereka bayar sebagian, dan
     * piutang Lacte tidak akan pernah ikut lunas.
     */
    if (used < due) {
      leftovers.push({ ...invoice, finalPrice: due - used });
    }
  }

  return {
    settled,
    applied: remaining - budget,
    credit: budget,
    remaining: [...leftovers, ...untouched],
  };
}