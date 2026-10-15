import { createHash } from "node:crypto";

function getConfig() {
  return {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME?.trim() ?? "",
    apiKey: process.env.CLOUDINARY_API_KEY?.trim() ?? "",
    apiSecret: process.env.CLOUDINARY_API_SECRET?.trim() ?? "",
  };
}

export function isCloudinaryConfigured() {
  const { cloudName, apiKey, apiSecret } = getConfig();
  return Boolean(cloudName && apiKey && apiSecret);
}

function sign(params: Record<string, string>, apiSecret: string) {
  const payload =
    Object.keys(params)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join("&") + apiSecret;
  return createHash("sha1").update(payload).digest("hex");
}

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
export const MAX_BANNER_BYTES = 2 * 1024 * 1024;

export function validateBannerImage(file: File) {
  if (!ALLOWED_TYPES.has(file.type)) {
    return "Format gambar harus JPG, PNG, atau WebP.";
  }
  if (file.size <= 0 || file.size > MAX_BANNER_BYTES) {
    return "Ukuran gambar maksimal 2MB (disarankan 1200×400px, <500KB).";
  }
  return null;
}

export async function uploadBannerImage(file: File): Promise<{
  secureUrl: string;
  publicId: string;
  /** Lebar asli gambar. `null` kalau Cloudinary tidak mengembalikannya. */
  width: number | null;
  /** Tinggi asli gambar. `null` kalau Cloudinary tidak mengembalikannya. */
  height: number | null;
}> {
  const { cloudName, apiKey, apiSecret } = getConfig();
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error("Cloudinary belum dikonfigurasi.");
  }

  const timestamp = String(Math.floor(Date.now() / 1000));
  const folder = "nambah/promo-banners";
  const signature = sign({ folder, timestamp }, apiSecret);

  const bytes = Buffer.from(await file.arrayBuffer());
  const dataUri = `data:${file.type};base64,${bytes.toString("base64")}`;

  const form = new FormData();
  form.set("file", dataUri);
  form.set("api_key", apiKey);
  form.set("timestamp", timestamp);
  form.set("folder", folder);
  form.set("signature", signature);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    { method: "POST", body: form, cache: "no-store" },
  );

  const payload = (await response.json().catch(() => null)) as {
    secure_url?: string;
    public_id?: string;
    width?: number;
    height?: number;
    error?: { message?: string };
  } | null;

  if (!response.ok || !payload?.secure_url || !payload.public_id) {
    throw new Error(
      `Upload Cloudinary gagal (${response.status}): ${payload?.error?.message ?? "unknown"}`,
    );
  }

  /*
 * Dimensi diambil dari respons Cloudinary, bukan dari form.
 *
 * Ini yang membuat rasio gambar bisa dipercaya. Kalau dimensinya dikirim
 * klien, operator bisa mengisinya dengan angka apa pun - dan popup akan
 * menampilkan gambar dengan rasio yang salah tanpa ada yang kelihatan salah.
 *
 * Cloudinary selalu mengirim `width` dan `height` di respons upload. Kalau
 * suatu saat tidak, hasilnya `null` dan popup membaca ukuran sendiri dari
 * gambar saat tampil - lebih lambat, tapi tetap benar.
 */
  const width = Number(payload.width);
  const height = Number(payload.height);

  return {
    secureUrl: payload.secure_url,
    publicId: payload.public_id,
    width: Number.isFinite(width) && width > 0 ? Math.round(width) : null,
    height: Number.isFinite(height) && height > 0 ? Math.round(height) : null,
  };
}

export async function deleteBannerAsset(publicId: string) {
  const { cloudName, apiKey, apiSecret } = getConfig();
  if (!cloudName || !apiKey || !apiSecret) return;

  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = sign({ public_id: publicId, timestamp }, apiSecret);

  const form = new FormData();
  form.set("public_id", publicId);
  form.set("api_key", apiKey);
  form.set("timestamp", timestamp);
  form.set("signature", signature);

  // Best-effort: kegagalan destroy tidak boleh menggagalkan hapus banner.
  await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`, {
    method: "POST",
    body: form,
    cache: "no-store",
  }).catch((error) => console.error("Cloudinary destroy failed", error));
}

/** Sisipkan transformasi f_auto,q_auto + batas lebar ke URL Cloudinary. */
export function optimizedBannerUrl(secureUrl: string, width = 1200) {
  return secureUrl.replace(
    "/upload/",
    `/upload/f_auto,q_auto,w_${Math.max(200, Math.round(width))}/`,
  );
}
