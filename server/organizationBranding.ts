import { db } from "./db";
import { organizations, organizationDocuments } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export interface OrganizationBranding {
  organizationName: string;
  logoUrl: string | null;
  letterheadUrl: string | null;
  primaryColor: string;
  accentColor: string;
}

export async function getOrganizationBranding(organizationId: string): Promise<OrganizationBranding> {
  const defaultBranding: OrganizationBranding = {
    organizationName: "SmartManageAI",
    logoUrl: null,
    letterheadUrl: null,
    primaryColor: "#1a365d",
    accentColor: "#2563eb"
  };

  if (!organizationId) {
    return defaultBranding;
  }

  try {
    const [org] = await db
      .select({
        name: organizations.name,
        logoUrl: organizations.logoUrl,
        primaryColor: organizations.primaryColor,
        accentColor: organizations.accentColor
      })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    if (!org) {
      return defaultBranding;
    }

    const activeDocuments = await db
      .select({
        type: organizationDocuments.type,
        fileUrl: organizationDocuments.fileUrl
      })
      .from(organizationDocuments)
      .where(
        and(
          eq(organizationDocuments.organizationId, organizationId),
          eq(organizationDocuments.isActive, true)
        )
      );

    const primaryLogo = activeDocuments.find(doc => doc.type === "LOGO_PRIMARY");
    const letterhead = activeDocuments.find(doc => doc.type === "LETTERHEAD");

    return {
      organizationName: org.name || defaultBranding.organizationName,
      logoUrl: primaryLogo?.fileUrl || org.logoUrl || null,
      letterheadUrl: letterhead?.fileUrl || null,
      primaryColor: org.primaryColor || defaultBranding.primaryColor,
      accentColor: org.accentColor || defaultBranding.accentColor
    };
  } catch (error) {
    console.error("Error fetching organization branding:", error);
    return defaultBranding;
  }
}

export async function getOrganizationDocumentUrl(
  organizationId: string, 
  documentType: string
): Promise<string | null> {
  if (!organizationId) {
    return null;
  }

  try {
    const [doc] = await db
      .select({
        fileUrl: organizationDocuments.fileUrl
      })
      .from(organizationDocuments)
      .where(
        and(
          eq(organizationDocuments.organizationId, organizationId),
          eq(organizationDocuments.type, documentType as any),
          eq(organizationDocuments.isActive, true)
        )
      )
      .limit(1);

    return doc?.fileUrl || null;
  } catch (error) {
    console.error("Error fetching organization document:", error);
    return null;
  }
}

export async function getInsuranceCertificateStatus(organizationId: string): Promise<{
  generalLiability: { url: string | null; expiresAt: Date | null; isExpired: boolean };
  workersComp: { url: string | null; expiresAt: Date | null; isExpired: boolean };
  auto: { url: string | null; expiresAt: Date | null; isExpired: boolean };
  umbrella: { url: string | null; expiresAt: Date | null; isExpired: boolean };
}> {
  const defaultStatus = {
    url: null,
    expiresAt: null,
    isExpired: false
  };

  if (!organizationId) {
    return {
      generalLiability: defaultStatus,
      workersComp: defaultStatus,
      auto: defaultStatus,
      umbrella: defaultStatus
    };
  }

  try {
    const documents = await db
      .select({
        type: organizationDocuments.type,
        fileUrl: organizationDocuments.fileUrl,
        expiresAt: organizationDocuments.expiresAt
      })
      .from(organizationDocuments)
      .where(
        and(
          eq(organizationDocuments.organizationId, organizationId),
          eq(organizationDocuments.isActive, true)
        )
      );

    const now = new Date();
    
    const getStatus = (type: string) => {
      const doc = documents.find(d => d.type === type);
      if (!doc) return defaultStatus;
      
      const expiresAt = doc.expiresAt ? new Date(doc.expiresAt) : null;
      return {
        url: doc.fileUrl,
        expiresAt,
        isExpired: expiresAt ? expiresAt < now : false
      };
    };

    return {
      generalLiability: getStatus("INSURANCE_CERT_GENERAL_LIABILITY"),
      workersComp: getStatus("INSURANCE_CERT_WORKERS_COMP"),
      auto: getStatus("INSURANCE_CERT_AUTO"),
      umbrella: getStatus("INSURANCE_CERT_UMBRELLA")
    };
  } catch (error) {
    console.error("Error fetching insurance certificate status:", error);
    return {
      generalLiability: defaultStatus,
      workersComp: defaultStatus,
      auto: defaultStatus,
      umbrella: defaultStatus
    };
  }
}
