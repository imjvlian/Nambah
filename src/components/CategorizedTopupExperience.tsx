"use client";

import { useEffect, useMemo, useState } from "react";
import TopupExperience from "@/components/TopupExperience";
import type { Game, PaymentMethod } from "@/lib/catalog";

type PublicPaymentMethod = Pick<PaymentMethod, "id" | "name" | "detail">;

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
  paymentMethods: PublicPaymentMethod[];
  catalogSource: "static" | "supabase";
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

export default function CategorizedTopupExperience({
  games,
  paymentMethods,
  catalogSource,
}: CategorizedTopupExperienceProps) {
  const categories = useMemo(() => buildCategories(games), [games]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<CatalogCategoryId>(
    categories[0]?.id ?? "games",
  );

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

  if (!selectedCategory || categoryGames.length === 0) {
    return null;
  }

  return (
    <>
      <section className="catalog-category-nav" aria-label="Kategori produk">
        <div className="catalog-category-header">
          <div>
            <span className="eyebrow">Kategori produk</span>
            <strong>{selectedCategory.label}</strong>
            <small>{selectedCategory.description}</small>
          </div>
          <span>{categories.length} kategori tersedia</span>
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
              <span>{category.label}</span>
              <b>{category.count}</b>
            </button>
          ))}
        </div>
      </section>

      <TopupExperience
        key={selectedCategoryId}
        games={categoryGames}
        paymentMethods={paymentMethods}
        catalogSource={catalogSource}
      />
    </>
  );
}
