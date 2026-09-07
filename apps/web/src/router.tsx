import { createBrowserRouter, Navigate } from "react-router-dom";
import LoginRoute from "./routes/login";
import AppRoute from "./routes/app";
import CatalogRoute from "./routes/catalog/catalog-route";
import ServiceInstanceRoute from "./routes/service-instances/service-instance-route";

export const router = createBrowserRouter([
  { path: "/login", element: <LoginRoute /> },
  {
    path: "/",
    element: <AppRoute />,
    children: [
      { index: true, element: <Navigate to="catalog" replace /> },
      { path: "catalog", element: <CatalogRoute /> },
      { path: "service-instances/:id", element: <ServiceInstanceRoute /> }
    ]
  }
]);
