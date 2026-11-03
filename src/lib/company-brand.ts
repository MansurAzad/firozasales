import companyLogo from "../assets/firoza-logo.png.asset.json";

// The /__l5e asset gateway belongs to Lovable hosting, not a Vercel deployment.
// Use its public, CORS-enabled origin for pages, exports and offline precaching.
export const companyLogoUrl = new URL(companyLogo.url, "https://firozasales.lovable.app").href;
export const companyLogoRevision = companyLogo.asset_id;
