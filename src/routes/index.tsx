import { createFileRoute, redirect } from "@tanstack/react-router";

// The app's home is the signed-in dashboard; / just forwards there and the
// _authenticated gate sends visitors to /auth when there is no session.
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "FE MANAGEMENT — FIROZA ENTERPRISE" },
      {
        name: "description",
        content: "FIROZA ENTERPRISE stock, SR sales, dealer dues and settlements.",
      },
      { property: "og:title", content: "FE MANAGEMENT — FIROZA ENTERPRISE" },
      {
        property: "og:description",
        content: "FIROZA ENTERPRISE stock, SR sales, dealer dues and settlements.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
});
