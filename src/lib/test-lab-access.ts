import { isFlowTestMode } from "@/lib/flow-test";

/**
 * Apakah alat uji fulfilment boleh dibuka.
 *
 * KENAPA HIERARCHI INI, BUKAN CUMA `NODE_ENV`
 *
 * `NODE_ENV === "production"` ditutup total. Tapi pada build yang di-deploy
 * ke staging - yang `NODE_ENV`-nya `production` juga - alat ini justru
 * satu-satunya cara menguji perilaku supplier tanpa uang sungguhan. Menutupnya
 * di semua production membuat staging tidak bisa dipakai untuk rehearsals.
 *
 * Jadi: `NAMBAH_FLOW_TEST_MODE=true` membuka akses di mana pun, termasuk
 * production. Itu tetap berisiko, tapi itu keputusan sadar operator yang
 * mengaktifkan variabelnya sendiri - bukan sakelar yang tidak sengaja aktif.
 *
 * Kalau variabelnya tidak diisi di production, akses tertutup tanpa perlu
 * operator melakukan apa pun. Itu keadaan default yang benar untuk situs
 * yang benar-benar melayani pelanggan.
 */
export function isTestLabEnabled() {
  if (isFlowTestMode()) return true;

  return process.env.NODE_ENV !== "production";
}

/**
 * Alasan yang ditampilkan kalau alatnya ditutup.
 *
 * Dipakai untuk membalas 404, bukan "403 tidak diizinkan" - keduanya
 * jujur soal apa adanya, tapi 404 tidak memberiimu ide untuk mencari
 * alternatif yang tidak ada.
 */
export const TEST_LAB_DISABLED_MESSAGE =
  "Alat uji fulfilment hanya tersedia saat mode uji aktif.";
