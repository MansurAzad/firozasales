import logo from '@/assets/firoza-logo.png.asset.json';

export function CompanyLogo({ className = '' }: { className?: string }) {
  return <img src={logo.url} alt="FIROZA ENTERPRISE logo" width={428} height={534} className={`shrink-0 object-contain ${className}`} />;
}