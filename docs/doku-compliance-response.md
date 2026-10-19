# Respons Kepatuhan: Verifikasi User ID Game pada Transaksi Top Up

**Lampiran pengajuan ulang merchant — [NAMA BADAN USAHA] × DOKU**

- Merchant ID: `[___]`
- Tanggal pengajuan awal: `[___]`
- Nomor tiket / referensi penolakan: `[___]`
- Penyusun: `[NAMA], [JABATAN] — [KONTAK]`
- Tanggal dokumen ini: `[___]`

---

## 1. Ringkasan eksekutif

Atas penolakan pengajuan merchant dengan pertimbangan bahwa *"transaksi Top Up Game masih dapat diproses meskipun User ID Game yang dimasukkan tidak valid"*, kami menyampaikan bahwa kontrol yang diminta **telah diterapkan dan aktif di produksi sejak 17 Oktober 2026**.

Setiap transaksi top up game kini **wajib lolos verifikasi User ID (dan Zone/Server bila berlaku) ke API distributor resmi sebelum order dibuat dan sebelum permintaan pembayaran dikirim**. Transaksi dengan User ID yang tidak valid **tidak diproses dan tidak menimbulkan perpindahan dana** — permintaan pembayaran tidak pernah dibuat untuk ID tersebut.

Kontrol ini bukan janji rencana: ia berjalan di produksi, meninggalkan **jejak audit pada setiap order**, dan didukung **bukti verifikasi dari pihak ketiga** (`transaction_id` pengecekan pada API distributor). Rincian, bukti, dan data produksi diuraikan di bawah.

## 2. Kontrol yang diterapkan: Account Verification Gate

### 2.1 Posisi kontrol dalam alur transaksi

```
Pembeli memasukkan User ID (+ Zone/Server bila berlaku)
        │
        ▼
[ GERBANG VERIFIKASI AKUN ]  ← cek ke API distributor resmi (H2H)
        │                          SEBELUM order dibuat
        ├─ ID TIDAK VALID      → TRANSAKSI DITOLAK (HTTP 422).
        │                        Order tidak dibuat; permintaan pembayaran
        │                        TIDAK PERNAH dikirim. Tidak ada dana berpindah.
        ├─ VERIFIKASI GAGAL*  → TRANSAKSI DITOLAK (HTTP 503) — fail-safe.
        │                        Gangguan provider tidak dipakai alasan
        │                        memproses transaksi tanpa verifikasi.
        └─ ID VALID (nickname dikonfirmasi) → order dibuat → pembayaran
```

*Gangguan provider: timeout, rate limit, gangguan API, atau saldo pengecekan habis.

Poin kepatuhan utama: **penolakan terjadi sebelum pembayaran**. Dalam alur kami (order → pembayaran → distribusi), gerbang dieksekusi pada langkah pertama — satu-satunya kondisi yang sampai ke pembayaran adalah ID yang terverifikasi valid oleh API distributor.

### 2.2 Sumber verifikasi: pihak ketiga, bukan asumsi internal

Validasi format (panjang angka, pola) saja tidak pernah kami anggap cukup. Verifikasi dilakukan dengan **permintaan nyata ke API H2H distributor resmi game** yang mengembalikan nickname akun untuk ID yang dikirim:

- **Sumber utama**: API H2H distributor (`check-nickname` / `purchase-limit`). Respons memuat nickname akun — bukti langsung bahwa ID tersebut eksis di sistem game.
- **Pengecekan berbayar** tercatat dengan `transaction_id` dari distributor — **bukti verifikasi dari pihak ketiga yang dapat diaudit**, bukan klaim internal.
- Untuk beberapa game, jalur pengecekan alternatif (provider data game lain) dipakai sebagai cadangan pada antarmuka pelanggan; hasil akhirnya tetap masuk gerbang yang sama sebelum transaksi.

### 2.3 Matriks keputusan (berlaku di produksi)

| Hasil verifikasi | Tindakan | HTTP |
|---|---|---|
| ID ditemukan (nickname terkonfirmasi) | Transaksi dilanjutkan | — |
| ID **tidak ditemukan** | **Ditolak** — pesan: "User ID game Anda tidak ditemukan. Periksa kembali User ID dan Zone/Server ID Anda, lalu coba lagi." | 422 |
| Verifikasi tidak dapat diselesaikan (gangguan/rate limit/saldo cek) | **Ditolak (fail-safe)** — "Verifikasi akun game sedang tidak dapat dilakukan. Silakan coba lagi beberapa saat." | 503 |
| Pembelian melebihi batas anti-penyalahgunaan (mis. Weekly Diamond Pass / bonus pertama) | **Ditolak** — pembelian di luar batas tidak diproses | 422 |

Mode gerbang: `off` / `log` / `enforce`. Sejak 17 Oktober 2026 berjalan di **`enforce`**. Perubahan mode hanya dapat dilakukan oleh administrator senior melalui endpoint khusus yang ter-audit, dan berlaku ≤ 30 detik — dapat dipantau dan dibalikkan kapan pun.

### 2.4 Cakupan

