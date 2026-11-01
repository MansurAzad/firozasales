import { describe, expect, it } from 'vitest';
import { companyLogoUrl, companyLogoRevision } from './company-brand';

describe('portable company asset', () => {
  it('keeps the supplied logo on its asset-serving origin when deployed to Vercel', () => {
    const url = new URL(companyLogoUrl, 'https://fe-management.vercel.app');
    expect(url.origin).toBe('https://firozasales.lovable.app');
    expect(url.pathname).toBe('/__l5e/assets-v1/696264c6-d696-499a-9505-e91cd2c6a27e/firoza-logo.png');
    expect(companyLogoRevision).toBe('696264c6-d696-499a-9505-e91cd2c6a27e');
  });
});