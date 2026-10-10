import assert from "node:assert/strict";
import test from "node:test";

/**
 * Loop section admin.
 *
 * Dashboard dan sidebar sama-sama perlu tahu section yang aktif. Awalnya
 * keduanya memegang salinan sendiri dan saling menulari: satu efek
 * mendorong nilai dashboard ke konteks, efek lain menarik nilai konteks
 * kembali ke dashboard. Dua arah itu tidak mungkin berhenti - begitu
 * keduanya beda sesaat, masing-masing memaksa yang lain kembali dalam
 * render berulang tanpa akhir, sampai React melaporkan
 * "Maximum update depth exceeded".
 *
 * Test ini tidak merender React - di repo ini tidak ada DOM. Yang
 * disimulasikan adalah hal yang menentukan React berhenti atau tidak:
 * nilai apa yang TERTUTUP oleh tiap efek pada sebuah render, dan apakah
 * ada penulisan state. React berhenti begitu satu render tidak lagi
 * mengubah apa pun, jadi loop terdeteksi tepat ketika penulisan itu
 * tidak pernah berhenti.
 *
 * Dua detail simulasi ini penting, dan keduanya dilewati versi pertama
 * test ini:
 *
 * 1. Efek memakai nilai yang tertutup render tersebut, BUKAN nilai
 *    global yang sudah berubah karena efek sebelumnya. Dua efek dalam satu
 *    render sama-sama melihat keadaan SEBELUM salah satunya menulis.
 * 2. Penulisan dengan nilai yang sama tidak menjadwalkan render lagi.
 *    Ini yang membuat desain yang benar berhenti sendiri, bukan terus.
 */

/** Identitas setter yang stabil, sama seperti `useCallback` di provider. */
const SETTER = "setSection";

type SectionId = string;

type Outcome = {
  /** Render yang menghasilkan penulisan state. Tanpa penulisan = selesai. */
  writes: number;
  finalSection: SectionId;
  finalContext: SectionId | null;
};

const LIMIT = 60;

function simulate(options: {
  design: "bridged" | "single-source";
  /** Isi konteks saat dashboard mount. */
  contextAtMount: SectionId | null;
  /** Isi query `?seksi=` saat dashboard mount. */
  query: SectionId | null;
}): Outcome {
  /*
   * Dua nilai terpisah, karena dua desain ini memang berbeda jumlah
   * salinan yang dipelihara. Dijadisatu variabel saja akan menghapus
   * justru perbedaan yang sedang diuji.
   *
   * - bridged: dashboard punya `dashboardSection` sendiri, PLUS salinan
   *   di `context`. Dua efek bridging menjaga keduanya sama.
   * - single-source: hanya `context`; nilai dashboard dihitung ulang
   *   tiap render dari `context`.
   */
  let dashboardSection = "overview";
  let context = options.contextAtMount;
  let writes = 0;

  // Dep terakhir tiap efek, persis yang React bandingkan antar render.
  let publishDeps: unknown[] | null = null;
  let adoptDeps: unknown[] | null = null;
  let seedDeps: unknown[] | null = null;

  const changed = (previous: unknown[] | null, next: unknown[]) =>
    previous === null ||
    next.length !== previous.length ||
    next.some((value, index) => !Object.is(value, previous[index]));

  for (let pass = 0; pass < LIMIT; pass++) {
    /*
     * Yang dilihat semua efek pada render ini. Diambil SEBELUM efek
     * apa pun berjalan, seperti closure yang dibuat React.
     */
    const renderDashboard =
      options.design === "bridged"
        ? dashboardSection
        : (context ?? "overview");
    const renderContext = context;
    let wrote = false;

    if (options.design === "bridged") {
      // Efek deep-link lama: deps [], hanya baris pertama saja.
      if (pass === 0 && options.query) {
        dashboardSection = options.query;
        wrote = true;
      }

      // Efek publish lama: dashboard -> konteks.
      const nextPublish = [renderDashboard, SETTER];
      if (changed(publishDeps, nextPublish)) {
        publishDeps = nextPublish;
        if (context !== renderDashboard) {
          context = renderDashboard;
          wrote = true;
        }
      }

      /*
       * Efek adopt lama: konteks -> dashboard. `section` ikut masuk dep
       *-nya, dan justru itulah yang membuat keduanya saling menabrak:
       * begitu adopt menulis, publish langsung menulis balik.
       */
      const nextAdopt = [renderContext, renderDashboard];
      if (changed(adoptDeps, nextAdopt)) {
        adoptDeps = nextAdopt;
        if (renderContext && renderContext !== renderDashboard) {
          dashboardSection = renderContext;
          wrote = true;
        }
      }
    } else {
      /*
       * Desain sekarang. Dashboard tidak punya state sendiri: ia
       * membaca konteks tiap render, jadi tidak ada nilai dashboard yang
       * bisa usang. Satu-satunya efek yang menulis adalah penabur awal,
       * dan hanya boleh jalan saat konteks masih kosong.
       */
      const nextSeed = [renderContext, SETTER];
      if (changed(seedDeps, nextSeed)) {
        seedDeps = nextSeed;
        if (context === null) {
          context = options.query ?? "overview";
          wrote = true;
        }
      }
    }

    if (!wrote) {
      const finalSection =
        options.design === "bridged"
          ? dashboardSection
          : (context ?? "overview");
      return { writes, finalSection, finalContext: context };
    }
    writes++;
  }

  const finalSection =
    options.design === "bridged" ? dashboardSection : (context ?? "overview");
  return { writes, finalSection, finalContext: context };
}

