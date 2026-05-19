const env = {
  apiUrl: resolveApiUrl(),
};

function resolveApiUrl() {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (configured) {
    if (
      typeof window !== "undefined" &&
      process.env.NODE_ENV === "production" &&
      !configured.startsWith("https://")
    ) {
      throw new Error("NEXT_PUBLIC_API_URL must be HTTPS in production");
    }
    return configured;
  }

  if (typeof window === "undefined") {
    return "http://localhost:3000";
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("NEXT_PUBLIC_API_URL is required in production");
  }

  return "http://localhost:3000";
}

export const config = {
  api: {
    baseUrl: env.apiUrl,
    timeout: 30000,
  },
} as const;
