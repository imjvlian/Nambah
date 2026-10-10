import assert from "node:assert/strict";
import test from "node:test";

import { affiliateLink } from "../src/lib/affiliate-link.ts";
import { siteUrl } from "../src/lib/brand.ts";

/**
 * Link afiliasi yang bisa dibagikan.
 *
 * Yang diuji di sini bukan format URL-nya - itu satu baris - tapi
 * keputusan untuk MENYEMBUNYIKAN tombol salin pada kode yang belum siap.
 *
 * Alasannya `/r/[code]` menolak kode tanpa pemilik: komisi dari kode
 * tanpa pemilik tidak akan bisa dicairkan siapa pun. Kalau link seperti
 * itu tetapshown dengan tombol salin, affiliate menyebarkannya, pembeli
 * order terjadi, komisi tercatat, dan tidak ada yang bisa menariknya.
 * Salah tempat yang mahal baru ketahuan setelah ratusan klik.
 */

const AKTIF_DAN_PUNYA = { status: "active", hasOwner: true } as const;

test("kode aktif dengan pemilik menghasilkan link siap pakai", () => {
  const result = affiliateLink({ code: "BUDI", ...AKTIF_DAN_PUNYA });

  assert.equal(result.usable, true);
  assert.equal(result.warning, null);
  assert.match(result.url, /\/r\/BUDI$/);
  assert.ok(!result.url.includes("//r/"), "tidak boleh ada garis miring ganda");
});

test("link dimulai dari origin publik yang sama dengan sitemap", () => {
  const result = affiliateLink({ code: "BUDI", ...AKTIF_DAN_PUNYA });

  // Kalau ini menyimpang dari `siteUrl()`, link yang tersalin admin bisa
  // menunjuk ke domain yang tidak ada di sitemap sama sekali.
  assert.ok(result.url.startsWith(siteUrl()));
});

test("kode tanpa pemilik: link ditampilkan, tapi tidak bisa dibagikan", () => {
  const result = affiliateLink({ code: "BUDI", status: "active", hasOwner: false });

  assert.equal(result.usable, false);
  assert.ok(result.warning);
  assert.ok(
    result.warning.includes("akun"),
    "keterangan harus menyebut apa yang perlu diperbaiki",
  );
});

test("status bukan active ditolak, dengan alasan yang berbeda per status", () => {
  const suspended = affiliateLink({ code: "BUDI", status: "suspended", hasOwner: true });
  const inactive = affiliateLink({ code: "BUDI", status: "inactive", hasOwner: true });

  assert.equal(suspended.usable, false);
  assert.equal(inactive.usable, false);
  assert.notEqual(
    suspended.warning,
    inactive.warning,
    "admin harus bisa membedakan keduanya dari keterangan",
  );
});

test("kode kosong tidak menghasilkan URL yang dikira bisa dibagikan", () => {
  const result = affiliateLink({ code: "", ...AKTIF_DAN_PUNYA });

  assert.equal(result.usable, false);
  assert.ok(result.warning);
});

test("spasi di kode dipangkas, bukan ikut jadi path traversal", () => {
  const result = affiliateLink({ code: "  BUDI  ", ...AKTIF_DAN_PUNYA });

  assert.equal(result.usable, true);
  assert.match(result.url, /\/r\/BUDI$/);
});

test("karakter yang harus di-encode tetap ter-encode", () => {
  const result = affiliateLink({ code: "A/B", ...AKTIF_DAN_PUNYA });

  assert.ok(!result.url.includes("/r/A/B"), "garis miring tidak boleh membuat segment baru");
});

test("input rusak tidak pernah menghasilkan link yang dianggap siap", () => {
  const inputs = [
    { code: "BUDI", status: "active" },
    { code: "BUDI", status: "active", hasOwner: undefined },
    { code: null as unknown as string, status: "active", hasOwner: true },
    { code: 42 as unknown as string, status: "active", hasOwner: true },
    { code: "BUDI", status: null as unknown as string, hasOwner: true },
    { code: "BUDI", status: "active", hasOwner: "yes" as unknown as boolean },
  ];

  for (const input of inputs) {
    const result = affiliateLink(input as Parameters<typeof affiliateLink>[0]);
    assert.equal(
      result.usable,
      false,
      `input rusak tidak boleh dianggap siap: ${JSON.stringify(input)}`,
    );
  }
});