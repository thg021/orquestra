import { createBrowserRouter } from "react-router-dom";
import LoginRoute from "./routes/login";
import AppRoute from "./routes/app";

export const router = createBrowserRouter([
  { path: "/login", element: <LoginRoute /> },
  { path: "/*", element: <AppRoute /> }
]);
