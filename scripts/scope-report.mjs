import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { canAccessRoute } from "../src/lib/admin-scope.ts";

// Laporan cakupan: daftar route per role, dibaca dari filesystem supaya
// hasilnya bisa dibandingkan dengan peta secara langsung.
const files = [];

const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (entry === "route.ts") {
      files.push("/api/admin/" + full.split("\\").slice(4, -1).join("/"));
    }
  }
};

walk("src/app/api/admin");
files.sort();

const boleh = [];
const tidak = [];

for (const path of files) {
  (canAccessRoute("admin", path) ? boleh : tidak).push(path);
}

console.log(`Total route admin: ${files.length}`);
console.log(`Boleh untuk admin: ${boleh.length}`);
console.log(`Tertutup untuk admin: ${tidak.length}`);
console.log(`Boleh untuk superadmin: ${files.filter((p) => canAccessRoute("superadmin", p)).length}`);

console.log("\nTERTUTUP untuk admin:");
for (const path of tidak) console.log("  " + path);

console.log("\nDIBUKA untuk admin:");
for (const path of boleh) console.log("  " + path);