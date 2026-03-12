import { Redis } from "@upstash/redis";

const UPSTASH_REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

let redis: Redis | null = null;
if (UPSTASH_REDIS_URL && UPSTASH_REDIS_TOKEN) {
    try {
        redis = new Redis({ url: UPSTASH_REDIS_URL, token: UPSTASH_REDIS_TOKEN });
    } catch {
        console.error("Failed to initialize Redis for quota tracking");
    }
}

const QUOTA_LIMITS: Record<string, number> = {
    free: 30,
    premium: -1,  // unlimited
    pro: -1,
    enterprise: -1,
};

const TTL_SECONDS = 35 * 24 * 60 * 60; // 35 days

// Lua script: atomically increment and enforce the limit.
// Returns the new count, or -1 if the limit was already reached.
const QUOTA_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
if current > tonumber(ARGV[1]) then
  redis.call('DECR', KEYS[1])
  return -1
end
return current
`;

function getMonthKey(machineId: string): string {
    const now = new Date();
    const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    return `quota:${machineId}:${month}`;
}

// In-memory fallback for development
const inMemoryQuota = new Map<string, { count: number; resetTime: number }>();

export interface QuotaResult {
    allowed: boolean;
    limit: number;
    used: number;
    remaining: number;
}

export async function checkAndIncrementQuota(machineId: string, tier: string): Promise<QuotaResult> {
    const limit = QUOTA_LIMITS[tier] ?? QUOTA_LIMITS.free;

    // Unlimited for paid tiers
    if (limit === -1) {
        return { allowed: true, limit: -1, used: 0, remaining: -1 };
    }

    const key = getMonthKey(machineId);

    if (redis) {
        // Atomic check-and-increment via Lua — no TOCTOU race
        const result = await redis.eval(QUOTA_LUA, [key], [String(limit), String(TTL_SECONDS)]) as number;
        if (result === -1) {
            return { allowed: false, limit, used: limit, remaining: 0 };
        }
        return { allowed: true, limit, used: result, remaining: limit - result };
    }

    // In-memory fallback (development only)
    const now = Date.now();
    const entry = inMemoryQuota.get(key);
    const resetTime = entry && now < entry.resetTime ? entry.resetTime : now + TTL_SECONDS * 1000;
    const current = entry && now < entry.resetTime ? entry.count : 0;

    if (current >= limit) {
        return { allowed: false, limit, used: current, remaining: 0 };
    }

    const newCount = current + 1;
    inMemoryQuota.set(key, { count: newCount, resetTime });
    return { allowed: true, limit, used: newCount, remaining: limit - newCount };
}

export async function getQuotaUsage(machineId: string, tier: string): Promise<QuotaResult> {
    const limit = QUOTA_LIMITS[tier] ?? QUOTA_LIMITS.free;

    if (limit === -1) {
        return { allowed: true, limit: -1, used: 0, remaining: -1 };
    }

    const key = getMonthKey(machineId);
    let used: number;

    if (redis) {
        used = (await redis.get<number>(key)) || 0;
    } else {
        const now = Date.now();
        const entry = inMemoryQuota.get(key);
        used = entry && now < entry.resetTime ? entry.count : 0;
    }

    return {
        allowed: used < limit,
        limit,
        used,
        remaining: Math.max(0, limit - used),
    };
}
