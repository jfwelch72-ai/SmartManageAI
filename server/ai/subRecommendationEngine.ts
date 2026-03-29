import { db } from "../db";
import {
  subPerformanceScores,
  subcontractorContracts,
  vendorScores,
  crmOrganisations,
  projects,
} from "@shared/schema";
import { eq, sql, desc, and } from "drizzle-orm";

export interface SubRecommendation {
  subcontractorId: string;
  subcontractorName: string;
  rank: number;
  overallScore: number;
  performanceMetrics: {
    avgScheduleAdherence: number | null;
    avgQualityScore: number | null;
    avgWorkCompletion: number | null;
    totalSafetyIncidents: number;
    avgOverallRating: number | null;
  };
  vendorMetrics: {
    avgOnTimeDelivery: number | null;
    avgQuality: number | null;
    avgCommunication: number | null;
    avgReliability: number | null;
    avgPriceCompetitiveness: number | null;
  } | null;
  projectHistory: {
    projectCode: string;
    projectName: string;
    scopeOfWork: string;
    contractAmount: number;
    status: string;
  }[];
  tradeMatch: boolean;
  contractCount: number;
  totalContractValue: number;
}

export interface RecommendationRequest {
  organizationId: string;
  tradeSpecialty?: string;
  projectId?: string;
  maxResults?: number;
}

