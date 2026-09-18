"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type AccountUser = {
  id: string;
  email: string;
  displayName: string;
};

export default function AccountNav() {
  const pathname = usePathname();
  const [user, setUser] = useState<AccountUser | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void fetch("/api/auth/me", {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (response) => {
        if (!active) return;
        if (!response.ok) {
          setUser(null);
          return;
        }
        const data = (await response.json()) as { user?: AccountUser | null };
        setUser(data.user ?? null);
      })
      .catch(() => {
        if (active) setUser(null);
      });

    return () => {
      active = false;
    };
  }, []);

  const next = pathname && pathname.startsWith("/") ? pathname : "/";
  if (user === undefined) {
    return <span className="account-nav account-nav-loading" aria-hidden="true">•••</span>;
  }

  if (!user) {
    return (
      <a className="account-nav" href={`/login?next=${encodeURIComponent(next)}`}>
        Masuk
      </a>
    );
  }

  return (
    <a className="account-nav account-nav-user" href="/account" title={user.email}>
      <span>{user.displayName.slice(0, 1).toUpperCase()}</span>
      <b>{user.displayName}</b>
    </a>
  );
}
