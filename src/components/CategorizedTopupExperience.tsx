"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Game } from "@/lib/catalog";

type ProductGroup = "hemat" | "populer" | "langganan" | "promo";
type GroupedPackage = Game["packages"][number] & { groups?: ProductGroup[] };
type ProductArtwork = {
  src: string;
  alt: string;
  kind: "nominal" | "cover";
};

type CatalogCategoryId =
  | "games"
  | "pulsa-data"
  | "e-wallet"
  | "pln"
  | "langganan"
  | "voucher"
  | "digital";

type CatalogCategory = {
  id: CatalogCategoryId;
  label: string;
  description: string;
  order: number;
  count: number;
};

type CategorizedTopupExperienceProps = {
  games: Game[];
  artworkByGameId?: Record<string, ProductArtwork | null>;
};

const CATEGORY_META: Record<
  CatalogCategoryId,
  Omit<CatalogCategory, "id" | "count">
> = {
  games: {
    label: "Games",
    description: "Top up game dan currency in-game",
    order: 0,
  },
  "pulsa-data": {
    label: "Pulsa & Data",
    description: "Pulsa, paket data, masa aktif, dan produk operator",
    order: 10,
  },
  "e-wallet": {
    label: "E-Wallet",
    description: "Saldo dan voucher dompet digital",
    order: 20,
  },
  pln: {
    label: "PLN",
    description: "Token dan kebutuhan listrik prabayar",
    order: 30,
  },
  langganan: {
    label: "Langganan",
    description: "Streaming, software, dan layanan berlangganan",
    order: 40,
  },
  voucher: {
    label: "Voucher",
    description: "Gift card, wallet, dan voucher digital",
    order: 50,
  },
  digital: {
    label: "Produk Digital",
    description: "Produk digital lainnya yang tersedia",
    order: 90,
  },
};

const CATEGORY_MARK: Record<CatalogCategoryId, string> = {
  games: "G",
  "pulsa-data": "P",
  "e-wallet": "E",
  pln: "L",
  langganan: "S",
  voucher: "V",
  digital: "D",
};

const GAME_PATTERN =
  /(mobile legends|free fire|pubg|valorant|honor of kings|genshin|honkai|zenless|wuthering|roblox|league of legends|wild rift|call of duty|codm|efootball|fc mobile|clash of clans|clash royale|point blank|arena of valor|aov|garena|diamonds?\b|\buc\b|robux|genesis crystals?|valorant points?)/i;
const TELCO_PATTERN =
  /(pulsa|paket\s*data|kuota|internet|masa\s*aktif|paket\s*(sms|telpon|telepon)|aktivasi\s*(perdana|voucher)|axis|telkomsel|simpati|by\.?u|indosat|im3|xl\b|tri\b|three\b|smartfren|live[ .-]?on)/i;
const EWALLET_PATTERN =
  /(e[ -]?wallet|e[ -]?money|dana\b|ovo\b|gopay|go-pay|shopeepay|linkaja|isaku|sakuku|brizzi|tapcash|flazz)/i;
const PLN_PATTERN = /(pln|token\s*listrik|listrik\s*prabayar)/i;
const SUBSCRIPTION_PATTERN =
  /(netflix|spotify|youtube\s*premium|vidio|viu\b|wetv|disney|prime\s*video|canva|capcut|office\s*365|microsoft\s*365|adobe|subscription|langganan|streaming)/i;
const VOUCHER_PATTERN =
  /(voucher|gift\s*card|steam\s*wallet|google\s*play|app\s*store|itunes|playstation|psn\b|xbox|nintendo|wallet\s*code)/i;

function groupsOf(item: Game["packages"][number]) {
  return ((item as GroupedPackage).groups ?? []) as ProductGroup[];
}

function searchableGameText(game: Game) {
  return [
    game.name,
    game.shortName,
    ...game.packages.flatMap((item) => [item.label, item.note ?? ""]),
  ]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function getCatalogCategoryId(game: Game): CatalogCategoryId {
  const text = searchableGameText(game);

  if (game.category === "game" || GAME_PATTERN.test(text)) return "games";
  if (TELCO_PATTERN.test(text)) return "pulsa-data";
  if (EWALLET_PATTERN.test(text)) return "e-wallet";
  if (PLN_PATTERN.test(text)) return "pln";
  if (SUBSCRIPTION_PATTERN.test(text)) return "langganan";
  if (VOUCHER_PATTERN.test(text)) return "voucher";
  if (game.category === "voucher") return "voucher";
  return "digital";
}

function buildCategories(games: Game[]): CatalogCategory[] {
  const counts = new Map<CatalogCategoryId, number>();

  for (const game of games) {
    const categoryId = getCatalogCategoryId(game);
    counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([id, count]) => ({ id, count, ...CATEGORY_META[id] }))
    .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label, "id"));
}

function popularityScore(game: Game) {
  return game.packages.reduce(
    (score, item) => score + (groupsOf(item).includes("populer") ? 1 : 0),
    0,
  );
}

