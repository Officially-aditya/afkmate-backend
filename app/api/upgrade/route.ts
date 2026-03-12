import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, getIdentityFromAuth } from "../../utils/auth";
import { createDeviceToken } from "../../utils/device-token";
import { getQuotaUsage } from "../../utils/quota";
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from "../../utils/rate-limit";
import { Redis } from "@upstash/redis";

const LEMONSQUEEZY_API_KEY = process.env.LEMONSQUEEZY_API_KEY;
const LEMONSQUEEZY_STORE_ID = process.env.LEMONSQUEEZY_STORE_ID;

// Redis client for license-to-device binding
const UPSTASH_REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
let redis: Redis | null = null;
if (UPSTASH_REDIS_URL && UPSTASH_REDIS_TOKEN) {
    try {
        redis = new Redis({ url: UPSTASH_REDIS_URL, token: UPSTASH_REDIS_TOKEN });
    } catch {
        console.error("Failed to initialize Redis for license binding");
    }
}

export async function POST(req: NextRequest) {
    // Rate limit upgrade attempts
    const clientId = getClientIdentifier(req);
    const rateLimit = await checkRateLimit(clientId, RATE_LIMITS.register);

    if (!rateLimit.success) {
        return NextResponse.json(
            { error: "Too many attempts. Please try again later." },
            { status: 429, headers: { "Retry-After": String(rateLimit.resetIn) } }
        );
    }

    // Require authentication
    const auth = await authenticateRequest(req);
    if (!auth.authenticated) {
        return NextResponse.json(
            { error: auth.message || "Authentication required" },
            { status: 401 }
        );
    }

    const identity = getIdentityFromAuth(auth);
    if (!identity) {
        return NextResponse.json(
            { error: "Could not determine device identity" },
            { status: 401 }
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

        const { licenseKey } = body;

        if (!licenseKey || typeof licenseKey !== "string") {
            return NextResponse.json(
                { error: "licenseKey is required" },
                { status: 400 }
            );
        }

        // Basic format guard — LemonSqueezy keys are alphanumeric + hyphens, max ~200 chars
        if (licenseKey.length > 200 || !/^[a-zA-Z0-9_-]+$/.test(licenseKey)) {
            return NextResponse.json(
                { error: "Invalid license key format" },
                { status: 400 }
            );
        }

        // Check whether this license key is already bound to a different device
        if (redis) {
            const bindingKey = `license:${licenseKey}`;
            const existingMachineId = await redis.get<string>(bindingKey);
            if (existingMachineId && existingMachineId !== identity.machineId) {
                return NextResponse.json(
                    { error: "License key is already activated on another device" },
                    { status: 403 }
                );
            }
        }

        // Validate license key with LemonSqueezy API
        const validation = await validateLemonSqueezyLicense(licenseKey);

        if (!validation.valid) {
            return NextResponse.json(
                { error: validation.error || "Invalid license key" },
                { status: 403 }
            );
        }

        // Bind this license key to the device (permanent — one key, one device)
        if (redis) {
            const bindingKey = `license:${licenseKey}`;
            // NX = only set if not already present (handles concurrent upgrade requests)
            await redis.set(bindingKey, identity.machineId, { nx: true });
        }

        // Issue a new token with premium tier for the same device
        const newToken = await createDeviceToken(identity.machineId, "premium");
        const quota = await getQuotaUsage(identity.machineId, "premium");

        return NextResponse.json({
            token: newToken,
            tier: "premium",
            quota: {
                limit: quota.limit,
                used: quota.used,
                remaining: quota.remaining,
            },
        });
    } catch (err) {
        console.error("Upgrade error:", err);
        return NextResponse.json(
            { error: "Upgrade failed" },
            { status: 500 }
        );
    }
}

async function validateLemonSqueezyLicense(
    licenseKey: string
): Promise<{ valid: boolean; error?: string }> {
    if (!LEMONSQUEEZY_API_KEY) {
        console.error("LEMONSQUEEZY_API_KEY not configured");
        return { valid: false, error: "License validation unavailable" };
    }

    try {
        const res = await fetch("https://api.lemonsqueezy.com/v1/licenses/validate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ license_key: licenseKey }),
        });

        if (!res.ok) {
            return { valid: false, error: "License validation request failed" };
        }

        const data = await res.json();

        if (!data.valid) {
            return { valid: false, error: data.error || "License key is not valid" };
        }

        // Optionally check store ID matches
        if (LEMONSQUEEZY_STORE_ID && data.meta?.store_id?.toString() !== LEMONSQUEEZY_STORE_ID) {
            return { valid: false, error: "License key does not belong to this product" };
        }

        return { valid: true };
    } catch (err) {
        console.error("LemonSqueezy API error:", err);
        return { valid: false, error: "License validation service error" };
    }
}
