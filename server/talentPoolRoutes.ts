import { Router } from "express";
import { eq, and, desc, sql, ilike, or, inArray } from "drizzle-orm";
import { db } from "./db";
import { requireAuth, requireRole } from "./auth";
import type { AuthRequest } from "./auth";

const HIRING_ROLES = ["ADMIN", "HUSTLER", "HR_MANAGER"] as const;
import {
  talentProfiles,
  users,
  skills,
  userSkills,
  userCertifications,
  hiringCandidates,
  hiringJobs,
  hiringPipelineStages,
  organizations,
  insertTalentProfileSchema,
} from "@shared/schema";
import { logError } from "./utils/logger";

const router = Router();

function orgId(req: AuthRequest): string {
  return req.user!.organizationId!;
}

function userId(req: AuthRequest): string {
  return req.user!.id;
}

router.get("/my-profile", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [profile] = await db
      .select()
      .from(talentProfiles)
      .where(eq(talentProfiles.userId, userId(req)))
      .limit(1);

    if (!profile) {
      return res.json(null);
    }

    const userSkillsList = await db
      .select({ skill: skills })
      .from(userSkills)
      .innerJoin(skills, eq(userSkills.skillId, skills.id))
      .where(eq(userSkills.userId, userId(req)));

    const certs = await db
      .select()
      .from(userCertifications)
      .where(eq(userCertifications.userId, userId(req)));

    const [user] = await db
      .select({
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        phone: users.phone,
        avatarUrl: users.avatarUrl,
        tradeSpecialization: users.tradeSpecialization,
      })
      .from(users)
      .where(eq(users.id, userId(req)))
      .limit(1);

    res.json({
      ...profile,
      user,
      skills: userSkillsList.map((s) => s.skill),
      certifications: certs,
    });
  } catch (err) {
    logError("GET /api/talent-pool/my-profile", { error: String(err) });
    res.status(500).json({ error: "Failed to fetch talent profile" });
  }
});

router.post("/my-profile", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [existing] = await db
      .select()
      .from(talentProfiles)
      .where(eq(talentProfiles.userId, userId(req)))
      .limit(1);

    if (existing) {
      return res.status(400).json({ error: "Profile already exists. Use PUT to update." });
    }

    const parsed = insertTalentProfileSchema.safeParse({
      ...req.body,
      userId: userId(req),
      organizationId: req.user!.organizationId || null,
    });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const [profile] = await db.insert(talentProfiles).values(parsed.data).returning();
    res.status(201).json(profile);
  } catch (err) {
    logError("POST /api/talent-pool/my-profile", { error: String(err) });
    res.status(500).json({ error: "Failed to create talent profile" });
  }
});

router.put("/my-profile", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [existing] = await db
      .select()
      .from(talentProfiles)
      .where(eq(talentProfiles.userId, userId(req)))
      .limit(1);

    if (!existing) {
      const parsed = insertTalentProfileSchema.safeParse({
        ...req.body,
        userId: userId(req),
        organizationId: req.user!.organizationId || null,
      });
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
      const [profile] = await db.insert(talentProfiles).values(parsed.data).returning();
      return res.status(201).json(profile);
    }

    const updates: Record<string, unknown> = { ...req.body, updatedAt: new Date() };
    delete updates["id"];
    delete updates["userId"];
    delete updates["createdAt"];

    const [profile] = await db
      .update(talentProfiles)
      .set(updates as Partial<typeof talentProfiles.$inferInsert>)
      .where(eq(talentProfiles.userId, userId(req)))
      .returning();

    res.json(profile);
  } catch (err) {
    logError("PUT /api/talent-pool/my-profile", { error: String(err) });
    res.status(500).json({ error: "Failed to update talent profile" });
  }
});

