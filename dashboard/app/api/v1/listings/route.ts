import { build402, extractPaymentHeader } from "@/lib/gateway/x402";
import { verifyPaymentMock } from "@/lib/gateway/arcium";

export const runtime = "edge";

const PRICE_LISTINGS = 2_000; // 0.002 USDC
const USDC_MINT      = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const MOCK_SYMBOLS = ["BTC","ETH","SOL","USDC","BNB","ADA","XRP","DOGE","AVAX","LINK"] as const;

export async function GET(req: Request): Promise<Response> {
  const { pathname } = new URL(req.url);

  const sig = extractPaymentHeader(req);
  if (!sig) return build402(pathname, PRICE_LISTINGS, "Top 10 cryptocurrency listings");

  const verification = await verifyPaymentMock(
    "MockSender1111111111111111111111111111111111",
    BigInt(PRICE_LISTINGS),
    USDC_MINT,
    PRICE_LISTINGS,
    process.env.PAYMENT_WALLET_ADDRESS ?? "GATEWAY_WALLET",
    USDC_MINT,
  );

  if (!verification.valid) {
    return Response.json({ error: "Payment verification failed" }, { status: 402 });
  }

  const cmcKey = process.env.CMC_API_KEY;

  if (!cmcKey) {
    return Response.json({
      data: Array.from({ length: 10 }, (_, i) => ({
        rank: i + 1,
        symbol: MOCK_SYMBOLS[i],
        price: 1_000 + Math.random() * 50_000,
      })),
      _source: "mock",
      _arciumProof: verification.arciumProof,
      _privacyMode: verification.mode,
    }, {
      headers: {
        "X-Arcium-Proof": verification.arciumProof,
        "X-Privacy-Mode": verification.mode,
        "X-Payment-Accepted": "true",
      },
    });
  }

  const upstream = await fetch(
    "https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?limit=10",
    { headers: { "X-CMC_PRO_API_KEY": cmcKey, Accept: "application/json" } },
  );

  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      "Content-Type": "application/json",
      "X-Arcium-Proof": verification.arciumProof,
      "X-Privacy-Mode": verification.mode,
      "X-Payment-Accepted": "true",
    },
  });
}
