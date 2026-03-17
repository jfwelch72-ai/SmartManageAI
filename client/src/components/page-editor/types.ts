import { type BodyComponent, type SharedStyles, type BodyComponentType } from "@/components/website-body-components";

export interface PageData {
  id: string;
  websiteId: string;
  organizationId: string;
  pageType: string;
  pageSlug: string;
  pageTitle: string;
  contentJson: string | null;
  heroImageUrl: string | null;
  aiGenerated: boolean;
  metaTitle: string | null;
  metaDescription: string | null;
  keywords: string[] | null;
  ogImageUrl: string | null;
  canonicalUrl: string | null;
  showInNavigation: boolean;
  navigationOrder: number;
  navigationLabel: string | null;
  parentPageId: string | null;
  isPublished: boolean;
  noIndex: boolean;
  status?: string;
  updatedAt?: string;
}

export interface PageEditorProps {
  pageId: string;
  onBack: () => void;
}

export interface PresenceUser {
  userId: string;
  userName: string;
  activity: "viewing" | "editing";
}

export interface ConflictInfo {
  conflict: boolean;
  serverUpdatedAt: string;
  lastEditor: string | null;
  lastSaved: string | null;
}

export interface PerfMetrics {
  editorLoadTime: number | null;
  saveLatencies: number[];
  previewRenderTimes: number[];
  lastWarnings: string[];
}

export const PERF_THRESHOLDS = {
  editorLoad: 2000,
  save: 500,
  previewRender: 1000,
};

export interface PageSettings {
  pageTitle: string;
  pageSlug: string;
  pageType: string;
  navigationLabel: string;
  showInNavigation: boolean;
  status: string;
  metaTitle: string;
  metaDescription: string;
  ogImageUrl: string;
  canonicalUrl: string;
  noIndex: boolean;
}

export type { BodyComponent, SharedStyles, BodyComponentType };