router.get("/directory", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { search, trade, availability, location, skill, certification, minRating, page = "1", limit = "20", sort = "newest" } = req.query;

    const conditions: any[] = [
      eq(talentProfiles.isPublished, true),
      eq(talentProfiles.visibility, "PUBLIC"),
    ];

    if (trade && typeof trade === "string") {
      conditions.push(eq(talentProfiles.tradeSpecialization, trade));
    }
    if (availability && typeof availability === "string") {
      conditions.push(eq(talentProfiles.availability, availability as any));
    }
    if (location && typeof location === "string") {
      conditions.push(ilike(talentProfiles.preferredLocation, `%${location}%`));
    }

    if (skill && typeof skill === "string") {
      conditions.push(
        sql`${talentProfiles.userId} IN (
          SELECT us."user_id" FROM user_skills us
          INNER JOIN skills s ON s.id = us."skill_id"
          WHERE s."name" ILIKE ${'%' + skill + '%'}
        )`
      );
    }

    if (certification && typeof certification === "string") {
      conditions.push(
        sql`${talentProfiles.userId} IN (
          SELECT uc."user_id" FROM user_certifications uc
          WHERE uc."certification_name" ILIKE ${'%' + certification + '%'}
        )`
      );
    }

    if (minRating && typeof minRating === "string") {
      const minRatingNum = parseFloat(minRating);
      if (!isNaN(minRatingNum) && minRatingNum >= 1 && minRatingNum <= 5) {
        conditions.push(sql`${talentProfiles.rating} >= ${minRatingNum}`);
      }
    }

    let searchCondition: any = null;
    if (search && typeof search === "string") {
      searchCondition = or(
        ilike(users.firstName, `%${search}%`),
        ilike(users.lastName, `%${search}%`),
        ilike(talentProfiles.headline, `%${search}%`),
        ilike(talentProfiles.bio, `%${search}%`),
        ilike(talentProfiles.tradeSpecialization, `%${search}%`),
      );
    }

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    let orderBy;
    switch (sort) {
      case "updated": orderBy = desc(talentProfiles.updatedAt); break;
      case "experience_desc": orderBy = desc(talentProfiles.yearsOfExperience); break;
      case "experience_asc": orderBy = sql`${talentProfiles.yearsOfExperience} ASC NULLS LAST`; break;
      default: orderBy = desc(talentProfiles.createdAt); break;
    }

    const allConditions = searchCondition ? [...conditions, searchCondition] : conditions;

    const profiles = await db
      .select({
        profile: talentProfiles,
        user: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
          avatarUrl: users.avatarUrl,
          tradeSpecialization: users.tradeSpecialization,
        },
        organization: {
          id: organizations.id,
          name: organizations.name,
        },
      })
      .from(talentProfiles)
      .innerJoin(users, eq(talentProfiles.userId, users.id))
      .leftJoin(organizations, eq(talentProfiles.organizationId, organizations.id))
      .where(and(...allConditions))
      .orderBy(orderBy)
      .limit(limitNum)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(talentProfiles)
      .innerJoin(users, eq(talentProfiles.userId, users.id))
      .where(and(...allConditions));

    const total = countResult?.count ?? 0;

    const enrichedProfiles = await Promise.all(
      profiles.map(async (p) => {
        const userSkillsList = await db
          .select({ skill: skills })
          .from(userSkills)
          .innerJoin(skills, eq(userSkills.skillId, skills.id))
          .where(eq(userSkills.userId, p.user.id));

        const certs = await db
          .select({ certificationName: userCertifications.certificationName })
          .from(userCertifications)
          .where(eq(userCertifications.userId, p.user.id));

        return {
          ...p,
          skills: userSkillsList.map((s) => s.skill),
          certifications: certs.map((c) => c.certificationName),
        };
      })
    );

    res.json({
      profiles: enrichedProfiles,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    logError("GET /api/talent-pool/directory", { error: String(err) });
    res.status(500).json({ error: "Failed to fetch talent directory" });
  }
});

router.get("/profiles/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [result] = await db
      .select({
        profile: talentProfiles,
        user: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
          phone: users.phone,
          avatarUrl: users.avatarUrl,
          tradeSpecialization: users.tradeSpecialization,
        },
        organization: {
          id: organizations.id,
          name: organizations.name,
        },
      })
      .from(talentProfiles)
      .innerJoin(users, eq(talentProfiles.userId, users.id))
      .leftJoin(organizations, eq(talentProfiles.organizationId, organizations.id))
      .where(eq(talentProfiles.id, req.params.id))
      .limit(1);

    if (!result) return res.status(404).json({ error: "Profile not found" });

    const isOwner = result.profile.userId === userId(req);
    if (!isOwner) {
      if (!result.profile.isPublished) {
        return res.status(404).json({ error: "Profile not found" });
      }
      if (result.profile.visibility === "PRIVATE") {
        return res.status(403).json({ error: "This profile is private" });
      }
      if (result.profile.visibility === "CONNECTIONS_ONLY") {
        const viewerOrgId = orgId(req);
        if (result.profile.organizationId !== viewerOrgId) {
          return res.status(403).json({ error: "This profile is only visible to connections" });
        }
      }
    }

    const userSkillsList = await db
      .select({
        skill: skills,
        proficiency: userSkills.proficiencyLevel,
        yearsExperience: userSkills.yearsExperience,
      })
      .from(userSkills)
      .innerJoin(skills, eq(userSkills.skillId, skills.id))
      .where(eq(userSkills.userId, result.user.id));

    const certs = await db
      .select()
      .from(userCertifications)
      .where(eq(userCertifications.userId, result.user.id));

    res.json({
      ...result,
      skills: userSkillsList,
      certifications: certs,
    });
  } catch (err) {
    logError("GET /api/talent-pool/profiles/:id", { error: String(err) });
    res.status(500).json({ error: "Failed to fetch talent profile" });
  }
});

