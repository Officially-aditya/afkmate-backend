import { NextRequest, NextResponse } from "next/server";

// Only allow redirecting to the VS Code extension scheme.
// This prevents this endpoint from being used as an open redirector.
const ALLOWED_REDIRECT_PREFIX = "vscode://afkmate.afkmate/";

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const redirectUri = searchParams.get("redirect_uri");

    // Extract the BetterAuth session token from the cookie set by OAuth callback
    const sessionToken =
        req.cookies.get("better-auth.session_token")?.value ??
        req.cookies.get("__Secure-better-auth.session_token")?.value;

    if (!sessionToken) {
        return NextResponse.json(
            { error: "No session token found. Complete OAuth sign-in first." },
            { status: 401 },
        );
    }

    // If no redirect_uri (browser flow), go to dashboard
    if (!redirectUri) {
        return NextResponse.redirect(new URL("/dashboard", process.env.NEXT_PUBLIC_WEBSITE_URL || "https://afkmate.in"));
    }

    // Security: only allow vscode://afkmate/ redirects
    if (!redirectUri.startsWith(ALLOWED_REDIRECT_PREFIX)) {
        return NextResponse.json(
            { error: "Invalid redirect_uri" },
            { status: 400 },
        );
    }

    // Append token to the vscode:// URI so the extension URI handler receives it
    const target = new URL(redirectUri);
    target.searchParams.set("token", sessionToken);

    return NextResponse.redirect(target.toString());
}
