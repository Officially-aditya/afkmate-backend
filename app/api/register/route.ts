import { NextRequest, NextResponse } from "next/server";
import { createDeviceToken } from "../../utils/device-token";
import { getQuotaUsage } from "../../utils/quota";
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from "../../utils/rate-limit";

export async function POST(req: NextRequest) {
    // Rate limit registration attempts
    const clientId = getClientIdentifier(req);
    const rateLimit = await checkRateLimit(clientId, RATE_LIMITS.register);

    if (!rateLimit.success) {
        return NextResponse.json(
            { error: "Too many registration attempts. Please try again later." },
            { status: 429, headers: { "Retry-After": String(rateLimit.resetIn) } }
        );
    }

    try {
        let body: any;
        try {
            body = await req.json();
        } catch {
            return NextResponse.json(
                { error: "Invalid JSON in request body" },
                { status: 400 }
            );
        }

        const { machineId } = body;

        // Validate machineId
        if (!machineId || typeof machineId !== "string") {
            return NextResponse.json(
                { error: "machineId is required and must be a string" },
                { status: 400 }
            );
        }

        // VS Code machineId is a UUID-like hex string, typically 32-64 chars
        if (machineId.length < 16 || machineId.length > 128) {
            return NextResponse.json(
                { error: "Invalid machineId format" },
                { status: 400 }
            );
        }

        // Only allow alphanumeric, hyphens, underscores
        if (!/^[a-zA-Z0-9_-]+$/.test(machineId)) {
            return NextResponse.json(
                { error: "Invalid machineId characters" },
                { status: 400 }
            );
        }

        const token = await createDeviceToken(machineId, "free");
        const quota = await getQuotaUsage(machineId, "free");

        return NextResponse.json({
            token,
            tier: "free",
            quota: {
                limit: quota.limit,
                used: quota.used,
                remaining: quota.remaining,
            },
        });
    } catch (err) {
        console.error("Registration error:", err);
        return NextResponse.json(
            { error: "Registration failed" },
            { status: 500 }
        );
    }
}
