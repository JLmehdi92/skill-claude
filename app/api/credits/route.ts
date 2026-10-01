import { creditsToEur } from "@/lib/costs";
import { kie } from "@/lib/kie";
import { errorMessage, fail, json } from "@/lib/server/http";
import { getUsdEurRate } from "@/lib/server/rates";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [credits, { rate }] = await Promise.all([kie().getCredits(), getUsdEurRate()]);
    return json({ credits, eur: creditsToEur(credits, rate) });
  } catch (err) {
    return fail(errorMessage(err), 502);
  }
}
