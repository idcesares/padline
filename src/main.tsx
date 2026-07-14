import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import "./index.css";
import Landing from "./routes/landing";
import Pad from "./routes/pad";

const router = createBrowserRouter([
  { path: "/", element: <Landing /> },
  { path: "/:slug", element: <Pad /> },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
