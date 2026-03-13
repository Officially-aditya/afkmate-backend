import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { user as userTable } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export class AuthError extends Error {
    constructor(
        public statusCode: number,
        message: string,
    ) {
        super(message);
        this.name = "AuthError";
    }
}

export interface AuthIdentity {
    userId: string;
    tier: "free" | "premium" | "premium_plus";
}

/**
 * Validate the BetterAuth session from the request and return the user identity.
 * Throws AuthError on failure.
 */
export async function requireAuth(req: Request): Promise<AuthIdentity> {
    const session = await auth.api.getSession({ headers: req.headers });

    if (!session) {
        throw new AuthError(401, "Unauthorized");
    }

    const row = await db
        .select({ tier: userTable.tier })
        .from(userTable)
        .where(eq(userTable.id, session.user.id))
        .limit(1);

    const tier = (row[0]?.tier as "free" | "premium" | "premium_plus") ?? "free";

    return { userId: session.user.id, tier };
}