- **32 game** — terverifikasi via pemetaan API distributor (ID + Zone/Server sesuai ketentuan masing-masing game).
- **5 game** — tanpa API verifikasi yang tersedia dari distributor; ditangani sesuai **risk acceptance tertulis** dan terpantau di panel kesiapan internal.
- **Kategori non-game (voucher, pulsa, tagihan)** — tidak memiliki konsep User ID game; tidak termasuk lingkup keberatan.
- **Pembatasan anti-penyalahgunaan** — melampaui validasi keberadaan ID: pembelian yang melanggar batas event game (mis. bonus pembelian pertama, pass mingguan) ditolak sebelum pembayaran.

## 3. Jejak audit & bukti

**Pada setiap order tersimpan** (kolom audit, sejak 17 Oktober 2026):

| Kolom | Isi |
|---|---|
| `account_verification_status` | `verified` / `invalid` / `unavailable` / `limit_blocked` / `not_required` / `not_configured` / `skipped` |
| `account_check_provider` | penyedia verifikasi (mis. `melostore`) |
| `account_nickname` | nickname yang dikonfirmasi distributor |
| `account_verified_at` | waktu verifikasi |
| `account_region`, `account_limit_reason` | info pendukung |

**Bukti pihak ketiga**: `transaction_id` dari API distributor untuk pengecekan yang dilakukan — dapat ditunjukkan per transaksi.

**Bukti operasional internal**: panel kesiapan (readiness) administrator yang menampilkan status gerbang, cakupan game, dan celah pemetaan secara real-time; log audit perubahan mode; alarm otomatis (Telegram) untuk kondisi pengecualian (mis. saldo pengecekan habis) sehingga keadaan luar biasa tidak pernah senyap.

## 4. Pengujian & ketahanan

- **867 uji otomatis** dalam pipeline CI (termasuk ±40 uji khusus kebijakan verifikasi: matriks keputusan, regresi kasus nyata, kegagalan provider, cakupan).
- **Uji kasus nyata di produksi** (17–20 Oktober 2026):
  - Order dengan User ID valid → terverifikasi, nickname terkonfirmasi tercatat (contoh: nickname *`[___ — lihat order contoh]`*).
  - ID tidak valid → **ditolak 422 sebelum pembayaran**, tidak ada order yang terbentuk.
  - ID valid namun pembelian melanggar batas event → **ditolak 422**.
- **Rekonsiliasi berkala otomatis** (tiap 5 menit) terhadap status transaksi distributor, termasuk verifikasi ulang pesanan tertunda — mencegah transaksi menggantung tanpa keputusan.
- **Idempotensi distribusi** — transaksi yang sama tidak akan pernah terkirim dua kali ke distributor (kunci idempotensi per order).

## 5. Timeline implementasi

| Tanggal | Milestone |
|---|---|
| `[___]` | Pengajuan merchant awal; DOKU menolak dengan pertimbangan verifikasi User ID |
| 17 Okt 2026 | Gerbang verifikasi aktif di produksi (mode `enforce`); kolom audit terpasang; 32 game terpetakan |
| 17–20 Okt 2026 | Penguatan: pembatasan anti-penyalahgunaan per produk, antarmuka pemeriksaan pra-beli bagi pelanggan, ekspansi cakupan, uji kasus produksi |
| `[___]` | Dokumen ini disusun; pengajuan ulang |

## 6. Komitmen berkelanjutan

1. Gerbang tetap **wajib (enforce)** untuk seluruh transaksi top up game.
2. Setiap order menyimpan jejak verifikasi — siap diaudit kapan pun oleh DOKU.
3. Penambahan game baru mengikuti proses yang sama: pemetaan verifikasi terlebih dahulu; game tanpa API verifikasi tidak dijual sebelum tersedia atau mendapat risk acceptance tertulis.
4. Perubahan kebijakan verifikasi selalu melalui proses yang ter-audit dengan kemampuan pemulihan ≤ 30 detik.

## 7. Lampiran yang disertakan

> **[CHECKLIST OWNER — lengkapi sebelum kirim]**
>
> - [ ] Email penolakan DOKU asli (kutip pertimbangannya di bagian 2 bila berbeda)
> - [ ] Screenshot panel admin **order detail** dengan kolom `account_verification_status = verified` + nickname (contoh order sukses)
> - [ ] Screenshot **usaha checkout dengan ID invalid** dari situs (pesan penolakan 422 terlihat)
> - [ ] Screenshot panel **readiness** (status gerbang: enforce; cakupan game)
> - [ ] Screenshot panel **kill-switch** mode verifikasi (off/log/enforce)
> - [ ] Screenshot contoh query audit / daftar order dengan kolom verifikasi
> - [ ] Identitas usaha: NIB/akta, NPWP, alamat, kontak — sesuai daftar dokumen DOKU
> - [ ] URL situs + akun uji (sandbox) bila DOKU ingin mencoba sendiri: isi User ID valid `[___]` (Zone `[___]`) dan User ID asal-asalan untuk melihat penolakan
>
> Terakhir: periksa placeholder `[___]` di seluruh dokumen ini sebelum dikirim.

---

*Dokumen ini menggambarkan kondisi sistem per tanggal dokumen. Data teknis dapat didemonstrasikan melalui sesi bersama bila diperlukan.*
