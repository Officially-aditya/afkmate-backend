import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { user as userTable } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";

type Tier = "free" | "premium" | "premium_plus";

function toSafeString(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function parseVariantId(payload: any): string {
    const attrs = payload?.data?.attributes ?? {};
    const firstOrderItem = attrs?.first_order_item ?? {};
    const variantRaw =
        firstOrderItem?.variant_id ??
        attrs?.variant_id ??
        attrs?.product_variant_id ??
        payload?.meta?.custom_data?.variant_id;

    return variantRaw === undefined || variantRaw === null ? "" : String(variantRaw);
}

function resolveTierFromPayload(payload: any): Tier {
    const premiumVariantId = toSafeString(process.env.LEMONSQUEEZY_PREMIUM_VARIANT_ID);
    const powerVariantId = toSafeString(process.env.LEMONSQUEEZY_PREMIUM_PLUS_VARIANT_ID);
    const variantId = parseVariantId(payload);

    if (variantId && powerVariantId && variantId === powerVariantId) {
        return "premium_plus";
    }
    if (variantId && premiumVariantId && variantId === premiumVariantId) {
        return "premium";
    }

    // Default to premium when we cannot map a specific variant.
    return "premium";
}

export async function POST(req: NextRequest) {
    try {
        const signature = req.headers.get("x-signature");
        const webhookSecret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;

        if (!webhookSecret) {
            console.error("LEMONSQUEEZY_WEBHOOK_SECRET not configured");
            return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
        }

        const rawBody = await req.text();

        // Verify signature
        const hmac = crypto.createHmac("sha256", webhookSecret);
        hmac.update(rawBody);
        const expectedSignature = hmac.digest("hex");

        if (!signature || !crypto.timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(expectedSignature),
        )) {
            return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
        }

        const payload = JSON.parse(rawBody);
        const eventName = payload.meta?.event_name;

        if (eventName === "order_created") {
            const email = payload.data?.attributes?.user_email;
            if (!email) {
                console.error("order_created event missing user_email");
                return NextResponse.json({ error: "Missing email in payload" }, { status: 400 });
            }

            const targetTier = resolveTierFromPayload(payload);

            const rows = await db
                .select({ id: userTable.id })
                .from(userTable)
                .where(eq(userTable.email, email))
                .limit(1);

            if (rows.length > 0) {
                await db
                    .update(userTable)
                    .set({ tier: targetTier, updatedAt: new Date() })
                    .where(eq(userTable.id, rows[0].id));

                console.log(`Upgraded user ${rows[0].id.slice(0, 8)}... to tier=${targetTier}`);
            } else {
                // User paid but their checkout email doesn't match any AFKmate account.
                // Log the order ID so it can be manually reconciled.
                const orderId = payload.data?.id ?? "unknown";
                console.error(
                    `[webhook] order_created: no AFKmate account for email="${email}" orderId=${orderId} tier=${targetTier}. ` +
                    `User may have used a different email at checkout. Reconcile manually.`
                );
            }
        } else if (eventName === "subscription_cancelled" || eventName === "subscription_expired" || eventName === "order_refunded") {
            const email = payload.data?.attributes?.user_email;
            if (email) {
                const rows = await db
                    .select({ id: userTable.id })
                    .from(userTable)
                    .where(eq(userTable.email, email))
                    .limit(1);

                if (rows.length > 0) {
                    await db
                        .update(userTable)
                        .set({ tier: "free", updatedAt: new Date() })
                        .where(eq(userTable.id, rows[0].id));

                    console.log(`Downgraded user ${rows[0].id.slice(0, 8)}... to tier=free (event=${eventName})`);
                }
            }
        }

        return NextResponse.json({ received: true });
    } catch (err) {
        console.error("Webhook error:", err);
        return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
    }
}