export async function getSubcontractorRecommendations(
  request: RecommendationRequest
): Promise<SubRecommendation[]> {
  const { organizationId, tradeSpecialty, projectId, maxResults = 10 } = request;

  const allContracts = await db
    .select({
      contract: subcontractorContracts,
      sub: {
        id: crmOrganisations.id,
        name: crmOrganisations.name,
        type: crmOrganisations.type,
      },
      project: {
        id: projects.id,
        code: projects.code,
        name: projects.name,
      },
    })
    .from(subcontractorContracts)
    .innerJoin(crmOrganisations, eq(subcontractorContracts.subcontractorId, crmOrganisations.id))
    .innerJoin(projects, eq(subcontractorContracts.projectId, projects.id))
    .where(eq(projects.gcOrganizationId, organizationId))
    .orderBy(desc(subcontractorContracts.createdAt));

  if (allContracts.length === 0) return [];

  const subMap = new Map<string, {
    id: string;
    name: string;
    contracts: typeof allContracts;
    perfScores: any[];
    vendorAvg: any;
  }>();

  for (const row of allContracts) {
    const subId = row.sub.id;
    if (!subMap.has(subId)) {
      subMap.set(subId, { id: subId, name: row.sub.name, contracts: [], perfScores: [], vendorAvg: null });
    }
    subMap.get(subId)!.contracts.push(row);
  }

  const contractIds = allContracts.map(c => c.contract.id);
  const perfScores = contractIds.length > 0
    ? await db
        .select()
        .from(subPerformanceScores)
        .where(sql`${subPerformanceScores.contractId} IN (${sql.join(contractIds.map(id => sql`${id}`), sql`, `)})`)
        .limit(5000)
    : [];

  for (const score of perfScores) {
    const contract = allContracts.find(c => c.contract.id === score.contractId);
    if (contract) {
      const subData = subMap.get(contract.sub.id);
      if (subData) subData.perfScores.push(score);
    }
  }

  const subIds = Array.from(subMap.keys());
  const vScores = subIds.length > 0
    ? await db
        .select()
        .from(vendorScores)
        .where(
          and(
            eq(vendorScores.organizationId, organizationId),
            sql`${vendorScores.crmEntityId} IN (${sql.join(subIds.map(id => sql`${id}`), sql`, `)})`
          )
        )
        .limit(5000)
    : [];

  const vendorScoresBySub = new Map<string, typeof vScores>();
  for (const vs of vScores) {
    if (!vendorScoresBySub.has(vs.crmEntityId)) vendorScoresBySub.set(vs.crmEntityId, []);
    vendorScoresBySub.get(vs.crmEntityId)!.push(vs);
  }

  const recommendations: SubRecommendation[] = [];

  for (const [subId, data] of subMap) {
    const contracts = data.contracts;
    const scores = data.perfScores;
    const vsList = vendorScoresBySub.get(subId) || [];

    const tradeMatch = tradeSpecialty
      ? contracts.some(c => c.contract.scopeOfWork.toLowerCase().includes(tradeSpecialty.toLowerCase()))
      : true;

    const projectMatch = projectId
      ? contracts.some(c => c.contract.projectId === projectId || c.project.id === projectId)
      : true;

    const avgScheduleAdherence = scores.length > 0
      ? scores.reduce((s, sc) => s + (Number(sc.scheduleAdherence) || 0), 0) / scores.filter(s => s.scheduleAdherence != null).length || null
      : null;

    const avgQualityScore = scores.length > 0
      ? scores.reduce((s, sc) => s + (Number(sc.qualityScore) || 0), 0) / scores.filter(s => s.qualityScore != null).length || null
      : null;

    const avgWorkCompletion = scores.length > 0
      ? scores.reduce((s, sc) => s + (Number(sc.workCompletionPercent) || 0), 0) / scores.filter(s => s.workCompletionPercent != null).length || null
      : null;

    const totalSafetyIncidents = scores.reduce((s, sc) => s + (Number(sc.safetyIncidents) || 0), 0);

    const avgOverallRating = scores.length > 0
      ? scores.reduce((s, sc) => s + (Number(sc.overallRating) || 0), 0) / scores.filter(s => s.overallRating != null).length || null
      : null;

    let vendorMetrics = null;
    if (vsList.length > 0) {
      const avgField = (values: (string | null | undefined)[]) => {
        const nums = values.map(v => Number(v)).filter(v => !isNaN(v) && v > 0);
        return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
      };
      vendorMetrics = {
        avgOnTimeDelivery: avgField(vsList.map(v => v.onTimeDeliveryScore)),
        avgQuality: avgField(vsList.map(v => v.qualityScore)),
        avgCommunication: avgField(vsList.map(v => v.communicationScore)),
        avgReliability: avgField(vsList.map(v => v.reliabilityScore)),
        avgPriceCompetitiveness: avgField(vsList.map(v => v.priceCompetitivenessScore)),
      };
    }

    const projectHistory = contracts.slice(0, 5).map(c => ({
      projectCode: c.project.code,
      projectName: c.project.name,
      scopeOfWork: c.contract.scopeOfWork,
      contractAmount: Number(c.contract.contractAmount),
      status: c.contract.status,
    }));

    let overallScore = 50;
    if (avgOverallRating != null) overallScore += (avgOverallRating / 5) * 20;
    if (avgScheduleAdherence != null) overallScore += (avgScheduleAdherence / 100) * 10;
    if (avgQualityScore != null) overallScore += (avgQualityScore / 100) * 10;
    if (vendorMetrics?.avgReliability != null) overallScore += (vendorMetrics.avgReliability / 5) * 5;
    if (vendorMetrics?.avgOnTimeDelivery != null) overallScore += (vendorMetrics.avgOnTimeDelivery / 5) * 5;
    overallScore -= totalSafetyIncidents * 2;
    if (tradeMatch) overallScore += 5;
    if (projectMatch && projectId) overallScore += 5;
    overallScore = Math.max(0, Math.min(100, Math.round(overallScore)));

    const totalContractValue = contracts.reduce((s, c) => s + Number(c.contract.contractAmount), 0);

    recommendations.push({
      subcontractorId: subId,
      subcontractorName: data.name,
      rank: 0,
      overallScore,
      performanceMetrics: {
        avgScheduleAdherence: avgScheduleAdherence ? Math.round(avgScheduleAdherence) : null,
        avgQualityScore: avgQualityScore ? Math.round(avgQualityScore) : null,
        avgWorkCompletion: avgWorkCompletion ? Math.round(avgWorkCompletion) : null,
        totalSafetyIncidents,
        avgOverallRating: avgOverallRating ? Math.round(avgOverallRating * 10) / 10 : null,
      },
      vendorMetrics,
      projectHistory,
      tradeMatch,
      contractCount: contracts.length,
      totalContractValue: Math.round(totalContractValue),
    });
  }

  let filtered = recommendations;
  if (tradeSpecialty) {
    const matching = recommendations.filter(r => r.tradeMatch);
    if (matching.length > 0) filtered = matching;
  }
  if (projectId) {
    const projectMatching = filtered.filter(r => {
      const sub = subMap.get(r.subcontractorId);
      return sub?.contracts.some(c => c.contract.projectId === projectId || c.project.id === projectId);
    });
    if (projectMatching.length > 0) filtered = projectMatching;
  }

  filtered.sort((a, b) => b.overallScore - a.overallScore);
  filtered.forEach((r, i) => (r.rank = i + 1));

  return filtered.slice(0, maxResults);
}
