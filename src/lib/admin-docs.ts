/**
 * Isi dokumentasi dashboard admin.
 *
 * DIPISAH DARI KOMPONEN supaya isinya bisa dicari tanpa me-render seluruh
 * halaman. Halaman docs biasanya dibuka justru saat operator bingung dan
 * sedang tidak sabar - memaksa unduhan JS besar sebelum isi guide muncul
 * adalah cara memastikan halaman ini tidak pernah dibaca.
 *
 * ISI DISIMPAN DI DALAM KODE, bukan file markdown, karena:
 *
 * 1. Admin tidak punya cara deploy file baru tanpa build ulang.
 * 2. Versi docs selalu sama dengan versi dashboard yang sedang dipakai.
 *    Kalau docsnya terpisah, isinya bisa menulis ulang dari UI yang
 *    menjelaskan - dan guide yang salah lebih berbahaya daripada tidak
 *    ada guide sama sekali.
 *
 * SETIAP ENTRI WAJIB menyebut HAL NYATA yang dilakukan di sistem ini,
 * bukan deskripsi umum. Guide yang hanya mengulang nama tombol tidak
 * menolong seseorang yang sedang mencari jawaban.
 */

export type DocEntry = {
  /** Id seksi di dashboard, dipakai untuk tautan dari sidebar. */
  section?: string;
  title: string;
  /** Satu kalimat: apa yang dikerjakan di halaman ini. */
  summary: string;
  /** Langkah kerja, dalam urutan. */
  steps?: string[];
  /** Hal yang sering salah atau membingungkan. */
  notes?: Array<{ label: string; text: string }>;
  /** Istilah yang perlu dijelaskan. */
  terms?: Array<{ term: string; text: string }>;
};

export type DocGroup = {
  group: string;
  intro: string;
  entries: DocEntry[];
};

