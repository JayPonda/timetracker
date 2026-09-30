import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UI_V1 } from '@pdm/shared';
import { Routes_ } from './Routes';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The app runs on one laptop against one local process, so a refetch on
      // every window focus would be traffic for nothing.
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5_000,
    },
  },
});

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        {/*
          The one place `/ui/v1` is declared for the browser (ADR 0013). Every
          route in `Routes.tsx` and every link in `nav.ts` is written without it,
          and React Router adds it. Spelling the prefix in each of them instead
          would be a dozen places to keep in step with the server's static mount,
          and the failure — a link that silently 404s — is one nobody sees until
          an owner clicks it.
        */}
        <BrowserRouter basename={UI_V1}>
          <Routes_ />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
