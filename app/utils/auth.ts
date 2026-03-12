import { NextRequest } from "next/server";
import { verifyDeviceToken, DeviceTokenPayload } from "./device-token";
import { parseToken, TokenPayload } from "./token";

export interface AuthResult {
    authenticated: boolean;
    type?: "device" | "legacy";
    devicePayload?: DeviceTokenPayload;
    legacyPayload?: TokenPayload;
    message?: string;
}

export async function authenticateRequest(req: NextRequest): Promise<AuthResult> {
    const authHeader = req.headers.get("authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return { authenticated: false, message: "Missing or invalid Authorization header" };
    }

    const token = authHeader.slice(7).trim();

    if (!token) {
        return { authenticated: false, message: "Empty token" };
    }

    // Device JWTs start with "eyJ" (base64-encoded JSON header)
    if (token.startsWith("eyJ")) {
        const result = await verifyDeviceToken(token);
        if (result.valid && result.payload) {
            return { authenticated: true, type: "device", devicePayload: result.payload };
        }
        return { authenticated: false, message: result.message || "Invalid device token" };
    }

    // Legacy AFKMATE-{tier}-... tokens
    if (token.startsWith("AFKMATE-")) {
        const result = parseToken(token);
        if (result.valid && result.payload) {
            return { authenticated: true, type: "legacy", legacyPayload: result.payload };
        }
        return { authenticated: false, message: result.message || "Invalid token" };
    }

    return { authenticated: false, message: "Unrecognized token format" };
}

/** Extract the machineId and tier regardless of token type */
export function getIdentityFromAuth(auth: AuthResult): { machineId: string; tier: string } | null {
    if (!auth.authenticated) return null;

    if (auth.type === "device" && auth.devicePayload) {
        return { machineId: auth.devicePayload.machineId, tier: auth.devicePayload.tier };
    }

    if (auth.type === "legacy" && auth.legacyPayload) {
        return { machineId: auth.legacyPayload.userId, tier: auth.legacyPayload.tier };
    }

    return null;
}
