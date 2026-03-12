import { SignJWT, jwtVerify, JWTPayload } from "jose";

const TOKEN_SECRET = process.env.AFKMATE_TOKEN_SECRET;
const IS_PRODUCTION = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";

if (IS_PRODUCTION && !TOKEN_SECRET) {
    console.error("FATAL: AFKMATE_TOKEN_SECRET environment variable is not set!");
}

const EFFECTIVE_SECRET = TOKEN_SECRET || (IS_PRODUCTION ? "" : "dev-only-secret-do-not-use-in-prod");
const secret = new TextEncoder().encode(EFFECTIVE_SECRET);

export type Tier = "free" | "premium" | "pro" | "enterprise";

export interface DeviceTokenPayload extends JWTPayload {
    machineId: string;
    tier: Tier;
}

export async function createDeviceToken(machineId: string, tier: Tier = "free"): Promise<string> {
    if (!EFFECTIVE_SECRET) {
        throw new Error("Cannot create device tokens: AFKMATE_TOKEN_SECRET not configured");
    }

    return new SignJWT({ machineId, tier })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("1y")
        .setIssuer("afkmate")
        .sign(secret);
}

export async function verifyDeviceToken(token: string): Promise<{ valid: boolean; payload?: DeviceTokenPayload; message?: string }> {
    if (!token || typeof token !== "string") {
        return { valid: false, message: "Token is required" };
    }

    if (!EFFECTIVE_SECRET) {
        return { valid: false, message: "Token verification unavailable" };
    }

    try {
        const { payload } = await jwtVerify(token, secret, { issuer: "afkmate" });

        if (!payload.machineId || typeof payload.machineId !== "string") {
            return { valid: false, message: "Invalid token payload" };
        }

        return {
            valid: true,
            payload: payload as DeviceTokenPayload
        };
    } catch (err) {
        if (err instanceof Error && err.message.includes("expired")) {
            return { valid: false, message: "Token has expired" };
        }
        return { valid: false, message: "Invalid token" };
    }
}
