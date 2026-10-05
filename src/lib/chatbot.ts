import { supabaseSelect } from "@/lib/supabase/server";

export type ChatMessage = { role: "user" | "assistant"; content: string };

const GEMINI_MODEL =
  process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash";
const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY?.trim() ||
  process.env.GOOGLE_API_KEY?.trim() ||
  "";

const MAX_HISTORY = 12;
const MAX_MESSAGE_LENGTH = 1000;

export function isChatbotAiConfigured() {
  return Boolean(GEMINI_API_KEY);
}

const ORDER_STATUS_LABEL: Record<string, string> = {
  pending_payment: "menunggu pembayaran",
  paid: "sudah dibayar, antre diproses",
  processing: "sedang diproses",
  success: "berhasil",
  failed: "gagal",
  refunded: "dana dikembalikan (refund)",
  cancelled: "dibatalkan",
};

function statusLabel(status: string) {
  return ORDER_STATUS_LABEL[status] ?? status;
}

function formatIdr(value: number) {
  return "Rp" + value.toLocaleString("id-ID");
}

// ---------------------------------------------------------------------------
// Konteks katalog (ringkas, aman untuk prompt)
// ---------------------------------------------------------------------------

type GameRow = { id: string; name: string; active: boolean };
type ProductRow = {
  id: string;
  game_id: string;
  label: string;
  selling_price: number | string;
  active: boolean;
};

async function buildCatalogContext(): Promise<string> {
  try {
    const [games, products] = await Promise.all([
      supabaseSelect<GameRow>("games", {
        select: "id,name,active",
        filters: { active: "eq.true" },
        order: "sort_order.asc",
        limit: 30,
      }),
      supabaseSelect<ProductRow>("products", {
        select: "id,game_id,label,selling_price,active",
        filters: { active: "eq.true" },
        order: "selling_price.asc",
        limit: 400,
      }),
    ]);

    const byGame = new Map<string, ProductRow[]>();
    for (const product of products) {
      const list = byGame.get(product.game_id) ?? [];
      list.push(product);
      byGame.set(product.game_id, list);
    }

    const lines = games.map((game) => {
      const items = (byGame.get(game.id) ?? []).slice(0, 3);
      if (items.length === 0) return `- ${game.name}`;
      const cheapest = Number(items[0]!.selling_price);
      const examples = items
        .map((item) => `${item.label} ${formatIdr(Number(item.selling_price))}`)
        .join(", ");
      return `- ${game.name}: mulai ${formatIdr(cheapest)} (contoh: ${examples})`;
    });

    return lines.join("\n");
  } catch (error) {
    console.error("Chatbot catalog context failed", error);
    return "(katalog belum dapat dimuat)";
  }
}

// ---------------------------------------------------------------------------
// Konteks order milik user yang sedang login
// ---------------------------------------------------------------------------

type OrderRow = {
  id: string;
  status: string;
  final_price: number | string;
  created_at: string;
  product: { label: string } | null;
};

async function buildUserOrdersContext(userId: string): Promise<string> {
  try {
    const orders = await supabaseSelect<OrderRow>("orders", {
      select: "id,status,final_price,created_at,product:products(label)",
      filters: { customer_user_id: `eq.${userId}` },
      order: "created_at.desc",
      limit: 5,
    });

    if (orders.length === 0) {
      return "User login tetapi belum punya order sama sekali.";
    }

    return orders
      .map((order) => {
        const date = new Date(order.created_at).toLocaleString("id-ID", {
          dateStyle: "medium",
          timeStyle: "short",
        });
        return `- ${order.id} · ${order.product?.label ?? "produk"} · ${formatIdr(Number(order.final_price))} · status: ${statusLabel(order.status)} · ${date}`;
      })
      .join("\n");
  } catch (error) {
    console.error("Chatbot orders context failed", error);
    return "(riwayat order belum dapat dimuat)";
  }
}

// ---------------------------------------------------------------------------
// FAQ rule-based (fallback saat AI tidak dikonfigurasi / gagal)
// ---------------------------------------------------------------------------

