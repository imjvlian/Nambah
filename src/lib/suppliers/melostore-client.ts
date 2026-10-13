import { createHmac, timingSafeEqual } from "node:crypto";
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
 * Klien Melostore H2H.
 *
 * BASE URL: https://api.melostore.id/api/v1/h2h
 *
 * BERBEDA DARI DIGIFLAZZ DI TIGA HAL
 *
 * 1. Autentikasi pakai dua header (`X-API-Key`, `X-Secret-Key`), bukan
 *    `sign=md5(...)` di body. Tidak ada tanda tangan pada request.
 * 2. Katalog besar dan ber halaman. Titik awal cursor dikembalikan lewat
 *    `meta.pagination.next_cursor`.
 * 3. Katalog TIDAK mengirim stok. `stock` selalu `null` di katalog ini -
 *    itu nilai yang benar, bukan data yang hilang.
 */

const BASE_URL = "https://api.melostore.id/api/v1/h2h";

/** Halaman maksimal per tarikan. Batas tier 100/menit, jadi 500 cukup aman. */
const PAGE_SIZE = 500;

/**
 * Batas keras jumlah halaman per tarikan.
 *
 * Rate limit katalog adalah 20 request/menit dan dibagi bersama endpoint
 * kategori. Tanpa batas ini, satu tarikan penuh bisa melebihi itu sendiri
 * dan memicu 429 di tengah jalan - dan setelah 429 terjadi, data yang
 * sudah terkumpul jadi tidak bisa disimpan, karena tidak ada tempat untuk
 * mengisinya sementara.
 */
const MAX_PAGES = 20;

const SUPPLIER_ID = "melostore";

export type MelostoreProfile = {
  balance: number;
  sandbox: boolean;
  webhookUrl: string | null;
  tierName: string | null;
};

type MelostoreEnvelope<T> = {
  success?: boolean;
  message?: string;
  error_code?: string;
  errors?: Record<string, string[]>;
  data?: T;
};

type MelostazzPriceItem = {
  sku_code: string;
  name: string;
  price: number | string;
  status?: string;
  category_name?: string;
  type_name?: string;
  brand_id?: number;
  server_code?: string;
  inquiry_form_key?: string | null;
};

type MelostoreTransaction = {
  id: string;
  buyer_trx_id: string;
  sku_code: string;
  status: string;
  price?: number | string;
  price_charged?: number | string;
  serial_number?: string;
  error_code?: string;
  message?: string;
  is_sandbox?: boolean;
};

type MelostoreWebhookPayload = {
  event?: string;
  event_id?: string;
  id?: string;
  buyer_trx_id?: string;
  status?: string;
  serial_number?: string;
  price_charged?: number | string;
  error_code?: string;
  message?: string;
  action?: { id?: string; version?: number } | null;
  need_action?: boolean;
};

function getConfig() {
  return {
    apiKey: process.env.MELOSTORE_API_KEY?.trim() ?? "",
    secretKey: process.env.MELOSTORE_SECRET_KEY?.trim() ?? "",
    webhookSecret: process.env.MELOSTORE_WEBHOOK_SECRET?.trim() ?? "",
  };
}

export function isMelostoreConfigured(): boolean {
  const { apiKey, secretKey } = getConfig();
  return Boolean(apiKey && secretKey);
}

function requireApiConfig() {
  const config = getConfig();
  if (!config.apiKey || !config.secretKey) {
    throw new SupplierError(
      SUPPLIER_ID,
      "Konfigurasi API Melostore belum lengkap.",
    );
  }
  return config;
}

/**
 * Ambil pesan galat dari amplop Melostore.
 *
 * Bentuknya berubah tergantung endpoint dan kesalahan: sebagian ada di
 * `message`, sebagian di `error_code`, sebagian di `errors` per-field.
 * Semuanya dibaca - pesan asli dari supplier sering kali satu-satunya
 * petunjuk kenapa order ditolak, dan mengembalikannya sebagai "gagal"
 * tanpa keterangan membuat masalah yang tidak bisa didiagnosis.
 */
function readErrorDetail(body: MelostoreEnvelope<unknown> | null) {
  const pick = (value: string | undefined) =>
    typeof value === "string" && value.trim() ? value.trim() : null;

  const fields =
    body?.errors && typeof body.errors === "object"
      ? Object.values(body.errors).flat().filter(Boolean)
      : [];

  return {
    message: pick(body?.message) ?? fields[0] ?? null,
    code: pick(body?.error_code),
  };
}

