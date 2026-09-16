type ErrorPayload = {
  status?: number;
  path?: string;
  message?: unknown;
  code?: string;
};

function getAuthErrorFallback(path: string | undefined, fallback: string) {
  if (!path?.includes("/api/auth/")) {
    return fallback;
  }

  if (path.includes("/api/auth/login")) {
    return "Unable to sign in with those credentials";
  }

  if (path.includes("/api/auth/refresh")) {
    return "Your session has expired. Please sign in again.";
  }

  if (path.includes("/api/auth/register")) {
    return "Unable to complete registration.";
  }

  if (path.includes("/api/auth/sessions")) {
    return "Session action failed. Please try again.";
  }

  if (path.includes("/api/auth/forgot-password")) {
    return "Reset request could not be processed.";
  }

  return fallback;
}

function extractErrorPayload(error: unknown): ErrorPayload {
  if (typeof error === "object" && error !== null) {
    const anyError = error as {
      message?: unknown;
      response?: {
        status?: number;
        data?: { message?: unknown; code?: string };
        config?: { url?: string };
      };
      config?: { url?: string };
    };

    return {
      status: anyError.response?.status,
      code: anyError.response?.data?.code ??
        (typeof anyError.response?.data?.message === "object" && anyError.response.data.message !== null
          ? (anyError.response.data.message as { code?: string }).code : undefined),
      path: anyError.response?.config?.url || anyError.config?.url,
      message: anyError.response?.data?.message ?? anyError.message,
    };
  }

  return {};
}

export function getErrorMessage(error: unknown, fallback: string) {
  const payload = extractErrorPayload(error);
  const responsePath = payload.path;
  if (responsePath?.includes("/api/auth/")) {
    if (payload.status === undefined) return "Could not connect to TrustPay. Check your connection and try again.";
    if (payload.status === 429) return "Too many attempts. Please wait before trying again.";
    if (payload.status >= 500) return "TrustPay is temporarily unavailable. Please try again shortly.";
    if (responsePath.includes("register") && payload.status === 409) {
      if (payload.code === "PHONE_ALREADY_REGISTERED") return "That phone number is already linked to a TrustPay account. Use a different number, or use staff signup for a work account.";
      if (payload.code === "EMAIL_ALREADY_REGISTERED") return "That email is already linked to a TrustPay account. Sign in or reset your password.";
    }
    return getAuthErrorFallback(responsePath, fallback);
  }

  const message = payload.message;
  const normalizedMessage =
    typeof message === "string" ? message.toLowerCase() : "";
  if (
    payload.code === "bad_code_verifier" ||
    payload.code === "pkce_code_verifier_not_found" ||
    normalizedMessage.includes("pkce code verifier") ||
    normalizedMessage.includes("code verifier not found")
  ) {
    return "This reset link is invalid or expired. Request a new one.";
  }

  if (typeof message === "string") {
    return message;
  }

  if (Array.isArray(message)) {
    return message.join(", ");
  }

  if (message && typeof message === "object" && "message" in message) {
    const nestedMessage = (message as { message?: unknown }).message;
    if (typeof nestedMessage === "string") {
      return nestedMessage;
    }

    if (Array.isArray(nestedMessage)) {
      return nestedMessage.join(", ");
    }
  }

  return fallback;
}
