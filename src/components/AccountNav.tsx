"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type AccountUser = {
  id: string;
  email: string;
  displayName: string;
};

type PointsSummary = {
  available: number;
};

export default function AccountNav({
  showPoints = false,
}: {
  showPoints?: boolean;
}) {
  const pathname = usePathname();
  const [user, setUser] = useState<AccountUser | null | undefined>(undefined);
  const [points, setPoints] = useState<number | null | undefined>(
    showPoints ? undefined : null,
  );

  useEffect(() => {
    let active = true;

    async function loadAccount() {
      try {
        const response = await fetch("/api/auth/me", {
          cache: "no-store",
          credentials: "same-origin",
        });

        if (!active) return;

        if (!response.ok) {
          setUser(null);
          setPoints(null);
          return;
        }

        const data = (await response.json()) as {
          user?: AccountUser | null;
        };
        const nextUser = data.user ?? null;
        setUser(nextUser);

        if (!nextUser || !showPoints) {
          setPoints(null);
          return;
        }

        try {
          const pointsResponse = await fetch("/api/account/points", {
            cache: "no-store",
            credentials: "same-origin",
          });
          const pointsData = (await pointsResponse.json()) as {
            points?: PointsSummary;
          };

          if (!active) return;

          setPoints(
            pointsResponse.ok && pointsData.points
              ? pointsData.points.available
              : null,
          );
        } catch {
          if (active) setPoints(null);
        }
      } catch {
        if (active) {
          setUser(null);
          setPoints(null);
        }
      }
    }

    void loadAccount();

    return () => {
      active = false;
    };
  }, [showPoints]);

  const next = pathname && pathname.startsWith("/") ? pathname : "/";

  if (user === undefined) {
    return (
      <span className="account-nav account-nav-loading" aria-hidden="true">
        •••
      </span>
    );
  }

  if (!user) {
    return (
      <a className="account-nav" href={"/login?next=" + encodeURIComponent(next)}>
        Masuk
      </a>
    );
  }

  return (
    <a
      className={
        "account-nav account-nav-user" +
        (showPoints ? " account-nav-user-with-points" : "")
      }
      href="/account"
      title={user.email}
    >
      <span>{user.displayName.slice(0, 1).toUpperCase()}</span>
      <b>{user.displayName}</b>

      {showPoints && (
        <em className="account-nav-points" aria-label="Nambah Points">
          <i>N+</i>
          <strong>
            {points === undefined
              ? "..."
              : (points ?? 0).toLocaleString("id-ID") + " pts"}
          </strong>
        </em>
      )}
    </a>
  );
}