function ProductArtworkMark({
  game,
  artwork,
  className,
}: {
  game: Game;
  artwork?: ProductArtwork | null;
  className: string;
}) {
  return (
    <span
      className={`${className} app-artwork`}
      style={{ background: game.accent, overflow: "hidden" }}
    >
      {artwork ? (
        <img
          src={artwork.src}
          alt={artwork.alt}
          loading="lazy"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : (
        game.initials
      )}
    </span>
  );
}

export default function CategorizedTopupExperience({
  games,
  artworkByGameId = {},
}: CategorizedTopupExperienceProps) {
  const router = useRouter();
  const categories = useMemo(() => buildCategories(games), [games]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<CatalogCategoryId>(
    categories[0]?.id ?? "games",
  );
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!categories.some((category) => category.id === selectedCategoryId)) {
      setSelectedCategoryId(categories[0]?.id ?? "games");
    }
  }, [categories, selectedCategoryId]);

  const selectedCategory =
    categories.find((category) => category.id === selectedCategoryId) ?? categories[0];

  const categoryGames = useMemo(
    () => games.filter((game) => getCatalogCategoryId(game) === selectedCategoryId),
    [games, selectedCategoryId],
  );

  const normalizedQuery = query.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!normalizedQuery) return [];
    return games.filter((game) => searchableGameText(game).toLowerCase().includes(normalizedQuery));
  }, [games, normalizedQuery]);

  const popularGames = useMemo(
    () =>
      games
        .map((game) => ({ game, score: popularityScore(game) }))
        .filter((item) => item.score > 0)
        .sort(
          (left, right) =>
            right.score - left.score || left.game.name.localeCompare(right.game.name, "id"),
        )
        .slice(0, 8)
        .map((item) => item.game),
    [games],
  );

  const visibleGames = normalizedQuery ? searchResults : categoryGames;

  function openProduct(game: Game) {
    router.push(`/product/${encodeURIComponent(game.id)}`);
  }

  if (!selectedCategory) return null;

  return (
    <>
      <section className="home-search-section" id="catalog-start">
        <div className="home-search-heading">
          <div>
            <span className="eyebrow">Cari produk</span>
            <strong>Apa yang mau kamu nambah?</strong>
          </div>
          <span>{games.length} produk tersedia</span>
        </div>

        <label className="home-search-box">
          <span className="home-search-icon" aria-hidden="true">⌕</span>
          <input
            aria-label="Cari produk"
            type="search"
            placeholder="Cari Mobile Legends, AXIS, DANA, Steam..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Hapus pencarian">×</button>
          )}
        </label>
      </section>

      {!normalizedQuery && popularGames.length > 0 && (
        <section className="home-popular-section" id="popular" aria-labelledby="popular-title">
          <div className="home-section-heading">
            <div>
              <span className="eyebrow">Paling dicari</span>
              <strong id="popular-title">Populer Sekarang</strong>
              <small>Shortcut ke produk yang paling sering dipilih.</small>
            </div>
            <span>{popularGames.length} pilihan</span>
          </div>

          <div className="home-popular-track">
            {popularGames.map((game, index) => {
              const category = CATEGORY_META[getCatalogCategoryId(game)];
              return (
                <button className="home-popular-card" key={game.id} type="button" onClick={() => openProduct(game)}>
                  <span className="home-popular-rank">{String(index + 1).padStart(2, "0")}</span>
                  <ProductArtworkMark
                    game={game}
                    artwork={artworkByGameId[game.id]}
                    className="home-popular-icon"
                  />
                  <span className="home-popular-copy">
                    <strong>{game.name}</strong>
                    <small>{category.label}</small>
                  </span>
                  <span className="home-popular-arrow" aria-hidden="true">↗</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {!normalizedQuery && (
        <section className="catalog-category-nav" aria-label="Kategori produk">
          <div className="home-section-heading catalog-category-header-v2">
            <div>
              <span className="eyebrow">Jelajahi</span>
              <strong>Kategori</strong>
              <small>{selectedCategory.description}</small>
            </div>
            <span>{categories.length} kategori</span>
          </div>

          <div className="catalog-category-tabs" role="tablist" aria-label="Pilih kategori produk">
            {categories.map((category) => (
              <button
                className={selectedCategoryId === category.id ? "active" : ""}
                key={category.id}
                type="button"
                role="tab"
                aria-selected={selectedCategoryId === category.id}
                onClick={() => setSelectedCategoryId(category.id)}
              >
                <i aria-hidden="true">{CATEGORY_MARK[category.id]}</i>
                <span>{category.label}</span>
                <b>{category.count}</b>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="home-catalog-results-heading" aria-live="polite">
        <div>
          <span className="eyebrow">Produk</span>
          <strong>{normalizedQuery ? "Hasil pencarian" : selectedCategory.label}</strong>
          <small>{normalizedQuery ? `Hasil untuk “${query.trim()}”` : selectedCategory.description}</small>
        </div>
        <span>{visibleGames.length} produk</span>
      </section>

      {visibleGames.length > 0 ? (
        <section className="catalog-section home-products-section" id="games">
          <div className="game-grid">
            {visibleGames.map((game) => {
              const category = CATEGORY_META[getCatalogCategoryId(game)];
              return (
                <button className="game-card" key={game.id} type="button" onClick={() => openProduct(game)}>
                  <ProductArtworkMark
                    game={game}
                    artwork={artworkByGameId[game.id]}
                    className="game-mark"
                  />
                  <span className="game-copy">
                    <strong>{game.name}</strong>
                    <small>{category.label}</small>
                  </span>
                  <span className="card-arrow" aria-hidden="true">↗</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : (
        <div className="empty-state home-search-empty">Tidak ada produk yang cocok. Coba nama game, operator, e-wallet, atau voucher lain.</div>
      )}
    </>
  );
}
