import type { ReactNode } from "react";

/**
 * Navbar seragam di semua halaman.
 *
 * Elemen <header> memakai lebar penuh device supaya latar, garis bawah, dan
 * efek sticky menutup dari tepi ke tepi. Isinya dikunci ke lebar `.shell`
 * yang sama dengan konten halaman, jadi logo dan tombol tetap rata dengan
 * isi halaman dan antar halaman tidak berbeda lebar.
 */
export default function SiteHeader({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <header className={`site-header ${className}`.trim()}>
      <div className="shell site-header-inner">{children}</div>
    </header>
  );
}