export const DOC_GROUPS: DocGroup[] = [
  {
    group: "Operasional",
    intro:
      "Halaman yang dipakai setiap hari: order masuk, log pengiriman email, dan laporan harga per transaksi.",
    entries: [
      {
        section: "overview",
        title: "Ringkasan",
        summary:
          "Kondisi bisnis saat ini: saldo supplier, order bermasalah, dan angka lain yang perlu diawasi.",
        steps: [
          "Mulai dari sini setiap pagi. Ringkasan di sini sengaja hanya memuat yang butuh tindakan.",
          "Baris Perlu perhatian di paling atas muncul hanya kalau memang ada masalah. Kalau tidak muncul, berarti tidak ada yang perlu ditangani hari ini.",
          "Tiga kartu di bawahnya adalah angka harian biasa, bukan peringatan.",
        ],
        notes: [
          {
            label: "Kenapa halaman ini tidak memuat semuanya",
            text: "Peta jalan fitur dan konfigurasi payment gateway tidak lagi ada di Ringkasan. Keduanya dokumentasi teknis, bukan pekerjaan harian operator. Peta jalan dan konfigurasi gateway bisa ditemukan di halaman Sistem.",
          },
          {
            label: "Flow Test aktif",
            text: "Kalau badge FLOW TEST muncul di kanan atas, semua data yang tampil berasal dari mode uji. Order uji tidak pernah fulfilled sungguhan dan tidak memakai uang sungguhan. Jangan mengambil kesimpulan bisnis dari angka saat badge itu menyala.",
          },
        ],
      },
      {
        section: "orders",
        title: "Pesanan",
        summary:
          "Daftar order yang masuk, beserta aksi untuk mengganti statusnya secara manual.",
        steps: [
          "Klik Detail untuk melihat seluruh detail order: akun tujuan, game, harga, dan status supplier.",
          "Aksi Ubah Status hanya dipakai kalau status tidak menyesuaikan sendiri, misalnya order nyangkut setelah webhook supplier tidak pernah sampai.",
          "Setelah mengganti status, isi alasan pada kolom yang tersedia agar jejaknya terbaca.",
        ],
        notes: [
          {
            label: "25 order per halaman",
            text: "Daftar dipaginasi, bukan digulir penuh. Halaman selalu kembali ke awal begitu filter atau pencarian berubah, jadi hasil saringan tidak pernah tercecer di halaman keempat.",
          },
          {
            label: "Jangan buru-buru ganti status",
            text: "Order yang sudah `success` berarti top up sudah terjadi di sisi supplier. Mengubahnya menjadi `failed` tidak membatalkan top up - itu hanya membuat catatan kita berbeda dari kenyataan supplier.",
          },
          {
            label: "Order merchant tidak bisa dibatalkan",
            text: "Order berstatus `pending_merchant` menunggu merchant memindai kode di kasirnya. Order ini sengaja tidak ikut sweeper kedaluwarsa, karena begitu sudah discan, top up sudah terjadi dan tidak bisa ditarik.",
          },
        ],
      },
      {
        section: "receipts",
        title: "Log Email",
        summary:
          "Status pengiriman email bukti transfer ke user lewat Brevo. Bukan halaman verifikasi pembayaran.",
        steps: [
          "Cari order yang email receipt-nya belum sampai.",
          "Periksa kolom Percobaan - angka yang naik berulang kali menandakan masalah, bukan satu kegagalan yang terlewat.",
          "Baca pesan error di bawah status jika ada, lalu jalankan rekonsiliasi dari halaman Sistem untuk mencoba ulang.",
        ],
        notes: [
          {
            label: "Kenapa tidak ada verifikasi pembayaran manual",
            text: "Halaman ini dulunya bernama Bukti Transfer dengan keterangan Verifikasi bukti bayar. Nama itu salah: isinya log pengiriman email, dan tidak ada alur verifikasi pembayaran manual di Lacte sama sekali. Kalau nanti dibutuhkan, itu fitur baru yang harus dibangun terpisah - bukan sekadar mengganti label.",
          },
          {
            label: "Status tidak bisa diubah manual",
            text: "Kolom status dibaca dari tabel receipt_deliveries yang juga dipakai cron pengiriman. Rekonsiliasi mencoba ulang pengiriman yang gagal, dan status berubah sendiri setelah penyedia mengonfirmasi.",
          },
        ],
      },
      {
        section: "transactions",
        title: "Transaksi",
        summary:
          "Laporan harga per transaksi, bisa difilter dan diunduh sebagai CSV.",
        steps: [
          "Pilih periode: preset 7/30/90 hari, atau isi rentang tanggal sendiri.",
          "Saring dengan pencarian bebas - bisa id order, nama game, item, atau akun tujuan.",
          "Filter tambahan untuk status dan metode pembayaran bisa digabungkan dengan pencarian.",
          "Klik Unduh CSV untuk mengunduh semua baris yang cocok filter, bukan hanya halaman yang tampil.",
        ],
        notes: [
          {
            label: "Empat harga yang berbeda",
            text: "Harga Katalog adalah harga sebelum diskon apa pun. Harga Jual adalah yang ditawarkan ke user. Harga Final adalah yang benar-benar dibayar user - inilah satu-satunya angka yang boleh disebut omzet. Harga Supplier adalah modal yang keluar. Semuanya ditampilkan terpisah karena sering berbeda jauh.",
          },
          {
            label: "Margin bukan selisih dua harga",
            text: "Margin Lacte diambil dari angka yang tersimpan di order, bukan dari `Harga Final - Harga Supplier`. Selisih itu terlihat lebih besar karena diskon, poin, dan komisi affiliate ikut terpotong dari sana. Kalau dihitung ulang, angkanya akan berbeda dari yang tercatat di order.",
          },
          {
            label: "Ringkasan mencakup semua halaman",
            text: "Angka di kartu ringkasan dihitung dari seluruh baris yang cocok filter, bukan dari halaman yang sedang terlihat. Jadi angkanya tidak berubah-ubah saat pindah halaman.",
          },
        ],
        terms: [
          {
            term: "Order tidak dihitung",
            text: "Order berstatus batal atau gagal tetap muncul di daftar, tapi tidak menambah omzet karena uangnya tidak pernah masuk. Jumlahnya terlihat di bawah kartu Transaksi.",
          },
        ],
      },
    ],
  },

  {
    group: "Katalog",
    intro:
      "Apa yang dijual, bagaimana harganya, dan dari mana kita membeli.",
    entries: [
      {
        section: "catalog",
        title: "Produk",
        summary:
          "Daftar item yang dijual beserta harga jual dan modalnya.",
        steps: [
          "Ubah harga jual di sini. Harga modalnya mengikuti supplier dan tidak diubah manual.",
          "Produk nonaktif disembunyikan dari katalog publik tanpa dihapus, jadi riwayatnya tetap ada.",
          "Simpan sekali klik untuk semua perubahan sekaligus.",
        ],
        notes: [
          {
            label: "Harga jual tidak boleh di bawah modal",
            text: "Sistem akan menolak harga yang membuat margin negatif, dan live dispatch diblokir kalau harga supplier naik setelah checkout. Menurunkan harga tanpa memperhitungkan biaya supplier berarti menanggung rugi.",
          },
        ],
      },
      {
        section: "promotions",
        title: "Promo",
        summary:
          "Diskon dan kode promo beserta produk mana yang ikut.",
        steps: [
          "Buat kode promo, tentukan jenisnya (nominal tetap atau persen), dan batasi produk yang boleh memakainya.",
          "Klik produk untuk mengaktifkannya. Promo tanpa produk terpilih tidak akan pernah terpakai.",
        ],
        notes: [
          {
            label: "Perhatikan kuota",
            text: "Kuota promo dipakai berulang oleh user yang sama. Kalau kuota habis di tengah periode, kode berhenti berlaku tanpa peringatan.",
          },
        ],
      },
      {
        section: "supplier",
        title: "Supplier",
        summary:
          "Saldo supplier, status fulfillment, dan pemulihannya kalau order nyangkut.",
        steps: [
          "Pantau saldo supplier di sini. Saldo rendah akan memblokir order baru.",
          "Kalau ada order yang nyangkut di status diproses, tombol pemulihkan akan mengambil status terbaru dari supplier.",
          "Gunakan filter tanggal saat menelusuri riwayat order supplier.",
        ],
        notes: [
          {
            label: "IP whitelist",
            text: "Kalau semua order gagal dengan pesan akses ditolak, periksa whitelist IP di dashboard supplier. Server Lacte harus terdaftar di sana, dan daftar IP tiap akun terbatas jumlahnya.",
          },
          {
            label: "Pemulihan bukan Kirim Ulang",
            text: "Tombol pemulihkan hanya membaca status yang sudah ada di supplier. Order yang benar-benar gagal perlu dicatat manual sebagai gagal supaya bisa di-refund ke user.",
          },
        ],
      },
    ],
  },

  {
    group: "Keuangan",
    intro:
      "Laporan arus kas, pemeriksaan angka, dan piutang merchant ritel.",
    entries: [
      {
        section: "cashflow",
        title: "Arus Kas",
        summary:
          "Rekap omzet, biaya supplier, margin, dan uang yang masuk dari toko ritel.",
        steps: [
          "Pilih periode, lalu baca kartu ringkasan dan grafik batang omzet harian.",
          "Baris Transfer Merchant menunjukkan uang yang benar-benar diterima dari merchant.",
          "Unduh CSV untuk menganalisis sendiri di spreadsheet.",
        ],
        notes: [
          {
            label: "Biaya layanan merchant bukan pendapatan",
            text: "Uang biaya layanan dibayar user LANGSUNG ke merchant dan tidak pernah melewati Lacte. Angka itu ditampilkan sebagai keterangan saja, dan tidak pernah dihitung sebagai omzet atau margin Lacte.",
          },
          {
            label: "Omzet ritel adalah piutang, bukan kas masuk",
            text: "Order dari toko ritel menghasilkan piutang, bukan uang yang sudah diterima. Uang baru masuk Lacte saat merchant transfer dan dicatat di halaman Toko Ritel. Menghitungnya sebagai kas masuk akan menganggap piutang sebagai uang.",
          },
        ],
      },
      {
        section: "finance",
        title: "Rekonsiliasi",
        summary:
          "Pemeriksaan otomatis apakah angka order masih konsisten satu sama lain.",
        steps: [
          "Jalankan pemeriksaan lalu baca hasilnya per order.",
          "Status `ok` berarti semua angka cocok. `warning` perlu ditinjau. `error` berarti Selisih yang serius.",
          "Halaman ini hanya MEMERIKSA - tidak mengubah uang apa pun.",
        ],
        notes: [
          {
            label: "Hanya memeriksa, tidak memperbaiki",
            text: "Kalau muncul error, angka di tabel lain ikut meragukan. Periksa order yang disebut, lalu putuskan sendiri perbaikannya - sistem tidak mengoreksi otomatis.",
          },
        ],
        terms: [
          {
            term: "Invariant",
            text: "Aturan yang harus selalu benar, misalnya harga final tidak boleh lebih kecil dari modal. Rekonsiliasi membandingkan angka-angka ini antar tabel.",
          },
        ],
      },
      {
        section: "merchants",
        title: "Toko Ritel",
        summary:
          "Daftar toko reseller, tarif biaya layanan, dan pelunasan piutang.",
        steps: [
          "Klik baris toko untuk mengubah biaya layanan, termin pelunasan, atau statusnya.",
          "Biaya layanan diisi sebagai NOMINAL rupiah, bukan persen. Biaya ini 100% milik merchant - Lacte tidak mengambil apa pun dari sana.",
          "Tombol Catat pelunasan dipakai setelah uang merchant benar-benar masuk.",
        ],
        notes: [
          {
            label: "Biaya layanan 100% milik merchant",
            text: "Nilai yang diisi di sini diteruskan apa adanya ke user sebagai biaya layanan. Lacte tidak mengambil potongan dari nilai tersebut. Margin Lacte untuk order ritel selalu nol.",
          },
          {
            label: "Piutang = harga produk saja",
            text: "Yang ditagih ke merchant adalah harga produk yang dibayar user. Biaya layanan tidak ikut karena uang itu tidak pernah melewati Lacte - menghitungnya akan menagih utang yang bukan milik Lacte.",
          },
          {
            label: "Pelunasan dialokasikan otomatis",
            text: "Tidak perlu memilih order mana yang dibayar. Pembayaran selalu menutup tagihan paling lama lebih dulu, jadi angka yang tersisa di merchant bisa langsung dibandingkan dengan piutang.",
          },
          {
            label: "Kelebihan bayar jadi kredit",
            text: "Kalau merchant transfer lebih besar dari piutangnya, sisanya tidak hilang - disimpan sebagai kredit dan otomatis mengurangi tagihan berikutnya.",
          },
          {
            label: "Status frozen",
            text: "Status `frozen` menghentikan order BARU. Order yang sedang berjalan tetap boleh diselesaikan, karena user sudah checkout dan tidak bisa disandera menunggunya.",
          },
        ],
        terms: [
          {
            term: "PIN kasir",
            text: "Kode empat angka untuk masuk ke halaman kasir merchant. Ditampilkan SEKALI saat toko dibuat atau saat PIN di-reset, lalu hanya hash-nya yang tersimpan - termasuk untuk admin. Kalau hilang, reset dari halaman ini.",
          },
        ],
      },
    ],
  },

  {
    group: "Program",
    intro: "Saldo dan program yang dimiliki user serta partner.",
    entries: [
      {
        section: "points",
        title: "Lacte Points",
        summary:
          "Manajemen saldo points: penerbitan, kedaluwarsa, dan lot.",
        steps: [
          "Lihat mutasi points untuk memastikan penerbitan dan pemakaian tercatat benar.",
          "Poin kedaluwarsa diproses otomatis oleh cron - tidak perlu tindakan manual.",
        ],
        notes: [
          {
            label: "Poin adalah kewajiban Lacte",
            text: "Setiap poin yang beredar adalah kewajiban Lacte. Kalau poin diterbitkan tanpa order yang menjadi dasarnya, saldo points akan terlihat lebih besar dari kemampuan bayar.",
          },
        ],
      },
      {
        section: "affiliates",
        title: "Afiliasi",
        summary:
          "Komisi affiliate dan proses pencairannya.",
        steps: [
          "Komisi dialokasikan otomatis ketika order selesai.",
          "Permintaan pencairan diperiksa dulu, lalu transfer dilakukan DI LUAR sistem.",
          "Setelah uang benar-benar ditransfer, tandai request sebagai sudah dibayar dengan nomor referensi.",
        ],
        notes: [
          {
            label: "Jangan tandai lunas sebelum transfer",
            text: "Sistem mengunci alokasi komisi secara atomik, tapi transfer tetap manual. Menandai sudah dibayar sebelum uang benar-benar bergerak akan membuat pencatatan tidak cocok dengan rekening.",
          },
        ],
      },
    ],
  },

  {
    group: "Sistem",
    intro: "Akun admin, akses, dan kesehatan aplikasi.",
    entries: [
      {
        section: "users",
        title: "Pengguna",
        summary:
          "Akun yang punya akses ke panel admin, lengkap dengan perannya.",
        steps: [
          "Tambahkan akun admin baru hanya jika memang butuh orang lain yang punya akses.",
          "Peran menentukan apa yang bisa dilihat dan diubah - beri peran paling kecil yang cukup.",
          "Cabut akses dengan menghapus akunnya, bukan dengan mengganti perannya menjadi tidak aktif.",
        ],
        notes: [
          {
            label: "Akses admin",
            text: "Panel ini menyimpan data pembayaran dan hutang merchant. Akun yang ditambahkan di sini bisa membukanya - jadi jangan memakai akun yang dipakai untuk hal lain.",
          },
        ],
      },
      {
        section: "system",
        title: "Sistem",
        summary:
          "Kesehatan layanan, konfigurasi, dan preparedness aplikasi.",
        steps: [
          "Periksa status setiap service sebelum menyimpulkan ada masalah operasional.",
          "Readiness memberi tahu apakah aplikasi aman dipindahkan ke produksi.",
          "Bagian konfigurasi menampilkan environment variable yang wajib terisi - jangan diubah dari panel.",
        ],
        notes: [
          {
            label: "Environment variable tidak bisa diubah dari sini",
            text: "Halaman ini hanya MEMBACA konfigurasi. Mengubah nilai environment harus dilakukan di server lalu aplikasi di-restart. Tampilan di sini sengaja tidak bisa diklik, supaya tidak menimbulkan ekspektasi bahwa mengubahnya di panel akan berhasil.",
          },
        ],
      },
    ],
  },
];

