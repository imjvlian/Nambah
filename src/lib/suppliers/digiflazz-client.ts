import {
  DigiflazzApiError,
  getDigiflazzBalance,
  getDigiflazzPrepaidPriceList,
  isDigiflazzConfigured,
  runDigiflazzPrepaidTransaction,
  verifyDigiflazzWebhookSignature,
  type DigiflazzPriceItem,
  type DigiflazzTransactionData,
} from "@/lib/digiflazz/client";
import {
  SupplierError,
  normalizeSupplierStatus,
  toSupplierAmount,
  toSupplierStock,
  type SupplierClient,
  type SupplierQuote,
  type SupplierTransactionInput,
  type SupplierTransactionResult,
  type SupplierWebhookEvent,
} from "@/lib/suppliers/types";

/**
 * Adapter Digiflazz ke kontrak supplier bersama.
 *
 * KENAPA ADAPTER, BUKAN REWRITE
 *
 * `digiflazz/client.ts` sudah dipakai oleh flow test, webhook handler, dan
 * admin panel - semuanya sudah berjalan. Menulis ulang kliennya berarti
 * risiko pada jalur yang sedang produksi.
 *
 * Jadi file itu dibiarkan apa adanya. File ini hanya MENERJEMAHKAN bentuk
 * datanya: `buyer_sku_code` jadi `sku`, `Sukses` jadi `"success"`, dan
 * seterusnya. Semua keputusan bisnis tetap tinggal di satu tempat.
 *
 * Konsekuensinya: ada dua bentuk data yang hidup berdampingan - yang
 * Digiflazz-native dan yang sudah dinormalisasi. Itu disengaja, dan
 * batasnya jelas: kalau suatu field dipakai di luar adapter, versi
 * native-nya yang dipakai.
 */

const SUPPLIER_ID = "digiflazz";

/**
 * `unlimited_stock: true` berarti stok tidak membatasi, bukan stok tak
 * hingga.
 *
 * Memperlakukannya sebagai `null` (tidak diketahui) membuat selection
 * tetap mempertimbangkan SKU itu - dan itu benar, karena supplier memang
 * tidak membatasi. Yang perlu diwaspadai adalah kebalikannya: SKU dengan
 * `stock: 0` dan `unlimited_stock: true` benar-benar tidak bisa dibeli, dan
 * harus ditolak. Jadi `unlimited_stock` diperiksa lebih dulu.
 */
function readStock(item: DigiflazzPriceItem): number | null {
  if (item.unlimited_stock) return null;
  if (item.buyer_product_status === false) return 0;
  return toSupplierStock(item.stock);
}

function toQuote(item: DigiflazzPriceItem): SupplierQuote {
  return {
    supplierId: SUPPLIER_ID,
    sku: item.buyer_sku_code,
    cost: toSupplierAmount(item.price) ?? 0,
    stock: readStock(item),
  };
}

/**
 * Ubah status Digiflazz ke bentuk bersama.
 *
 * `status` Digiflazz bebas berupa string apa saja (`"Sukses"`, `"Pending"`,
 * `"Gagal"`, dan apa pun yang ditambahkan vendor nanti). Yang tidak
 * dikenali menjadi `pending`, bukan `failed` - lihat catatan panjang di
 * `normalizeSupplierStatus`.
 */
function toResult(data: DigiflazzTransactionData): SupplierTransactionResult {
  const status = normalizeSupplierStatus(data.status) ?? "pending";

  return {
    status,
    transactionId: data.ref_id || null,
    charged: toSupplierAmount(data.price) ?? 0,
    serialNumber: data.sn?.trim() || null,
    message: data.message || (status === "success" ? "Sukses" : ""),
    errorCode: data.rc || null,
  };
}

export class DigiflazzSupplierClient implements SupplierClient {
  readonly id = SUPPLIER_ID;
  readonly label = "Digiflazz";

  isConfigured(): boolean {
    return isDigiflazzConfigured();
  }

  /**
   * Katalog lengkap.
   *
   * Endpoint Digiflazz membalas seluruh katalog dalam satu permintaan -
   * berbeda dari Melostore yang perlu halaman berkursor. Karena itu
   * adapter ini tidak melakukan pagination sama sekali.
   */
  async fetchQuotes(): Promise<SupplierQuote[]> {
    try {
      const items = await getDigiflazzPrepaidPriceList();
      return items.map(toQuote);
    } catch (error) {
      if (error instanceof DigiflazzApiError) {
        throw new SupplierError(SUPPLIER_ID, error.message, {
          code: error.code,
          retryable: error.retryable,
        });
      }
      throw error;
    }
  }

  async fetchBalance(): Promise<number> {
    try {
      return await getDigiflazzBalance();
    } catch (error) {
      if (error instanceof DigiflazzApiError) {
        throw new SupplierError(SUPPLIER_ID, error.message, {
          code: error.code,
          retryable: error.retryable,
        });
      }
      throw error;
    }
  }

  async runTransaction(
    input: SupplierTransactionInput,
  ): Promise<SupplierTransactionResult> {
    try {
      const data = await runDigiflazzPrepaidTransaction({
        buyerSkuCode: input.sku,
        // Digiflazz punya satu kolom target. Kalau produknya butuh zona,
        // keduanya harus digabung di sini - dengan pemisah yang tidak
        // mungkin tertukar dengan bagian ID.
        customerNo: input.zone ? `${input.target}.${input.zone}` : input.target,
        refId: input.requestRef,
        maxPrice: input.maxPrice,
        testing: input.environment === "sandbox",
        useCallback: true,
      });
      return toResult(data);
    } catch (error) {
      if (error instanceof DigiflazzApiError) {
        throw new SupplierError(SUPPLIER_ID, error.message, {
          code: error.code,
          retryable: error.retryable,
        });
      }
      throw error;
    }
  }

  verifyWebhook(rawBody: string, signatureHeader: string | null): boolean {
    return verifyDigiflazzWebhookSignature(rawBody, signatureHeader);
  }

  parseWebhook(rawBody: string): SupplierWebhookEvent | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return null;
    }

    if (!parsed || typeof parsed !== "object") return null;
    const envelope = parsed as { data?: DigiflazzTransactionData };
    const data = envelope.data;
    if (!data || typeof data !== "object") return null;

    const status = normalizeSupplierStatus(data.status);
    if (!status) return null;

    const requestRef =
      typeof data.ref_id === "string" && data.ref_id.trim() ? data.ref_id.trim() : null;
    if (!requestRef) return null;

    return {
      requestRef,
      status,
      transactionId: data.ref_id || null,
      serialNumber: data.sn?.trim() || null,
      charged: toSupplierAmount(data.price),
      message: data.message || null,
      errorCode: data.rc || null,
      requiresAction: false,
      /*
       * Kunci dedup: `ref_id + status`.
       *
       * Tanpa ini, callback yang sama yang terkirim dua kali akan
       * diproses dua kali - dan kalau efeknya menyentuh saldo, saldo
       * bertambah dua kali.
       */
      eventKey: `${requestRef}:${status}`,
    };
  }
}