router.get("/skill-suggestions", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { trade, q } = req.query;
    const conditions: any[] = [];

    if (q && typeof q === "string" && q.length >= 2) {
      conditions.push(ilike(skills.name, `%${q}%`));
    }

    if (trade && typeof trade === "string") {
      const tradeCategory = trade.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      conditions.push(
        or(
          ilike(skills.category, `%${tradeCategory}%`),
          ilike(skills.category, "%General%"),
          ilike(skills.category, "%Safety%"),
          ilike(skills.category, "%Leadership%"),
        )
      );
    }

    const allSkills = conditions.length > 0
      ? await db.select().from(skills).where(and(...conditions)).orderBy(skills.name).limit(20)
      : await db.select().from(skills).orderBy(skills.name).limit(20);

    res.json(allSkills);
  } catch (err) {
    logError("GET /api/talent-pool/skill-suggestions", { error: String(err) });
    res.status(500).json({ error: "Failed to fetch skill suggestions" });
  }
});

router.post("/profiles/:id/recruit", requireAuth, requireRole(...HIRING_ROLES), async (req: AuthRequest, res) => {
  try {
    const recruiterOrgId = orgId(req);
    const { jobId } = req.body;

    const [result] = await db
      .select({
        profile: talentProfiles,
        user: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
          phone: users.phone,
        },
      })
      .from(talentProfiles)
      .innerJoin(users, eq(talentProfiles.userId, users.id))
      .where(eq(talentProfiles.id, req.params.id))
      .limit(1);

    if (!result) return res.status(404).json({ error: "Profile not found" });

    if (!result.profile.isPublished) {
      return res.status(404).json({ error: "Profile not found" });
    }
    if (result.profile.visibility === "PRIVATE") {
      return res.status(403).json({ error: "This profile cannot be recruited" });
    }
    if (result.profile.visibility === "CONNECTIONS_ONLY" && result.profile.organizationId !== recruiterOrgId) {
      return res.status(403).json({ error: "This profile is only visible to connections" });
    }

    if (jobId) {
      const [jobCheck] = await db
        .select({ organizationId: hiringJobs.organizationId })
        .from(hiringJobs)
        .where(eq(hiringJobs.id, jobId))
        .limit(1);
      if (!jobCheck || jobCheck.organizationId !== recruiterOrgId) {
        return res.status(403).json({ error: "Invalid job selection" });
      }
    }

    const userSkillsList = await db
      .select({ name: skills.name })
      .from(userSkills)
      .innerJoin(skills, eq(userSkills.skillId, skills.id))
      .where(eq(userSkills.userId, result.user.id));

    const certs = await db
      .select({ certificationName: userCertifications.certificationName })
      .from(userCertifications)
      .where(eq(userCertifications.userId, result.user.id));

    const skillNames = userSkillsList.map((s) => s.name).join(", ");
    const certNames = certs.map((c) => c.certificationName).join(", ");

    const [candidate] = await db
      .insert(hiringCandidates)
      .values({
        organizationId: recruiterOrgId,
        jobId: jobId || null,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
        fullName: `${result.user.firstName} ${result.user.lastName}`,
        email: result.user.email,
        phone: result.user.phone,
        source: "TALENT_POOL",
        currentStage: await (async () => {
          const [firstStage] = await db
            .select({ key: hiringPipelineStages.key })
            .from(hiringPipelineStages)
            .where(eq(hiringPipelineStages.organizationId, recruiterOrgId))
            .orderBy(hiringPipelineStages.displayOrder)
            .limit(1);
          return firstStage?.key || "APPLIED";
        })(),
        rawPayloadJson: JSON.stringify({
          talentProfileId: result.profile.id,
          skills: skillNames,
          certifications: certNames,
          bio: result.profile.bio,
          yearsOfExperience: result.profile.yearsOfExperience,
          trade: result.profile.tradeSpecialization,
          resumeUrl: result.profile.resumeUrl,
        }),
      })
      .returning();

    res.status(201).json(candidate);
  } catch (err) {
    logError("POST /api/talent-pool/profiles/:id/recruit", { error: String(err) });
    res.status(500).json({ error: "Failed to recruit talent" });
  }
});

