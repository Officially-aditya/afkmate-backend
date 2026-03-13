import { NextRequest, NextResponse } from "next/server";
import { getLLMFallbackResponse, getLLMFixResponse } from "../../utils/get-llm";
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from "../../utils/rate-limit";
import { validateAnalysisInput } from "../../utils/validation";
import { requireAuth, AuthError } from "../../utils/auth";
import { checkAndIncrementQuota, decrementQuota } from "../../utils/quota";

export async function POST(req: NextRequest) {
  // Rate limiting (IP-based, before auth)
  const clientId = getClientIdentifier(req);
  const rateLimit = await checkRateLimit(clientId, RATE_LIMITS.analyze);

  if (!rateLimit.success) {
    return NextResponse.json(
      {
        error: "Rate limit exceeded",
        retryAfter: rateLimit.resetIn
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.resetIn),
          "X-RateLimit-Limit": String(rateLimit.limit),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(rateLimit.resetIn)
        }
      }
    );
  }

  // Authenticate via BetterAuth session
  let userId: string;
  let tier: string;
  try {
    const identity = await requireAuth(req);
    userId = identity.userId;
    tier = identity.tier;
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.statusCode }
      );
    }
    return NextResponse.json(
      { error: "Authentication failed" },
      { status: 401 }
    );
  }

  // Check monthly quota (server-side enforcement)
  const quota = await checkAndIncrementQuota(userId, tier);
  if (!quota.allowed) {
    return NextResponse.json(
      {
        error: "Monthly analysis quota exceeded",
        quota: { limit: quota.limit, used: quota.used, remaining: 0 }
      },
      { status: 403 }
    );
  }

  try {
    // Parse and validate request body
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    // Validate and sanitize input
    const validation = validateAnalysisInput(body);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    const { input, fileName, mode, issue, fullFileContext } = validation.sanitized!;

    let result;

    // Handle fix mode vs analyze mode
    if (mode === 'fix' && issue) {
      // Fix mode: generate a fix for a specific issue
      console.log(`[Fix Mode] Generating fix for issue at line ${issue.line}: ${issue.message}`);
      result = await getLLMFixResponse(input, issue, fileName, fullFileContext, tier);
    } else {
      // Analyze mode: run full analysis
      result = await getLLMFallbackResponse(fileName, input, tier);
    }

    // Return with rate limit + quota headers
    return NextResponse.json(
      { result },
      {
        headers: {
          "X-RateLimit-Limit": String(rateLimit.limit),
          "X-RateLimit-Remaining": String(rateLimit.remaining),
          "X-RateLimit-Reset": String(rateLimit.resetIn),
          "X-Quota-Limit": String(quota.limit),
          "X-Quota-Used": String(quota.used),
          "X-Quota-Remaining": String(quota.remaining),
        }
      }
    );
  } catch (err) {
    // Rollback quota since the LLM call failed and user got no result
    await decrementQuota(userId, tier).catch(() => {});

    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("LLM API Error:", message, err);

    if (message.includes("Invalid response") || message.includes("JSON")) {
      return NextResponse.json(
        { error: "Failed to parse LLM response" },
        { status: 502 }
      );
    }

    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    );
  }
}
