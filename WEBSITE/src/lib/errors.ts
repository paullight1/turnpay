type ErrorPayload = {
  status?: number;
  path?: string;
  message?: unknown;
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
        data?: { message?: unknown };
        config?: { url?: string };
      };
      config?: { url?: string };
    };

    return {
      status: anyError.response?.status,
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
    return getAuthErrorFallback(responsePath, fallback);
  }

  const message = payload.message;
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
