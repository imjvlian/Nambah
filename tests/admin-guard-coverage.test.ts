import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ADMIN_ROUTE_DIR = "src/app/api/admin";
const CRON_ROUTE_DIR = "src/app/api/cron";
const ADMIN_ROUTES_WITHOUT_AUTHORIZATION = new Set(["/api/admin/session"]);

function listRouteFiles(
  root: string,
): Array<{ path: string; content: string }> {
  const found: Array<{ path: string; content: string }> = [];

  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry === "route.ts") {
        const segments = full.split(/[\\/]/);
        const routePath =
          "/" + segments.slice(segments.indexOf("app") + 1, -1).join("/");
        found.push({
          path: routePath,
          content: readFileSync(full, "utf8"),
        });
      }
    }
  };

  walk(root);
  return found.sort((left, right) => left.path.localeCompare(right.path));
}

test("setiap route admin memanggil authorizeAdminRequest", () => {
  const routes = listRouteFiles(ADMIN_ROUTE_DIR);
  assert.ok(routes.length >= 45, "pemindaian route admin tidak menemukan file");

  const missing = routes.filter((route) => {
    if (ADMIN_ROUTES_WITHOUT_AUTHORIZATION.has(route.path)) return false;
    return !route.content.includes("authorizeAdminRequest(");
  });

  assert.deepEqual(
    missing.map((route) => route.path),
    [],
    "route admin tanpa authorizeAdminRequest:\n" +
      missing.map((route) => route.path).join("\n"),
  );
});

test("setiap route cron memanggil authorizeCronRequest", () => {
  const routes = listRouteFiles(CRON_ROUTE_DIR);
  assert.ok(routes.length >= 8, "pemindaian route cron tidak menemukan file");

  const missing = routes.filter(
    (route) => !route.content.includes("authorizeCronRequest("),
  );

  assert.deepEqual(
    missing.map((route) => route.path),
    [],
    "route cron tanpa authorizeCronRequest:\n" +
      missing.map((route) => route.path).join("\n"),
  );
});