const SUPPORT_CONTACT =
  process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP?.trim() ||
  process.env.SUPPORT_CONTACT_TEXT?.trim() ||
  "";

const FAQ: Array<{ keywords: RegExp; answer: string }> = [
  {
    keywords: /\b(halo|hai|hi|hello|pagi|siang|sore|malam)\b/i,
    answer:
      "Halo! Aku Nambah Assistant. Bisa bantu cek status order, info produk & harga, cara pembayaran, atau arahkan ke admin. Mau tanya apa?",
  },
  {
    keywords: /(cara|bagaimana).*(top ?up|isi|beli)|^top ?up/i,
    answer:
      "Cara top up: 1) Pilih game/produk, 2) isi ID akun tujuan (perhatikan 1 atau 2 kolom sesuai game), 3) pilih nominal dan metode pembayaran, 4) selesaikan pembayaran. Pesanan diproses otomatis setelah pembayaran terkonfirmasi.",
  },
  {
    keywords: /(bayar|pembayaran|qris|transfer|e-?wallet|va\b|virtual account)/i,
    answer:
      "Pembayaran dilakukan di halaman order setelah checkout — tersedia beberapa metode (QRIS, e-wallet, transfer bank). Pembayaran terverifikasi otomatis, jadi setelah bayar kamu tinggal menunggu pesanan diproses.",
  },
  {
    keywords: /(lama|berapa lama|belum masuk|lambat|stuck|proses terus)/i,
    answer:
      "Pesanan umumnya selesai dalam hitungan menit setelah pembayaran terkonfirmasi. Kalau status masih 'sedang diproses', sistem kami terus memantau sampai selesai. Kalau sudah terlalu lama, hubungi admin dengan menyertakan nomor order kamu.",
  },
  {
    keywords: /(promo|diskon|kode|referral|referal|voucher)/i,
    answer:
      "Kalau kamu punya kode promo atau kode referral, masukkan di kolom yang tersedia saat checkout sebelum membuat pembayaran. Diskon langsung terpotong dari total tagihan.",
  },
  {
    keywords: /(refund|dana kembali|gagal|uang hilang)/i,
    answer:
      "Kalau pembayaran sudah terdebit tapi pesanan gagal, dana diproses kembali sesuai kebijakan pembayaran. Hubungi admin dengan nomor order supaya bisa dicek langsung.",
  },
];

function contactAnswer() {
  return SUPPORT_CONTACT
    ? `Untuk bantuan admin langsung, hubungi kami di ${SUPPORT_CONTACT}. Sertakan nomor order supaya cepat dicek.`
    : "Untuk bantuan admin langsung, silakan gunakan kontak dukungan yang tertera di halaman bantuan. Sertakan nomor order supaya cepat dicek.";
}

async function fallbackReply(input: {
  latestUserText: string;
  userId: string | null;
}): Promise<string> {
  const text = input.latestUserText.trim();

  if (/(status|cek|lacak).*(order|pesanan)|^nbh-|order saya/i.test(text)) {
    if (!input.userId) {
      return "Untuk cek status order, login dulu ke akun Nambah kamu — setelah itu aku bisa bantu lihatkan status pesananmu. Atau buka langsung halaman order dari link yang kamu dapat setelah checkout.";
    }
    const ordersContext = await buildUserOrdersContext(input.userId);
    return ordersContext.startsWith("(")
      ? "Riwayat order kamu belum dapat dimuat sekarang. Coba beberapa saat lagi, ya."
      : `Ini status pesananmu:\n${ordersContext}\n\nKalau ada yang tampak janggal, hubungi admin dengan nomor order-nya.`;
  }

  if (/(produk|harga|daftar|katalog|game apa|pulsa|paket)/i.test(text)) {
    const catalog = await buildCatalogContext();
    return `Ini sebagian produk yang tersedia:\n${catalog}\n\nUntuk harga lengkap dan promo terkini, buka halaman utama dan pilih produknya.`;
  }

  if (/(admin|cs|customer service|hubungi|kontak|manusia|komplain)/i.test(text)) {
    return contactAnswer();
  }

  for (const entry of FAQ) {
    if (entry.keywords.test(text)) return entry.answer;
  }

  return "Aku bisa bantu soal top up: cek status order, info produk & harga, cara pembayaran, promo, atau arahkan ke admin. Coba pilih salah satu topik itu, ya.";
}

