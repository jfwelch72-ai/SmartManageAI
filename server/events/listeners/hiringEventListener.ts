import { eventBus } from "../eventBus";
import { logError, logInfo } from "../../utils/logger";
import type {
  HiringJobPublishedEvent,
  HiringCandidateAppliedEvent,
  HiringCandidateStageChangedEvent,
  HiringCandidateHiredEvent,
  HiringInterviewScheduledEvent,
  HiringIntegrationConnectedEvent,
} from "../eventTypes";

export function registerHiringEventListener(): void {
  eventBus.on("hiring.job_published", async (event: HiringJobPublishedEvent) => {
    try {
      logInfo("hiring.job_published", { orgId: event.orgId, jobId: event.payload.jobId, title: event.payload.title });
    } catch (err) {
      logError("hiringEventListener: hiring.job_published failed", { error: String(err) });
    }
  });

  eventBus.on("hiring.candidate_applied", async (event: HiringCandidateAppliedEvent) => {
    try {
      logInfo("hiring.candidate_applied", { orgId: event.orgId, candidateId: event.payload.candidateId, fullName: event.payload.fullName });
    } catch (err) {
      logError("hiringEventListener: hiring.candidate_applied failed", { error: String(err) });
    }
  });

  eventBus.on("hiring.candidate_stage_changed", async (event: HiringCandidateStageChangedEvent) => {
    try {
      logInfo("hiring.candidate_stage_changed", {
        orgId: event.orgId,
        candidateId: event.payload.candidateId,
        fromStage: event.payload.fromStage,
        toStage: event.payload.toStage,
      });
    } catch (err) {
      logError("hiringEventListener: hiring.candidate_stage_changed failed", { error: String(err) });
    }
  });

  eventBus.on("hiring.candidate_hired", async (event: HiringCandidateHiredEvent) => {
    try {
      logInfo("hiring.candidate_hired", { orgId: event.orgId, candidateId: event.payload.candidateId, fullName: event.payload.fullName });
    } catch (err) {
      logError("hiringEventListener: hiring.candidate_hired failed", { error: String(err) });
    }
  });

  eventBus.on("hiring.interview_scheduled", async (event: HiringInterviewScheduledEvent) => {
    try {
      logInfo("hiring.interview_scheduled", {
        orgId: event.orgId,
        interviewId: event.payload.interviewId,
        candidateId: event.payload.candidateId,
        interviewType: event.payload.interviewType,
      });
    } catch (err) {
      logError("hiringEventListener: hiring.interview_scheduled failed", { error: String(err) });
    }
  });

  eventBus.on("hiring.integration_connected", async (event: HiringIntegrationConnectedEvent) => {
    try {
      logInfo("hiring.integration_connected", { orgId: event.orgId, providerName: event.payload.providerName });
    } catch (err) {
      logError("hiringEventListener: hiring.integration_connected failed", { error: String(err) });
    }
  });
}
