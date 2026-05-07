const env = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000',
};

export const config = {
  api: {
    baseUrl: env.apiUrl,
    timeout: 30000,
  },
} as const;
