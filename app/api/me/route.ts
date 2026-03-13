import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "../../utils/auth";
import { getQuotaUsage } from "../../utils/quota";
import { db } from "@/lib/db";
import { user as userTable } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(req: NextRequest) {
    try {
        const { userId, tier } = await requireAuth(req);

        const rows = await db
            .select({
                id: userTable.id,
                name: userTable.name,
                email: userTable.email,
                image: userTable.image,
                tier: userTable.tier,
            })
            .from(userTable)
            .where(eq(userTable.id, userId))
            .limit(1);

        const user = rows[0];
        if (!user) {
            return NextResponse.json({ error: "User not found" }, { status: 404 });
        }

        const quota = await getQuotaUsage(userId, tier);

        return NextResponse.json({
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image,
            tier: user.tier,
            quota: {
                limit: quota.limit,
                used: quota.used,
                remaining: quota.remaining,
            },
        });
    } catch (err) {
        if (err instanceof AuthError) {
            return NextResponse.json({ error: err.message }, { status: err.statusCode });
        }
        console.error("GET /api/me error:", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

export async function PATCH(req: NextRequest) {
    try {
        const { userId } = await requireAuth(req);
        const body = await req.json();
        const name = typeof body.username === "string" ? body.username.trim().slice(0, 50) : undefined;
        if (!name) {
            return NextResponse.json({ error: "Invalid username" }, { status: 400 });
        }
        await db
            .update(userTable)
            .set({ name, updatedAt: new Date() })
            .where(eq(userTable.id, userId));
        return NextResponse.json({ success: true });
    } catch (err) {
        if (err instanceof AuthError) {
            return NextResponse.json({ error: err.message }, { status: err.statusCode });
        }
        console.error("PATCH /api/me error:", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
