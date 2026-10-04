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

type AdminRole = "admin" | "superadmin";

export default function AccountNav({
  showPoints = true,
}: {
  showPoints?: boolean;
}) {
  const pathname = usePathname();
  const [user, setUser] = useState<AccountUser | null | undefined>(undefined);
  const [points, setPoints] = useState<number | null | undefined>(
    showPoints ? undefined : null,
  );
  const [adminRole, setAdminRole] = useState<AdminRole | null>(null);

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
          setAdminRole(null);
          return;
        }

        const data = (await response.json()) as {
          user?: AccountUser | null;
        };
        const nextUser = data.user ?? null;
        setUser(nextUser);

        if (!nextUser) {
          setPoints(null);
          setAdminRole(null);
          return;
        }

        const requests: Promise<Response>[] = [
          fetch("/api/admin/session", {
            cache: "no-store",
            credentials: "same-origin",
          }),
        ];

        if (showPoints) {
          requests.push(
            fetch("/api/account/points", {
              cache: "no-store",
              credentials: "same-origin",
            }),
          );
        }

        const results = await Promise.allSettled(requests);
        if (!active) return;

        const adminResult = results[0];
        if (adminResult?.status === "fulfilled") {
          try {
            const adminData = (await adminResult.value.json()) as {
              authenticated?: boolean;
              role?: string;
            };
            const role =
              adminData.authenticated &&
              (adminData.role === "admin" || adminData.role === "superadmin")
                ? adminData.role
                : null;
            setAdminRole(role);
          } catch {
            setAdminRole(null);
          }
        } else {
          setAdminRole(null);
        }

        if (!showPoints) {
          setPoints(null);
          return;
        }

        const pointsResult = results[1];
        if (pointsResult?.status !== "fulfilled") {
          setPoints(null);
          return;
        }

        try {
          const pointsData = (await pointsResult.value.json()) as {
            points?: PointsSummary;
          };
          setPoints(
            pointsResult.value.ok && pointsData.points
              ? pointsData.points.available
              : null,
          );
        } catch {
          setPoints(null);
        }
      } catch {
        if (active) {
          setUser(null);
          setPoints(null);
          setAdminRole(null);
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
    <div className="account-nav-cluster">
      {adminRole && (
        <a
          className="account-admin-route"
          href="/admin"
          title={`Buka admin dashboard · ${adminRole}`}
        >
          <span aria-hidden="true">AD</span>
          <b>Dashboard</b>
        </a>
      )}

      {showPoints && (
        <a
          className="account-header-points"
          href="/account#nambah-points"
          aria-label={`Nambah Points: ${points ?? 0} points`}
          title="Nambah Points"
        >
          <i aria-hidden="true">N+</i>
          <strong>
            {points === undefined
              ? "..."
              : (points ?? 0).toLocaleString("id-ID")}
          </strong>
          <small>pts</small>
        </a>
      )}

      <a
        className="account-nav account-nav-user"
        href="/account"
        title={user.email}
      >
        <span>{user.displayName.slice(0, 1).toUpperCase()}</span>
        <b>{user.displayName}</b>
      </a>
    </div>
  );
}