function isRetryableStatus(status: number) {
  return status === 429 || status >= 500;
}

/**
 * Retry denganbackoff untuk galat yang jelas sementara.
 *
 * Hanya untuk 429 dan 5xx. Melempar ulang apa adanya akan membuat satu
 * rate limit menjadi kegagalan beruntun: seluruh tarikan katalog gagal
 * hanya karena satu halaman yang kena 429.
 */
async function requestWithRetry<T>(
  path: string,
  init: RequestInit & { attempts?: number } = {},
): Promise<T> {
  const { attempts = 3, ...rest } = init;
  let terakhir: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return (await requestOnce<T>(path, rest)) as T;
    } catch (error) {
      terakhir = error;
      if (!(error instanceof SupplierError) || !error.retryable) throw error;
      // 300ms, 900ms, 2.7s
      await new Promise((r) => setTimeout(r, 300 * 3 ** attempt));
    }
  }
  throw terakhir;
}

async function requestOnce<T>(path: string, init: RequestInit): Promise<T> {
  const { apiKey, secretKey } = requireApiConfig();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
        "X-Secret-Key": secretKey,
        ...(init.headers ?? {}),
      },
      cache: "no-store",
      signal: controller.signal,
    });

    const raw = await response.text();
    let parsed: MelostoreEnvelope<T> | null = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      throw new SupplierError(
        SUPPLIER_ID,
        `Melostore mengembalikan response non-JSON (${response.status}).`,
        { retryable: response.status >= 500 },
      );
    }

    if (!response.ok) {
      const detail = readErrorDetail(parsed);
      const code = detail.code ? ` [${detail.code}]` : "";
      throw new SupplierError(
        SUPPLIER_ID,
        detail.message
          ? `Permintaan Melostore gagal${code}: ${detail.message}`
          : `Permintaan Melostore gagal (${response.status})${code}.`,
        { code: detail.code, retryable: isRetryableStatus(response.status) },
      );
    }

    /*
     * Amplop `success: false` dengan HTTP 200.
     *
     * Melostore mengirim ini untuk sebagian kondisi. Kalau hanya
     * diperiksa `response.ok`, galat ini akan lolos sebagai data kosong -
     * dan `data` yang `undefined` akan terbaca sebagai "supplier tidak
     * punya SKU", bukan "supplier menolak".
     */
    if (parsed && parsed.success === false) {
      const detail = readErrorDetail(parsed);
      throw new SupplierError(
        SUPPLIER_ID,
        detail.message ?? "Melostore menolak permintaan.",
        { code: detail.code, retryable: false },
      );
    }

    return parsed as unknown as T;
  } catch (error) {
    if (error instanceof SupplierError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new SupplierError(
        SUPPLIER_ID,
        "Permintaan ke Melostore timeout. Coba lagi beberapa saat lagi.",
        { retryable: true },
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ubah satu item katalog menjadi quote.
 *
 * `stock` SELALU `null`, apa pun isi respons.
 *
 * Endpoint `/pricelists` tidak mengirim kolom stok sama sekali - sudah
 * dicek langsung pada 6000 SKU. Melolokkan `null` ke `0` akan membuat
 * selection membuang seluruh katalog Melostore, dan gejalanya terlihat
 * seperti "stok habis" yang mustahil didiagnosis.
 */
function toQuote(item: MelostazzPriceItem): SupplierQuote {
  return {
    supplierId: SUPPLIER_ID,
    sku: item.sku_code,
    cost: toSupplierAmount(item.price) ?? 0,
    stock: toSupplierStock(undefined),
  };
}

export type MelostoreInquiryFormField = {
  /** Kunci yang dipakai di body transaksi (customer_target, dll). */
  key: string;
  /** Label yang dibaca manusia, mis. "Player ID". */
  name: string;
  type: string;
};

export type MelostoreInquiryForm = {
  fields: MelostoreInquiryFormField[];
  notice: string | null;
};

export type MelostoreScanOutcome = {
  items: MelostoreCatalogItem[];
  /**
   * Definisi form input pelanggan, kunci = inquiry_form_key.
   *
   * Satu form dipakai ratusan SKU - menyimpannya sekali di sini, bukan
   * per item, menghindari penggandaan payload ribuan kali.
   */
  forms: Record<string, MelostoreInquiryForm>;
  pagesTotal: number;
  pagesFailed: number;
  /** Pesan per halaman yang gagal, untuk dicatat ke jejak scan. */
  errors: string[];
};
export type MelostoreCatalogItem = {
  sku: string;
  name: string;
  price: number;
  status: string | null;
  categoryName: string | null;
  /** Nama brand asli dari meta.brands - bukan kategori. */
  brandName: string | null;
  /** Kunci form input pelanggan; definisinya ada di forms. */
  inquiryFormKey: string | null;
};
export class MelostoreSupplierClient implements SupplierClient {
  readonly id = SUPPLIER_ID;
  readonly label = "Melostore";

  isConfigured(): boolean {
    return isMelostoreConfigured();
  }

  /** Profil akun: saldo, mode sandbox, dan URL webhook. */
  async fetchProfile(): Promise<MelostoreProfile> {
    const body = await requestOnce<{
      data?: {
        h2h_balance?: number | string;
        is_sandbox_mode?: boolean;
        webhook_url?: string | null;
        tier?: { name?: string };
      };
    }>("/profile", { method: "GET" });

    const data = body.data ?? {};
    const balance = toSupplierAmount(data.h2h_balance);
    if (balance === null) {
      throw new SupplierError(
        SUPPLIER_ID,
        "Respons profil Melostore tidak memiliki saldo yang valid.",
      );
    }

    return {
      balance,
      sandbox: data.is_sandbox_mode === true,
      webhookUrl: data.webhook_url?.trim() || null,
      tierName: data.tier?.name?.trim() || null,
    };
  }

  async fetchBalance(): Promise<number> {
    return (await this.fetchProfile()).balance;
  }

  /**
   * Tarik seluruh katalog, halaman demi halaman.
   *
   * Berhenti di tiga kondisi: `has_more` false, cursor tidak maju, atau
   * batas halaman tercapai. Cursor yang tidak maju itu penting - kalau
   * server mengembalikan cursor yang sama, loop tanpa batas akan
   * menarik halaman yang sama selamanya dan menghabiskan rate limit.
   */
  /**
   * Tarik katalog untuk SCAN: halaman gagal dikumpulkan, bukan melempar.
   *
   * `fetchCatalog` melempar pada satu halaman gagal - perilaku yang benar
   * untuk transaksi, tapi salah untuk scan. Scan yang kehilangan dua
   * halaman dari empat puluh tetap menghasilkan ribuan SKU sah yang layak
   * disimpan; membuang semuanya berarti katalog tidak pernah tersinkron
   * selama supplier sedang bermasalah.
   *
   * Konsekuensi yang wajib dipegang pemanggil: hasil dengan
   * `pagesFailed > 0` adalah scan PARSIAL. SKU tidak boleh ditandai tidak
   * tersedia berdasarkan hasil parsial, karena yang hilang bisa jadi ada
   * di halaman yang gagal.
   */
  async scanCatalog(): Promise<MelostoreScanOutcome> {
    const perSku = new Map<string, MelostazzPriceItem>();
    /*
     * Identitas brand dan definisi form datang di meta respons, bukan di
     * item. Item hanya membawa brand_id dan inquiry_form_key - tanpa
     * peta ini, kolom brand cache akan berisi kategori (salah) dan
     * form tidak pernah diketahui.
     */
    const brandNameById = new Map<number, string>();
    const forms: Record<string, MelostoreInquiryForm> = {};
    let cursor: string | null = null;
    let pages = 0;
    let pagesFailed = 0;
    const errors: string[] = [];

    while (pages < MAX_PAGES) {
      const path: string =
        `/pricelists?limit=${PAGE_SIZE}` +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");

      let page: MelostazzPriceItem[] | undefined;
      let nextCursor: string | null = null;
      let hasMore = false;
      try {
        const body = await requestOnce<
          MelostoreEnvelope<MelostazzPriceItem[]> & {
            meta?: {
              pagination?: { next_cursor?: string | null; has_more?: boolean };
              brands?: Array<{ id?: number; name?: string }>;
              inquiry_forms?: Record<
                string,
                {
                  fields?: MelostoreInquiryFormField[];
                  notice?: string | null;
                }
              >;
            };
          }
        >(path, { method: "GET" });
        page = body.data;
        nextCursor = body.meta?.pagination?.next_cursor ?? null;
        hasMore = body.meta?.pagination?.has_more === true;

        for (const brand of body.meta?.brands ?? []) {
          if (
            typeof brand?.id === "number" &&
            typeof brand.name === "string" &&
            brand.name.trim()
          ) {
            brandNameById.set(brand.id, brand.name.trim());
          }
        }
        for (const [key, form] of Object.entries(body.meta?.inquiry_forms ?? {})) {
          if (form?.fields && form.fields.length > 0) {
            forms[key] = {
              fields: form.fields.map((f) => ({
                key: String(f?.key ?? ""),
                name: String(f?.name ?? ""),
                type: String(f?.type ?? "text"),
              })).filter((f) => f.key),
              /*
               * `notice` di dokumen contohnya string|null, tapi data
               * nyata bisa berupa bentuk lain (objek/array). Coerce hanya
               * untuk string - bentuk lain tidak boleh membuat seluruh
               * halaman scan gagal (terbukti: satu notice non-string
               * menggagalkan scan penuh sebelum perbaikan ini).
               */
              notice:
                typeof form.notice === "string" && form.notice.trim()
                  ? form.notice.trim()
                  : null,
            };
          }
        }
      } catch (error) {
        pagesFailed += 1;
        errors.push(
          `Halaman ${pages + 1}: ` +
            (error instanceof Error ? error.message : "galat tidak diketahui"),
        );
        /*
         * Halaman yang gagal tidak mengembalikan cursor berikutnya -
         * melanjutkan berarti mengulang permintaan yang sama. Berhenti di
         * sini: hasilnya PARSIAL, dan pemanggil wajib memperlakukannya
         * demikian.
         */
        break;
      }

      if (!Array.isArray(page)) {
        pagesFailed += 1;
        errors.push(`Halaman ${pages + 1}: respons tidak berisi daftar SKU.`);
        break;
      }

      for (const item of page) {
        if (typeof item?.sku_code !== "string" || !item.sku_code.trim()) continue;
        perSku.set(item.sku_code, item);
      }

      pages += 1;

      if (!hasMore || !nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
    }

    return {
      items: [...perSku.values()].map((item) => ({
        sku: item.sku_code,
        name: item.name ?? "",
        price: toSupplierAmount(item.price) ?? 0,
        status: item.status ?? null,
        categoryName: item.category_name ?? null,
        brandName:
          typeof item.brand_id === "number"
            ? brandNameById.get(item.brand_id) ?? null
            : null,
        inquiryFormKey: item.inquiry_form_key?.trim() || null,
      })),
      forms,
      pagesTotal: pages,
      pagesFailed,
      errors,
    };
  }

  /**
   * Katalog lengkap dengan nama produk.
   *
   * `fetchQuotes` tidak membawa nama - `SupplierQuote` sengaja tanpa
   * kolom nama karena selection tidak membutuhkannya. Pemetaan ke
   * produk Nambah justru BERBASIS nama, jadi di sinilah nama diambil.
   *
   * Dipakai panel pemetaan admin; selection tetap memakai `fetchQuotes`.
   */
  async fetchCatalog(): Promise<MelostoreCatalogItem[]> {
    const { items, brandNameById } = await this.fetchRawCatalog();
    return items.map((item) => ({
      sku: item.sku_code,
      name: item.name ?? "",
      price: toSupplierAmount(item.price) ?? 0,
      status: item.status ?? null,
      categoryName: item.category_name ?? null,
      brandName:
        typeof item.brand_id === "number"
          ? brandNameById.get(item.brand_id) ?? null
          : null,
      inquiryFormKey: item.inquiry_form_key?.trim() || null,
    }));
  }

  async fetchQuotes(): Promise<SupplierQuote[]> {
    const { items } = await this.fetchRawCatalog();
    return items.map(toQuote);
  }

  /*
   * Dedup di sini, di sumbernya.
   *
   * Katalog Melostore mengembalikan SKU yang sama di lebih dari satu
   * halaman. Upsert dengan kunci duplikat ditolak Postgres dengan
   * "ON CONFLICT DO UPDATE command cannot affect row a second time" -
   * dan gagalnya baru terlihat SETELAH seluruh 10.000 SKU tertarik,
   * jadi menyaringnya di pemanggil berarti setiap pemanggil harus
   * ingat melakukannya.
   *
   * Yang terakhir menang: entri paling akhir adalah yang paling segar,
   * dan urutan halaman dijamin maju - jadi ini bukan hasil acak
   * antara dua data yang berbeda.
   */
  private async fetchRawCatalog(): Promise<{
    items: MelostazzPriceItem[];
    brandNameById: Map<number, string>;
  }> {
    /*
     * Dedup di sumbernya: katalog Melostore mengembalikan SKU yang sama
     * di lebih dari satu halaman, dan upsert dengan kunci duplikat ditolak
     * Postgres. Yang terakhir menang - entri paling akhir paling segar, dan
     * urutan halaman dijamin maju.
     */
    const perSku = new Map<string, MelostazzPriceItem>();
    const brandNameById = new Map<number, string>();
    let cursor: string | null = null;
    let pages = 0;

    while (pages < MAX_PAGES) {
      const path: string =
        `/pricelists?limit=${PAGE_SIZE}` +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");

      const body: {
        data?: MelostazzPriceItem[];
        meta?: {
          pagination?: { next_cursor?: string | null; has_more?: boolean };
          brands?: Array<{ id?: number; name?: string }>;
        };
      } = await requestWithRetry<
        MelostoreEnvelope<MelostazzPriceItem[]> & {
          meta?: {
            pagination?: { next_cursor?: string | null; has_more?: boolean };
            brands?: Array<{ id?: number; name?: string }>;
          };
        }
      >(path, { method: "GET" });

      const page: MelostazzPriceItem[] | undefined = body.data;
      if (!Array.isArray(page)) {
        throw new SupplierError(
          SUPPLIER_ID,
          "Respons katalog Melostore tidak berisi daftar SKU.",
        );
      }

      for (const brand of body.meta?.brands ?? []) {
        if (
          typeof brand?.id === "number" &&
          typeof brand.name === "string" &&
          brand.name.trim()
        ) {
          brandNameById.set(brand.id, brand.name.trim());
        }
      }

      for (const item of page) {
        if (typeof item?.sku_code !== "string" || !item.sku_code.trim()) {
          continue;
        }
        perSku.set(item.sku_code, item);
      }

      const pagination: { next_cursor?: string | null; has_more?: boolean } | undefined =
        body.meta?.pagination;
      const next: string | null = pagination?.next_cursor ?? null;
      pages += 1;

      if (!pagination?.has_more || !next || next === cursor) break;
      cursor = next;
    }

    return { items: [...perSku.values()], brandNameById };
  }

  async runTransaction(
    input: SupplierTransactionInput,
  ): Promise<SupplierTransactionResult> {
    /*
     * Nama field request.
     *
     * Dokumentasi API menyebut `customer_target` dan
     * `customer_target_zone`, dan itu yang dikirim di sini - sudah
     * diuji langsung dan dijawab 201.
     *
     * Tapi NAMA FIELD DI inquiry_form_response TIDAK sama: katalog
     * memakai `target_id` dan `target_zone`. Ketiganya haltHys atau Anda
     * akan/order dengan field yang tidak pernah dibaca supplier.
     */
    const body = {
      sku_code: input.sku,
      customer_target: input.target,
      ...(input.zone ? { customer_target_zone: input.zone } : {}),
      buyer_trx_id: input.requestRef,
      sandbox_mode: input.environment === "sandbox",
      ...(input.maxPrice > 0 ? { max_price: Math.round(input.maxPrice) } : {}),
      ...(input.additionalData ? { additional_data: input.additionalData } : {}),
    };

    const response = await requestOnce<
      MelostoreEnvelope<MelostoreTransaction>
    >("/transaction", {
      method: "POST",
      body: JSON.stringify(body),
    });

    const data = response.data;
    if (!data) {
      throw new SupplierError(
        SUPPLIER_ID,
        "Respons transaksi Melostore tidak berisi data transaksi.",
      );
    }

    const status = normalizeSupplierStatus(data.status) ?? "pending";

    return {
      status,
      transactionId: data.id ?? null,
      // `price_charged` belum ada di respons pembuatan - yang ada hanya
      // `price`, yang untuk order bermax_price adalah nilai yang DITAHAN,
      // bukan biaya akhir. Bedanya baru terlihat di callback.
      charged: toSupplierAmount(data.price) ?? 0,
      serialNumber: data.serial_number?.trim() || null,
      message: data.message ?? "",
      errorCode: data.error_code ?? null,
    };
  }

  /** Cek status transaksi lewat `buyer_trx_id` (dipakai idempotency). */
  async fetchTransactionStatus(
    reference: string,
  ): Promise<SupplierTransactionResult | null> {
    const body = await requestOnce<MelostoreEnvelope<MelostoreTransaction>>(
      `/transaction/${encodeURIComponent(reference)}`,
      { method: "GET" },
    );

    const data = body.data;
    if (!data) return null;

    const status = normalizeSupplierStatus(data.status);
    if (!status) return null;

    return {
      status,
      transactionId: data.id ?? null,
      charged:
        toSupplierAmount(data.price_charged) ?? toSupplierAmount(data.price) ?? 0,
      serialNumber: data.serial_number?.trim() || null,
      message: data.message ?? "",
      errorCode: data.error_code ?? null,
    };
  }

  /**
   * Verifikasi tanda tangan callback.
   *
   * `X-H2H-Signature` adalah HMAC-SHA256 hex dari RAW BODY.
   *
   * `timingSafeEqual` wajib, bukan `===`. Perbandingan string biasa
   * keluar lebih cepat di byte pertama yang berbeda, dan itu membuat
   * secret bisa ditebak satu byte satu byte dari waktu responsnya.
   * `timingSafeEqual` membandingkan seluruh isi dengan waktu tetap.
   */
  verifyWebhook(rawBody: string, signatureHeader: string | null): boolean {
    const { webhookSecret } = getConfig();
    if (!webhookSecret || !signatureHeader) return false;

    /*
     * Menerima bentuk yang umum dipakai gateway/operator. Beberapa
     * pengirim menyertakan awalan `sha256=` (mirip webhook GitHub) atau
     * membatasi nilainya dengan spasi. Menghapus awalan dulu supaya
     * perbandingan panjang tetap konsisten dengan hex hasil HMAC.
     */
    const actual = signatureHeader.trim().replace(/^sha256\s*[:=]\s*/i, "");
    if (!actual) return false;

    const expected = createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex");

    const expectedBuffer = Buffer.from(expected, "utf8");
    const actualBuffer = Buffer.from(actual, "utf8");

    // Panjang berbeda harus ditolak lebih dulu: `timingSafeEqual`
    // melempar kalau panjangnya tidak sama.
    if (actualBuffer.length !== expectedBuffer.length) return false;

    try {
      return timingSafeEqual(actualBuffer, expectedBuffer);
    } catch {
      return false;
    }
  }

  /**
   * Ubah payload callback menjadi bentuk bersama.
   *
   * Mengembalikan `null` - BUKAN melempar - untuk payload yang tidak
   * dikenali. Callback yang gagal parse harus tetap dibalas 200 supaya
   * Melostore berhenti mengirim ulang; kalau dibalas 4xx, satu payload
   * aneh akan dicoba berulang sampai rate limit habis.
   */
  parseWebhook(rawBody: string): SupplierWebhookEvent | null {
    let parsed: MelostoreWebhookPayload;
    try {
      parsed = JSON.parse(rawBody) as MelostoreWebhookPayload;
    } catch {
      return null;
    }

    if (!parsed || typeof parsed !== "object") return null;

    const requestRef =
      typeof parsed.buyer_trx_id === "string" ? parsed.buyer_trx_id.trim() : "";
    if (!requestRef) return null;

    const needsAction = parsed.need_action === true;

    /*
     * Event `transaction.action_change` TIDAK boleh menyelesaikan order.
     *
     * Dokumentasi Melostore menyatakannya eksplisit: event tindakan tidak
     * boleh menyelesaikan pesanan, mengubah saldo, atau memicu refund.
     * Yang dikirim balik ke pemanggil lewat `requiresAction`, supaya
     * route webhook tahu untuk mencatatnya tanpa advancing status.
     */
    if (needsAction) {
      const version = parsed.action?.version ?? 0;
      return {
        requestRef,
        status: normalizeSupplierStatus(parsed.status) ?? "pending",
        transactionId: parsed.id ?? null,
        serialNumber: parsed.serial_number?.trim() || null,
        charged: toSupplierAmount(parsed.price_charged),
        message: parsed.message ?? null,
        errorCode: parsed.error_code ?? null,
        requiresAction: true,
        eventKey: `action:${parsed.event_id ?? requestRef}:${version}`,
      };
    }

    const status = normalizeSupplierStatus(parsed.status);
    if (!status) return null;

    /*
     * Kunci dedup untuk hasil akhir.
     *
     * `buyer_trx_id:status` - bukan `id:status` seperti Digiflazz - karena
     * `buyer_trx_id` satu-satunya yang selalu ada di callback Melostore,
     * dan itu yang dipakai untuk mencocokkan dengan order Nambah.
     */
    return {
      requestRef,
      status,
      transactionId: parsed.id ?? null,
      serialNumber: parsed.serial_number?.trim() || null,
      charged: toSupplierAmount(parsed.price_charged),
      message: parsed.message ?? null,
      errorCode: parsed.error_code ?? null,
      requiresAction: false,
      eventKey: `${requestRef}:${status}`,
    };
  }
}