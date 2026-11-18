import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/errors.js';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      // Do not retry 4xx answers (they will not change); retry network blips and 5xx twice.
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});
