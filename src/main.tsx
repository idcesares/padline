import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import "./index.css";

const Landing = lazy(() => import("./routes/landing"));
const Pad = lazy(() => import("./routes/pad"));
const Terms = lazy(() =>
  import("./routes/legal").then((module) => ({ default: module.Terms })),
);
const Privacy = lazy(() =>
  import("./routes/legal").then((module) => ({ default: module.Privacy })),
);
const ContentPolicy = lazy(() =>
  import("./routes/legal").then((module) => ({
    default: module.ContentPolicy,
  })),
);

const router = createBrowserRouter([
  { path: "/", element: <Landing /> },
  { path: "/terms", element: <Terms /> },
  { path: "/privacy", element: <Privacy /> },
  { path: "/content-policy", element: <ContentPolicy /> },
  { path: "/:slug", element: <Pad /> },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense
      fallback={
        <main
          className="flex min-h-svh items-center justify-center text-sm text-muted-foreground"
          aria-busy
        >
          Loading Padline…
        </main>
      }
    >
      <RouterProvider router={router} />
    </Suspense>
  </StrictMode>,
);