router.get("/profiles/:id/match-score", requireAuth, requireRole(...HIRING_ROLES), async (req: AuthRequest, res) => {
  try {
    const { jobId } = req.query;
    if (!jobId || typeof jobId !== "string") {
      return res.status(400).json({ error: "jobId query parameter required" });
    }

    const [profileResult] = await db
      .select({ profile: talentProfiles })
      .from(talentProfiles)
      .where(eq(talentProfiles.id, req.params.id))
      .limit(1);

    if (!profileResult) return res.status(404).json({ error: "Profile not found" });

    if (!profileResult.profile.isPublished) {
      return res.status(404).json({ error: "Profile not found" });
    }
    if (profileResult.profile.visibility === "PRIVATE") {
      return res.status(403).json({ error: "This profile is private" });
    }
    if (profileResult.profile.visibility === "CONNECTIONS_ONLY") {
      if (profileResult.profile.organizationId !== orgId(req)) {
        return res.status(403).json({ error: "This profile is only visible to connections" });
      }
    }

    const [job] = await db
      .select()
      .from(hiringJobs)
      .where(and(eq(hiringJobs.id, jobId), eq(hiringJobs.organizationId, orgId(req))))
      .limit(1);

    if (!job) return res.status(404).json({ error: "Job not found" });

    const profileUserId = profileResult.profile.userId;
    const profileSkills = await db
      .select({ name: skills.name, category: skills.category })
      .from(userSkills)
      .innerJoin(skills, eq(userSkills.skillId, skills.id))
      .where(eq(userSkills.userId, profileUserId));

    const profileCerts = await db
      .select({ name: userCertifications.certificationName })
      .from(userCertifications)
      .where(eq(userCertifications.userId, profileUserId));

    const jobRequirements = (job.requirements || "").toLowerCase();
    const jobCertsRequired = (job.certificationsRequired || "").toLowerCase();
    const jobDescription = (job.description || "").toLowerCase();
    const jobTrade = (job.trade || "").toLowerCase();

    let skillMatches = 0;
    const matchedSkills: string[] = [];

    for (const sk of profileSkills) {
      const skillLower = sk.name.toLowerCase();
      if (jobRequirements.includes(skillLower) || jobDescription.includes(skillLower)) {
        skillMatches++;
        matchedSkills.push(sk.name);
      }
    }

    if (jobTrade && profileResult.profile.tradeSpecialization) {
      const profileTrade = profileResult.profile.tradeSpecialization.toLowerCase();
      if (profileTrade === jobTrade || profileTrade.includes(jobTrade) || jobTrade.includes(profileTrade)) {
        skillMatches += 2;
      }
    }

    let certMatches = 0;
    for (const cert of profileCerts) {
      if (jobCertsRequired.includes(cert.name.toLowerCase()) || jobRequirements.includes(cert.name.toLowerCase())) {
        certMatches++;
        matchedSkills.push(cert.name);
      }
    }

    let experienceScore = 0;
    const profileYears = profileResult.profile.yearsOfExperience || 0;
    const expMatch = (job.requirements || "").match(/(\d+)\+?\s*years?/i);
    const requiredYears = expMatch ? parseInt(expMatch[1], 10) : 0;
    if (requiredYears > 0 && profileYears >= requiredYears) {
      experienceScore = 2;
    } else if (profileYears > 0 && requiredYears === 0) {
      experienceScore = 1;
    }

    const totalSignals = Math.max(1, profileSkills.length + profileCerts.length + (requiredYears > 0 ? 1 : 0));
    const rawScore = ((skillMatches + certMatches + experienceScore) / totalSignals) * 100;
    const matchScore = Math.min(100, Math.round(rawScore));

    res.json({
      matchScore,
      matchedSkills,
      totalProfileSkills: profileSkills.length,
      totalProfileCerts: profileCerts.length,
      jobTitle: job.title,
    });
  } catch (err) {
    logError("GET /api/talent-pool/profiles/:id/match-score", { error: String(err) });
    res.status(500).json({ error: "Failed to compute match score" });
  }
});

