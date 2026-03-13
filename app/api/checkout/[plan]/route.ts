import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const VARIANT_IDS: Record<string, string | undefined> = {
    premium: process.env.LEMONSQUEEZY_PREMIUM_VARIANT_ID,
    "premium-plus": process.env.LEMONSQUEEZY_PREMIUM_PLUS_VARIANT_ID,
};

/**
 * GET /api/checkout/premium
 * GET /api/checkout/premium-plus
 *
 * Requires an authenticated session. Unauthenticated users are redirected to
 * /login?next=/api/checkout/<plan> so they sign in first, then land here.
 *
 * Fetches the canonical buy_now_url from the LemonSqueezy API and redirects,
 * pre-filling the checkout email from the user's AFKmate account to prevent
 * email mismatch (which would silently leave the user on the free tier).
 */
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ plan: string }> }
) {
    const { plan } = await params;
    const variantId = VARIANT_IDS[plan];

    if (!variantId) {
        return NextResponse.json(
            { error: `Unknown plan "${plan}". Valid plans: premium, premium-plus` },
            { status: 400 }
        );
    }

    // Require authentication — unauthenticated users must sign in first so
    // we can pre-fill their email and guarantee the webhook maps correctly.
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user) {
        const next = encodeURIComponent(`/api/checkout/${plan}`);
        return NextResponse.redirect(new URL(`/login?next=${next}`, req.url));
    }

    const apiKey = process.env.LEMONSQUEEZY_API_KEY;
    if (!apiKey) {
        return NextResponse.json({ error: "Checkout not configured" }, { status: 500 });
    }

    const storeId = process.env.LEMONSQUEEZY_STORE_ID;
    if (!storeId) {
        return NextResponse.json({ error: "Checkout not configured" }, { status: 500 });
    }

    // Create a checkout session via LemonSqueezy API so we can pre-fill the
    // user's email and guarantee the webhook maps to the right account.
    const email = session.user.email;
    const lsRes = await fetch("https://api.lemonsqueezy.com/v1/checkouts", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/vnd.api+json",
            "Content-Type": "application/vnd.api+json",
        },
        body: JSON.stringify({
            data: {
                type: "checkouts",
                attributes: {
                    checkout_data: {
                        email,
                    },
                },
                relationships: {
                    store: {
                        data: { type: "stores", id: String(storeId) },
                    },
                    variant: {
                        data: { type: "variants", id: String(variantId) },
                    },
                },
            },
        }),
    });

    if (!lsRes.ok) {
        const body = await lsRes.text();
        console.error(`LemonSqueezy checkout creation failed: ${lsRes.status} — ${body}`);
        return NextResponse.json({ error: "Failed to create checkout" }, { status: 502 });
    }

    const data = await lsRes.json();
    const checkoutUrl: string | undefined = data?.data?.attributes?.url;

    if (!checkoutUrl) {
        console.error("No checkout URL in LemonSqueezy response:", JSON.stringify(data));
        return NextResponse.json({ error: "Checkout URL not available" }, { status: 502 });
    }

    return NextResponse.redirect(checkoutUrl, { status: 302 });
}
