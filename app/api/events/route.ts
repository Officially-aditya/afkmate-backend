import { NextRequest } from "next/server";
import { requireAuth, AuthError } from "../../utils/auth";
import { getQuotaUsage } from "../../utils/quota";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    let userId: string;
    let tier: "free" | "premium" | "premium_plus";

    try {
        const identity = await requireAuth(req);
        userId = identity.userId;
        tier = identity.tier;
    } catch (err) {
        if (err instanceof AuthError) {
            return new Response(JSON.stringify({ error: err.message }), {
                status: err.statusCode,
                headers: { "Content-Type": "application/json" },
            });
        }
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const send = (event: string, data: unknown) => {
                controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
            };

            // Send initial quota state
            try {
                const quota = await getQuotaUsage(userId, tier);
                send("quota", { tier, quota });
            } catch {
                send("error", { message: "Failed to fetch quota" });
            }

            // Heartbeat every 30s to keep the connection alive
            const heartbeat = setInterval(async () => {
                try {
                    controller.enqueue(encoder.encode(": heartbeat\n\n"));
                    const currentQuota = await getQuotaUsage(userId, tier);
                    send("quota", { tier, quota: currentQuota });
                } catch {
                    clearInterval(heartbeat);
                }
            }, 30_000);

            // Clean up when the client disconnects
            req.signal.addEventListener("abort", () => {
                clearInterval(heartbeat);
                try {
                    controller.close();
                } catch {
                    // Already closed
                }
            });
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        },
    });
}
