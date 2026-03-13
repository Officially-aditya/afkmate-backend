/**
 * Rate limiting implementation with Redis (Upstash) support
 * 
 * PRODUCTION SETUP:
 * 1. Create Redis database at https://console.upstash.com/redis
 * 2. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN env vars
 * 3. Rate limiting will automatically use Redis
 * 
 * FALLBACK:
 * If Upstash env vars are not set, falls back to in-memory rate limiting
 * (suitable for development only)
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export interface RateLimitConfig {
    /** Max requests per window */
    limit: number;
    /** Window size in seconds */
    windowSec: number;
}

export interface RateLimitResult {
    success: boolean;
    limit: number;
    remaining: number;
    resetIn: number; // seconds until reset
}

// Check if Upstash is configured
const UPSTASH_REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const USE_REDIS = !!(UPSTASH_REDIS_URL && UPSTASH_REDIS_TOKEN);

// Initialize Redis client if configured
let redis: Redis | null = null;
let rateLimiters: Map<string, Ratelimit> = new Map();

if (USE_REDIS) {
    try {
        redis = new Redis({
            url: UPSTASH_REDIS_URL!,
            token: UPSTASH_REDIS_TOKEN!,
        });
        console.log("✅ Rate limiting: Using Upstash Redis (distributed)");
    } catch (error) {
        console.error("Failed to initialize Upstash Redis:", error);
        console.warn("⚠️  Falling back to in-memory rate limiting");
    }
} else {
    console.warn("⚠️  Rate limiting: Using in-memory (not suitable for production scale)");
    console.warn("   Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN for distributed rate limiting");
}

/**
 * Get or create a rate limiter for specific configuration
 */
function getRateLimiter(config: RateLimitConfig): Ratelimit | null {
    if (!redis) return null;

    const key = `${config.limit}-${config.windowSec}`;
    
    if (!rateLimiters.has(key)) {
        const limiter = new Ratelimit({
            redis,
            limiter: Ratelimit.slidingWindow(config.limit, `${config.windowSec}s`),
            analytics: true,
            prefix: "ratelimit",
        });
        rateLimiters.set(key, limiter);
    }

    return rateLimiters.get(key)!;
}

// ============================================================================
// IN-MEMORY FALLBACK (for development or when Redis is not configured)
// ============================================================================

interface RateLimitEntry {
    count: number;
    resetTime: number;
}

const inMemoryStore = new Map<string, RateLimitEntry>();

// Clean up old entries periodically (only if using in-memory)
if (!USE_REDIS) {
    setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of inMemoryStore.entries()) {
            if (now > entry.resetTime) {
                inMemoryStore.delete(key);
            }
        }
    }, 60000); // Clean every minute
}

/**
 * In-memory rate limit check (fallback when Redis is not available)
 */
function checkRateLimitInMemory(
    identifier: string,
    config: RateLimitConfig
): RateLimitResult {
    const now = Date.now();
    const windowMs = config.windowSec * 1000;
    const key = `rate:${identifier}:${config.limit}:${config.windowSec}`;

    let entry = inMemoryStore.get(key);

    // Create new entry if doesn't exist or window expired
    if (!entry || now > entry.resetTime) {
        entry = {
            count: 0,
            resetTime: now + windowMs
        };
        inMemoryStore.set(key, entry);
    }

    // Increment count
    entry.count++;

    const remaining = Math.max(0, config.limit - entry.count);
    const resetIn = Math.ceil((entry.resetTime - now) / 1000);

    return {
        success: entry.count <= config.limit,
        limit: config.limit,
        remaining,
        resetIn
    };
}

/**
 * Check rate limit for a given identifier (uses Redis if available, otherwise in-memory)
 */
export async function checkRateLimit(
    identifier: string,
    config: RateLimitConfig = { limit: 20, windowSec: 60 }
): Promise<RateLimitResult> {
    const limiter = getRateLimiter(config);

    // Use Redis if available
    if (limiter) {
        try {
            const { success, limit, remaining, reset } = await limiter.limit(identifier);
            
            return {
                success,
                limit,
                remaining,
                resetIn: Math.ceil((reset - Date.now()) / 1000)
            };
        } catch (error) {
            console.error("Redis rate limit check failed:", error);
            console.warn("Falling back to in-memory rate limiting for this request");
            // Fall through to in-memory
        }
    }

    // Fallback to in-memory
    return checkRateLimitInMemory(identifier, config);
}

/**
 * Get client identifier from request
 * Uses X-Forwarded-For (Vercel), X-Real-IP, or falls back to a default
 */
export function getClientIdentifier(request: Request): string {
    const forwarded = request.headers.get('x-forwarded-for');
    if (forwarded) {
        // On Vercel the real client IP is always the LAST entry in the chain.
        // Taking the first entry is spoofable — an attacker can prepend arbitrary IPs.
        const ips = forwarded.split(',').map(ip => ip.trim()).filter(Boolean);
        return ips[ips.length - 1];
    }

    const realIp = request.headers.get('x-real-ip');
    if (realIp) {
        return realIp.trim();
    }

    return 'unknown-client';
}

/**
 * Rate limit configurations for different endpoints
 */
export const RATE_LIMITS = {
    // Analysis endpoint: 20 requests per minute per IP
    analyze: { limit: 20, windowSec: 60 },
} as const;