// ---------------------------------------------------------------------------
// Gemini (mode AI)
// ---------------------------------------------------------------------------

function buildSystemPrompt(input: {
  catalog: string;
  orders: string;
  loggedIn: boolean;
}) {
  return [
    "Kamu adalah Nambah Assistant, customer service digital untuk Nambah — platform top up game, pulsa, dan e-money di Indonesia.",
    "",
    "Aturan wajib:",
    "- Jawab dalam Bahasa Indonesia yang ramah dan ringkas (idealnya maksimal 4 kalimat).",
    "- Hanya bahas layanan Nambah: produk, harga, cara top up, status order, pembayaran, promo.",
    "- JANGAN pernah menyebut nama supplier, penyedia pembayaran internal, biaya modal, profit, atau detail teknis backend.",
    "- Jangan mengarang nomor order atau status. Gunakan hanya data konteks di bawah. Kalau user menanyakan order yang tidak ada di konteks, minta nomor ordernya dan jelaskan status hanya bisa dicek untuk order miliknya sendiri.",
    "- Kalau user tanya di luar topik layanan, arahkan kembali dengan sopan.",
    "- Kalau user frustrasi, kasus pembayaran gagal, atau minta manusia: arahkan ke admin. " +
      (SUPPORT_CONTACT ? `Kontak admin: ${SUPPORT_CONTACT}.` : ""),
    "",
    "Konteks katalog (sebagian):",
    input.catalog,
    "",
    input.loggedIn
      ? `Konteks order milik user (privat, hanya miliknya):\n${input.orders}`
      : "User BELUM login — kamu tidak punya akses ke order apa pun. Kalau ditanya status order, minta user login dulu.",
  ].join("\n");
}

async function generateGeminiReply(input: {
  system: string;
  messages: ChatMessage[];
}): Promise<string | null> {
  if (!GEMINI_API_KEY) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({
          system_instruction: { parts: [{ text: input.system }] },
          contents: input.messages.map((message) => ({
            role: message.role === "assistant" ? "model" : "user",
            parts: [{ text: message.content }],
          })),
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 450,
          },
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      console.error(`Gemini generateContent gagal (${response.status})`, body.slice(0, 300));
      return null;
    }

    const payload = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    const text =
      payload.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("")
        .trim() ?? "";

    return text || null;
  } catch (error) {
    console.error("Gemini request failed", error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Titik masuk utama
// ---------------------------------------------------------------------------

export function sanitizeChatMessages(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 20) return null;

  const messages: ChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const role = (item as Record<string, unknown>).role;
    const content = (item as Record<string, unknown>).content;
    if (role !== "user" && role !== "assistant") return null;
    if (typeof content !== "string") return null;
    const trimmed = content.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!trimmed) return null;
    messages.push({ role, content: trimmed });
  }

  return messages.slice(-MAX_HISTORY);
}

export async function answerChat(input: {
  messages: ChatMessage[];
  userId: string | null;
}): Promise<{ reply: string; mode: "ai" | "faq" }> {
  const latestUserText =
    [...input.messages].reverse().find((m) => m.role === "user")?.content ?? "";

  if (isChatbotAiConfigured()) {
    const [catalog, orders] = await Promise.all([
      buildCatalogContext(),
      input.userId
        ? buildUserOrdersContext(input.userId)
        : Promise.resolve("(user belum login)"),
    ]);

    const reply = await generateGeminiReply({
      system: buildSystemPrompt({
        catalog,
        orders,
        loggedIn: Boolean(input.userId),
      }),
      messages: input.messages,
    });

    if (reply) return { reply, mode: "ai" };
    // AI gagal -> jatuh ke FAQ, tidak membiarkan user tanpa jawaban.
  }

  const reply = await fallbackReply({ latestUserText, userId: input.userId });
  return { reply, mode: "faq" };
}
