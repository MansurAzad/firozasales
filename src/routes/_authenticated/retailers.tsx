import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/retailers")({
  component: RetailersLayout,
});

// Parent layout for /retailers and /retailers/$id.
function RetailersLayout() {
  return <Outlet />;
}