/**
 * Cari entri di seluruh dokumentasi.
 *
 * Pencarian sengaja membandingkan dengan `includes` pada teks yang sudah
 * dinormalisasi (huruf kecil, spasi dirapatkan). Itu cukup untuk
 * dokumentasi sebesar ini, dan tidak perlu membangun indeks.
 *
 * `field` mengembalikan apa yang cocok supaya halaman bisa menampilkan
 * potongan kalimatnya - menampilkan daftar hasil tanpa penjelasan
 * Potongan kalimatnya dikembalikan supaya halaman bisa menampilkan
 */
export function searchDocs(query: string) {
  const needle = query
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  if (!needle) return [];

  const hits: Array<{
    group: string;
    title: string;
    summary: string;
    section?: string;
    matchedIn: string;
  }> = [];

  for (const group of DOC_GROUPS) {
    for (const entry of group.entries) {
      const haystacks: Array<[string, string]> = [
        [entry.title.toLowerCase(), "judul"],
        [entry.summary.toLowerCase(), "ringkasan"],
        ...(entry.steps ?? []).map(
          (step): [string, string] => [step.toLowerCase(), "langkah"],
        ),
        ...(entry.notes ?? []).map(
          (note): [string, string] => [
            `${note.label} ${note.text}`.toLowerCase(),
            "catatan",
          ],
        ),
        ...(entry.terms ?? []).map(
          (term): [string, string] => [
            `${term.term} ${term.text}`.toLowerCase(),
            "istilah",
          ],
        ),
      ];

      for (const [haystack, field] of haystacks) {
        if (haystack.includes(needle)) {
          hits.push({
            group: group.group,
            title: entry.title,
            summary: entry.summary,
            section: entry.section,
            matchedIn: field,
          });
          break;
        }
      }
    }
  }

  return hits;
}