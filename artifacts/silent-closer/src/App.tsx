import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppGate } from "@/components/app-gate";
import CopilotPage from "@/pages/copilot";
import NotFound from "@/pages/not-found";

// Use a stable query client instance
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={CopilotPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <AppGate>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={0}>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </AppGate>
  );
}

export default App;
