import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { tokenStore } from '../api/session.js';
import { ToastProvider } from '../components/Toast.jsx';
import { MOCK_USERS, makeMockToken } from '../mocks/db.js';

/** Renders ui with query, router and toast providers, signed in as a mock STAFF (or ADMIN) user. */
export function renderWithProviders(ui, { role = 'STAFF', route = '/' } = {}) {
  tokenStore.set(makeMockToken(MOCK_USERS.find((u) => u.role === role)));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <ToastProvider>{ui}</ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, account: userEvent.setup({ delay: null }) };
}
