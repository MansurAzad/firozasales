import { companyLogoUrl } from "@/lib/company-brand";

export function CompanyLogo({ className = "" }: { className?: string }) {
  return (
    <img
      src={companyLogoUrl}
      crossOrigin="anonymous"
      alt="FIROZA ENTERPRISE logo"
      width={428}
      height={534}
      className={`shrink-0 object-contain ${className}`}
    />
  );
}