router.get("/by-organization/:orgId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const targetOrgId = req.params.orgId;

    const profiles = await db
      .select({
        profile: talentProfiles,
        user: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          avatarUrl: users.avatarUrl,
          tradeSpecialization: users.tradeSpecialization,
        },
      })
      .from(talentProfiles)
      .innerJoin(users, eq(talentProfiles.userId, users.id))
      .where(
        and(
          eq(talentProfiles.organizationId, targetOrgId),
          eq(talentProfiles.isPublished, true),
          eq(talentProfiles.visibility, "PUBLIC"),
        )
      )
      .orderBy(users.firstName);

    res.json(profiles);
  } catch (err) {
    logError("GET /api/talent-pool/by-organization/:orgId", { error: String(err) });
    res.status(500).json({ error: "Failed to fetch organization talent profiles" });
  }
});

router.get("/my-skills", requireAuth, async (req: AuthRequest, res) => {
  try {
    const mySkills = await db
      .select({
        id: userSkills.id,
        name: skills.name,
        skillId: skills.id,
      })
      .from(userSkills)
      .innerJoin(skills, eq(userSkills.skillId, skills.id))
      .where(eq(userSkills.userId, userId(req)));

    res.json(mySkills);
  } catch (err) {
    logError("GET /api/talent-pool/my-skills", { error: String(err) });
    res.status(500).json({ error: "Failed to fetch skills" });
  }
});

router.post("/my-skills", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { skillName } = req.body;
    if (!skillName || typeof skillName !== "string") {
      return res.status(400).json({ error: "skillName is required" });
    }

    let [skill] = await db
      .select()
      .from(skills)
      .where(ilike(skills.name, skillName.trim()))
      .limit(1);

    if (!skill) {
      [skill] = await db
        .insert(skills)
        .values({ name: skillName.trim() })
        .returning();
    }

    const [existing] = await db
      .select()
      .from(userSkills)
      .where(and(eq(userSkills.userId, userId(req)), eq(userSkills.skillId, skill.id)))
      .limit(1);

    if (existing) {
      return res.status(409).json({ error: "Skill already added" });
    }

    const [userSkill] = await db
      .insert(userSkills)
      .values({ userId: userId(req), skillId: skill.id })
      .returning();

    res.status(201).json({ id: userSkill.id, name: skill.name, skillId: skill.id });
  } catch (err) {
    logError("POST /api/talent-pool/my-skills", { error: String(err) });
    res.status(500).json({ error: "Failed to add skill" });
  }
});

router.delete("/my-skills/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    await db
      .delete(userSkills)
      .where(and(eq(userSkills.id, req.params.id), eq(userSkills.userId, userId(req))));

    res.json({ success: true });
  } catch (err) {
    logError("DELETE /api/talent-pool/my-skills/:id", { error: String(err) });
    res.status(500).json({ error: "Failed to remove skill" });
  }
});

router.get("/my-certifications", requireAuth, async (req: AuthRequest, res) => {
  try {
    const certs = await db
      .select()
      .from(userCertifications)
      .where(eq(userCertifications.userId, userId(req)));

    res.json(certs);
  } catch (err) {
    logError("GET /api/talent-pool/my-certifications", { error: String(err) });
    res.status(500).json({ error: "Failed to fetch certifications" });
  }
});

router.post("/my-certifications", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { certificationName } = req.body;
    if (!certificationName || typeof certificationName !== "string") {
      return res.status(400).json({ error: "certificationName is required" });
    }

    const [cert] = await db
      .insert(userCertifications)
      .values({
        userId: userId(req),
        organizationId: orgId(req),
        certificationName: certificationName.trim(),
      })
      .returning();

    res.status(201).json(cert);
  } catch (err) {
    logError("POST /api/talent-pool/my-certifications", { error: String(err) });
    res.status(500).json({ error: "Failed to add certification" });
  }
});

router.delete("/my-certifications/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    await db
      .delete(userCertifications)
      .where(and(eq(userCertifications.id, req.params.id), eq(userCertifications.userId, userId(req))));

    res.json({ success: true });
  } catch (err) {
    logError("DELETE /api/talent-pool/my-certifications/:id", { error: String(err) });
    res.status(500).json({ error: "Failed to remove certification" });
  }
});

export default router;
