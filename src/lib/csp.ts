function midtransDomains() {
  const isProduction = process.env.NODE_ENV === "production";

  return {
    isProduction,
    script: isProduction
      ? "https://app.midtrans.com"
      : "https://app.sandbox.midtrans.com https://app.midtrans.com",
    connect: isProduction
      ? "https://api.midtrans.com"
      : "https://api.sandbox.midtrans.com https://api.midtrans.com",
  };
}

export function contentSecurityPolicy(nonce: string): string {
  const { isProduction, script, connect } = midtransDomains();

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "img-src 'self' data: blob: https://res.cloudinary.com https://*.googleusercontent.com https://*.ggpht.com",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    isProduction
      ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${script} https://challenges.cloudflare.com`
      : `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${script} https://challenges.cloudflare.com`,
    `connect-src 'self' https://*.supabase.co ${connect} https://api.digiflazz.com https://api.brevo.com https://gate.volsever.com https://challenges.cloudflare.com`,
    `frame-src ${script} https://*.midtrans.com https://challenges.cloudflare.com`,
    isProduction ? "upgrade-insecure-requests" : "",
  ]
    .filter(Boolean)
    .join("; ");
}
