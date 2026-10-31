import { createFileRoute, redirect } from "@tanstack/react-router";

// The app's home is the signed-in dashboard; / just forwards there and the
// _authenticated gate sends visitors to /auth when there is no session.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
});
