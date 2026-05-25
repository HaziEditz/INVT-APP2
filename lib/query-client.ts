import { QueryClient } from '@tanstack/react-query';
import { Platform } from 'react-native';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 2,
    },
  },
});

export function getApiUrl(): string {
  if (process.env.EXPO_PUBLIC_DOMAIN) {
    return `https://${process.env.EXPO_PUBLIC_DOMAIN}`;
  }
  if (Platform.OS === 'web') {
    return '';
  }
  return 'http://localhost:5000';
}

export async function apiRequest(method: string, path: string, body?: unknown) {
  const url = new URL(path, getApiUrl() || 'http://localhost:5000').toString();
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}