test("desain lama: deep-link memakai section != overview -> loop", () => {
  const result = simulate({
    design: "bridged",
    contextAtMount: "overview",
    query: "merchants",
  });

  assert.equal(
    result.writes,
    LIMIT,
    "efek publish dan adopt saling menimpa tanpa berhenti",
  );
});

test("desain lama: klik sidebar dari halaman terpisah -> loop", () => {
  const result = simulate({
    design: "bridged",
    contextAtMount: "catalog",
    query: "orders",
  });

  assert.equal(result.writes, LIMIT);
});

test("desain lama: Polaris justru yang aman, itu sebabnya bugnya intermiten", () => {
  // Konteks masih null, jadi efek adopt berhenti di guard falsy dan tidak
  // pernah menulis. Membuka /admin langsung selalu terlihat normal.
  const result = simulate({
    design: "bridged",
    contextAtMount: null,
    query: null,
  });

  assert.equal(result.writes, 1);
});

test("desain sekarang: semua titik mount selesai dalam satu langkah", () => {
  const cases: Array<[SectionId | null, SectionId | null]> = [
    [null, null],
    [null, "merchants"],
    ["catalog", "orders"],
    ["system", null],
  ];

  for (const [contextAtMount, query] of cases) {
    const result = simulate({ design: "single-source", contextAtMount, query });

    assert.ok(
      result.writes <= 1,
      `konteks=${String(contextAtMount)} query=${String(query)} menulis ${result.writes} kali`,
    );
  }
});

test("desain sekarang: deep-link dipakai dan tidak ditimpa render berikutnya", () => {
  const result = simulate({
    design: "single-source",
    contextAtMount: null,
    query: "merchants",
  });

  assert.equal(result.writes, 1);
  assert.equal(result.finalContext, "merchants");
  assert.equal(result.finalSection, "merchants");
});

test("desain sekarang: tanpa query tetap diisi Ringkasan, bukan null", () => {
  // Sidebar butuh section yang konkret. Kalau dibiarkan null, tidak ada
  // butir yang tersorot dan grup yang memegangnya tidak bisa terlipat.
  const result = simulate({
    design: "single-source",
    contextAtMount: null,
    query: null,
  });

  assert.equal(result.finalContext, "overview");
});

test("desain sekarang: tidak pernah bergantian walau konteks tidak kosong", () => {
  /*
   * Keadaan ini tidak terjadi di alur normal: efek pembersih menaruh
   * `null` saat dashboard turun, jadi konteks selalu kosong saat mount.
   *
   * Tapi diuji tetap, karena dua-duanya penting. Desain sekarang
   * TIDAK menulis apa pun di keadaan ini - ia menahan section yang ada.
   * Itu pilihan sadar: kalau penabur ikut menulis di sini, dia akan
   * bertabrakan dengan klik operator di sidebar, karena URL masih
   * memuat `?seksi=` lama yang tidak pernah ikut berubah.
   *
   * Yang paling penting: desain ini tidak loop. Section bisa tertahan
   * di tempat yang salah, tapi tidak pernah bergantian dua arah tanpa
   * akhir seperti desain lama.
   */
  const result = simulate({
    design: "single-source",
    contextAtMount: "catalog",
    query: "orders",
  });

  assert.equal(result.writes, 0);
  assert.equal(result.finalContext, "catalog");
});