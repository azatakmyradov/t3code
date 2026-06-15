import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterHistory } from "@tanstack/react-router";

import { AppAtomRegistryProvider } from "./rpc/atomRegistry";
import { routeTree } from "./routeTree.gen";

export function getRouter(history: RouterHistory) {
  const queryClient = new QueryClient();

  return createRouter({
    routeTree,
    history,
    context: {
      queryClient,
    },
    Wrap: ({ children }) =>
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(AppAtomRegistryProvider, undefined, children),
      ),
  });
}

export type AppRouter = ReturnType<typeof getRouter>;

// Module-level holder so non-React code paths (e.g. desktop notification
// click handlers) can navigate without access to React context.
let appRouter: AppRouter | null = null;

export function registerAppRouter(router: AppRouter): void {
  appRouter = router;
}

export function getAppRouter(): AppRouter | null {
  return appRouter;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
