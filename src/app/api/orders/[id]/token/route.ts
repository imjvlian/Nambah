export const runtime = "nodejs";

// Access tokens are issued only while creating an order. A public endpoint that
// mints a token from an Order ID would defeat the access-control boundary.
export async function GET() {
  return Response.json({ error: "Endpoint tidak tersedia." }, { status: 404 });
}
