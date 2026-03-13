import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Allowed origins for CORS
 * In production, this should be restricted to your actual domains
 */
const ALLOWED_ORIGINS = [
    // Production domains
    "https://afkmate.in",
    "https://www.afkmate.in",
    // Backend's own origin — login page posts to /api/auth/* from the same domain
    "https://api.afkmate.in",

    // Development
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
];

// Allow all origins in development
const IS_DEVELOPMENT = process.env.NODE_ENV === "development";

/**
 * Check if origin is allowed
 */
function isOriginAllowed(origin: string | null): boolean {
    // No origin header = same-origin request or non-browser client (like VS Code extension)
    if (!origin) {
        return true;
    }

    // Allow all in development
    if (IS_DEVELOPMENT) {
        return true;
    }

    // Check against whitelist
    return ALLOWED_ORIGINS.includes(origin);
}

/**
 * Get CORS headers for response
 */
function getCorsHeaders(origin: string | null): Record<string, string> {
    const headers: Record<string, string> = {
        "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
        "Access-Control-Max-Age": "86400", // 24 hours
    };

    // Set Allow-Origin based on request
    if (!origin) {
        // No origin = likely server-to-server or extension request
        // Don't set Access-Control-Allow-Origin (not needed for non-browser)
    } else if (IS_DEVELOPMENT) {
        // Allow the requesting origin in development
        headers["Access-Control-Allow-Origin"] = origin;
        headers["Access-Control-Allow-Credentials"] = "true";
    } else if (ALLOWED_ORIGINS.includes(origin)) {
        // Allow specific origin in production
        headers["Access-Control-Allow-Origin"] = origin;
        headers["Access-Control-Allow-Credentials"] = "true";
    }

    return headers;
}

export function middleware(request: NextRequest) {
    const origin = request.headers.get("origin");
    const pathname = request.nextUrl.pathname;

    // Only apply CORS to API routes
    if (!pathname.startsWith("/api/")) {
        return NextResponse.next();
    }

    // Handle preflight requests
    if (request.method === "OPTIONS") {
        // Check if origin is allowed
        if (!isOriginAllowed(origin)) {
            return new NextResponse(null, {
                status: 403,
                statusText: "Forbidden - Origin not allowed",
            });
        }

        // Return preflight response
        return new NextResponse(null, {
            status: 204,
            headers: getCorsHeaders(origin),
        });
    }

    // For actual requests, check origin and add CORS headers to response
    if (!isOriginAllowed(origin)) {
        return NextResponse.json(
            { error: "Origin not allowed" },
            { status: 403 }
        );
    }

    // Clone the response and add CORS headers
    const response = NextResponse.next();

    // Add CORS headers
    const corsHeaders = getCorsHeaders(origin);
    for (const [key, value] of Object.entries(corsHeaders)) {
        response.headers.set(key, value);
    }

    return response;
}

// Configure which paths the middleware runs on
export const config = {
    matcher: "/api/:path*",
};
