import { describe, expect, it } from "vitest";
import { companyLogoUrl, companyLogoRevision } from "./company-brand";

describe("portable company asset", () => {
  it("bundles the supplied logo locally for all deployments", () => {
    expect(companyLogoUrl).toContain("firoza-logo");
    expect(companyLogoUrl).not.toContain("://");
    expect(companyLogoRevision).toBe("696264c6-d696-499a-9505-e91cd2c6a27e");
  });
});
