import { build402, extractPaymentHeader } from "@/lib/gateway/x402";
import { verifyPaymentMock } from "@/lib/gateway/arcium";

export const runtime = "edge";

const PRICE_QUOTE = 1_000; // 0.001 USDC
const USDC_MINT   = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ symbol: string }> },
): Promise<Response> {
  const { symbol: rawSymbol } = await params;
  const symbol = rawSymbol.toUpperCase();
  const { pathname } = new URL(req.url);

  const sig = extractPaymentHeader(req);
  if (!sig) return build402(pathname, PRICE_QUOTE, `Real-time price for ${symbol}`);

  const verification = await verifyPaymentMock(
    "MockSender1111111111111111111111111111111111",
    BigInt(PRICE_QUOTE),
    USDC_MINT,
    PRICE_QUOTE,
    process.env.PAYMENT_WALLET_ADDRESS ?? "GATEWAY_WALLET",
    USDC_MINT,
  );

  if (!verification.valid) {
    return Response.json({ error: "Payment verification failed" }, { status: 402 });
  }

  const cmcKey = process.env.CMC_API_KEY;

  if (!cmcKey) {
    return Response.json({
      data: {
        [symbol]: {
          quote: {
            USD: {
              price: 50_000 + Math.random() * 5_000,
              volume_24h: 1_000_000_000,
              percent_change_24h: (Math.random() - 0.5) * 10,
              last_updated: new Date().toISOString(),
            },
          },
        },
      },
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
    `https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?symbol=${encodeURIComponent(symbol)}`,
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
