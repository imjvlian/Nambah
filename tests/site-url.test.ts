import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveSiteOrigin,
  resolveSiteUrl,
} from "../src/lib/site-url.ts";

function makeRequest(options: {
  siteUrl?: string;
  forwardedProto?: string;
  forwardedHost?: string;
  realHost?: string;
} = {}) {
  const headers = new Headers();
  if (options.forwardedProto) {
    headers.set("x-forwarded-proto", options.forwardedProto);
  }
  if (options.forwardedHost) {
    headers.set("x-forwarded-host", options.forwardedHost);
  }
  const url = options.realHost
    ? `http://${options.realHost}/api/auth/google`
    : "http://127.0.0.1:3000/api/auth/google";
  return new Request(url, { headers });
}

const ORIGINAL_SITE_URL = process.env.SITE_URL;

test("SITE_URL dipercaya sewaktu ada, tanpa slash belakang", () => {
  process.env.SITE_URL = "https://nambah.my.id/";
  try {
    const origin = resolveSiteOrigin(makeRequest());
    assert.equal(origin, "https://nambah.my.id");
  } finally {
    restoreEnv();
  }
});

test("SITE_URL yang tanpa protocol diparse sebagai https", () => {
  process.env.SITE_URL = "nambah.my.id";
  try {
    assert.equal(resolveSiteOrigin(makeRequest()), "https://nambah.my.id");
  } finally {
    restoreEnv();
  }
});

test("nilai SITE_URL tak valid diabaikan, bukan dipaksakan", () => {
  process.env.SITE_URL = "ftp://nambah.my.id";
  try {
    const origin = resolveSiteOrigin(makeRequest({
      forwardedProto: "https",
      forwardedHost: "nambah.my.id",
    }));
    assert.equal(origin, "https://nambah.my.id");
  } finally {
    restoreEnv();
  }
});

test("SITE_URL kosong masuk fallback ke forwarded headers", () => {
  process.env.SITE_URL = "   ";
  try {
    const origin = resolveSiteOrigin(makeRequest({
      forwardedProto: "https",
      forwardedHost: "nambah.my.id",
    }));
    assert.equal(origin, "https://nambah.my.id");
  } finally {
    restoreEnv();
  }
});

test("forwarded header dengan banyak nilai pakai yang pertama", () => {
  process.env.SITE_URL = "";
  try {
    const origin = resolveSiteOrigin(makeRequest({
      forwardedProto: "https,http",
      forwardedHost: "nambah.my.id, internal.example",
    }));
    assert.equal(origin, "https://nambah.my.id");
  } finally {
    restoreEnv();
  }
});

test("tanpa SITE_URL dan tanpa header, pakai origin request", () => {
  process.env.SITE_URL = "";
  try {
    const origin = resolveSiteOrigin(makeRequest({ realHost: "localhost:3000" }));
    assert.equal(origin, "http://localhost:3000");
  } finally {
    restoreEnv();
  }
});

test("resolveSiteUrl menambahkan satu slash depan", () => {
  process.env.SITE_URL = "https://nambah.my.id";
  try {
    assert.equal(resolveSiteUrl(makeRequest(), "/api/auth/google/callback"),
      "https://nambah.my.id/api/auth/google/callback");
    assert.equal(resolveSiteUrl(makeRequest(), "login"),
      "https://nambah.my.id/login");
  } finally {
    restoreEnv();
  }
});

function restoreEnv() {
  if (ORIGINAL_SITE_URL === undefined) {
    delete process.env.SITE_URL;
  } else {
    process.env.SITE_URL = ORIGINAL_SITE_URL;
  }
}