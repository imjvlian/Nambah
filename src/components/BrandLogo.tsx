import Image from "next/image";
import Link from "next/link";
import { BRAND } from "@/lib/brand";

export type BrandLogoVariant = "horizontal" | "stacked" | "icon-only" | "mono";
export type BrandLogoProps = {
  variant?: BrandLogoVariant;
  className?: string;
  href?: string;
  ariaLabel?: string;
  showTagline?: boolean;
  size?: "sm" | "md" | "lg";
};
const MARK_SRC = "/logo/nambah-logo.svg";

export default function BrandLogo({
  variant = "horizontal",
  className = "",
  href,
  ariaLabel,
  showTagline = false,
  size = "md",
}: BrandLogoProps) {
  const label = ariaLabel ?? BRAND.name;
  const mark = (
    <Image
      src={MARK_SRC}
      alt=""
      width={80}
      height={59}
      priority={false}
      unoptimized
      className={`brand-logo__mark ${variant === "mono" ? "brand-logo__mark--mono" : ""}`}
      aria-hidden
    />
  );
  const wordmark = (
    <span className={`brand-logo__wordmark ${variant === "mono" ? "brand-logo__wordmark--mono" : ""}`}>{BRAND.name}</span>
  );
  const logo = (
    <div className={`brand-logo brand-logo--${variant} brand-logo--${size}`}>
      {mark}
      {variant !== "icon-only" && wordmark}
    </div>
  );
  const content = (
    <div className={`brand-logo-wrap ${className}`}>
      {logo}
      {showTagline && variant !== "icon-only" && <span className="brand-logo__tagline">{BRAND.tagline}</span>}
    </div>
  );
  if (href) return <Link href={href} aria-label={label} className="brand-logo-link">{content}</Link>;
  return content;
}