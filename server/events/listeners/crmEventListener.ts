import { eventBus } from "../eventBus";
import { scoreWinProbability } from "../../ai/winProbabilityService";
import { logInfo, logError } from "../../utils/logger";
import { handleOpportunityStageChange } from "../../services/sequenceService";

export function registerCrmEventListener(): void {
  eventBus.on("crm.opportunity_created", async (event) => {
    try {
      logInfo("CRM: scoring win probability for new opportunity", {
        opportunityId: event.payload.opportunityId,
      });
      await scoreWinProbability(event.payload.opportunityId);
    } catch (err) {
      logError("CRM: failed to score new opportunity", {
        error: String(err),
        opportunityId: event.payload.opportunityId,
      });
    }
  });

  eventBus.on("crm.opportunity_stage_changed", async (event) => {
    try {
      logInfo("CRM: re-scoring win probability after stage change", {
        opportunityId: event.payload.opportunityId,
        oldStage: event.payload.oldStage,
        newStage: event.payload.newStage,
      });
      await scoreWinProbability(event.payload.opportunityId);
    } catch (err) {
      logError("CRM: failed to re-score after stage change", {
        error: String(err),
        opportunityId: event.payload.opportunityId,
      });
    }
    try {
      await handleOpportunityStageChange(event.payload.opportunityId, event.payload.newStage);
    } catch (err) {
      logError("CRM: failed to auto-exit sequences on stage change", {
        error: String(err),
        opportunityId: event.payload.opportunityId,
      });
    }
  });

  eventBus.on("crm.activity_created", async (event) => {
    try {
      logInfo("CRM: re-scoring win probability after activity logged", {
        opportunityId: event.payload.opportunityId,
      });
      await scoreWinProbability(event.payload.opportunityId);
    } catch (err) {
      logError("CRM: failed to re-score after activity", {
        error: String(err),
        opportunityId: event.payload.opportunityId,
      });
    }
  });
}
