/**
 * Maps OAuth / login error codes and common API messages to text users can understand.
 */
export function describeLoginError(raw: string | null | undefined): string | null {
  if (raw == null || raw.trim() === "") return null;

  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();

  if (lower === "invalid_state") {
    return [
      "Sign-in could not be verified (your session did not match).",
      "",
      "Try signing in again from the login page. If it keeps happening, clear this site’s cookies for CalSync or complete sign-in in a single browser tab.",
    ].join("\n");
  }

  if (lower === "access_denied") {
    return [
      "Google sign-in was cancelled or calendar access was denied.",
      "",
      "To use CalSync, choose “Allow” when Google asks for permission, or try “Continue with Google” again.",
    ].join("\n");
  }

  if (
    lower === "unauthorized_client" ||
    /\bunauthorized_client\b/i.test(trimmed)
  ) {
    return [
      "Google does not accept this app’s OAuth configuration, so sign-in cannot finish.",
      "",
      "What to check:",
      "• In Google Cloud Console → APIs & Services → Credentials, open your OAuth 2.0 Client ID (type “Web application”).",
      "• Under Authorized redirect URIs, add exactly: your CalSync origin plus /api/auth/callback — for example http://localhost:3000/api/auth/callback for local dev, or https://your-domain.com/api/auth/callback in production. The scheme (http/https), host, and port must match the URL you use in the browser.",
      "• Set CALSYNC_PUBLIC_URL in your server environment to that same origin with no trailing slash (e.g. http://localhost:3000 or https://your-domain.com).",
      "• Confirm GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are from that same OAuth client, then restart the app.",
    ].join("\n");
  }

  if (/\binvalid_grant\b/i.test(trimmed)) {
    return [
      "Google rejected the sign-in code (it may have expired, been used already, or access was revoked).",
      "",
      "Try “Continue with Google” again from the start. If you recently changed Google permissions, revoke CalSync under Google Account → Security → Third-party access and sign in again.",
    ].join("\n");
  }

  if (
    trimmed.includes("Missing GOOGLE_CLIENT_ID") ||
    trimmed.includes("GOOGLE_CLIENT_SECRET")
  ) {
    return [
      "This server is not configured with Google OAuth credentials.",
      "",
      "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the environment (see .env.example), then restart the app.",
    ].join("\n");
  }

  return trimmed;
}
