import { logError } from "./utils/logger";
import { Router } from "express";
import { db } from "./db";
import { skills, userSkills, insertSkillSchema } from "@shared/schema";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { eq, and } from "drizzle-orm";
import { logCreate, logDelete } from "./auditLogger";
import { sanitizeShortText, sanitizeText } from "./sanitization";

const router = Router();

router.get("/api/skills", requireAuth, async (req: AuthRequest, res) => {
  try {
    const allSkills = await db.select().from(skills).orderBy(skills.category, skills.name);
    res.json(allSkills);
  } catch (error) {
    logError("Error fetching skills:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/skills", requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const sanitizedBody = {
      ...req.body,
      name: sanitizeShortText(req.body.name),
      description: req.body.description ? sanitizeText(req.body.description) : undefined,
    };

    const validationResult = insertSkillSchema.safeParse(sanitizedBody);
    
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    const [newSkill] = await db.insert(skills).values(validationResult.data).returning();
    
    await logCreate(req.user!.id, "skills", newSkill.id, {
      name: newSkill.name,
      category: newSkill.category,
    }, req);

    res.status(201).json(newSkill);
  } catch (error: any) {
    logError("Error creating skill:", {}, error instanceof Error ? error : new Error(String(error)));
    if (error.constraint === "skills_name_unique") {
      res.status(400).json({ error: "A skill with this name already exists" });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/skills/generate", requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const predefinedSkills = [
      { name: "OSHA 10 Certified", category: "Safety", description: "Completed OSHA 10-hour construction safety training" },
      { name: "OSHA 30 Certified", category: "Safety", description: "Completed OSHA 30-hour construction safety training" },
      { name: "First Aid/CPR Certified", category: "Safety", description: "Current first aid and CPR certification" },
      { name: "Confined Space Entry", category: "Safety", description: "Trained in confined space entry procedures" },
      { name: "Fall Protection", category: "Safety", description: "Trained in fall protection and prevention" },
      
      { name: "Forklift Operator", category: "Equipment", description: "Licensed to operate forklifts and material handlers" },
      { name: "Crane Operator", category: "Equipment", description: "Certified crane operator" },
      { name: "Excavator Operator", category: "Equipment", description: "Skilled in operating excavators and backhoes" },
      { name: "Skid Steer Operator", category: "Equipment", description: "Proficient in skid steer loader operation" },
      { name: "Boom Lift Operator", category: "Equipment", description: "Certified to operate aerial boom lifts" },
      { name: "Scissor Lift Operator", category: "Equipment", description: "Certified to operate scissor lifts" },
      
      { name: "Concrete Finishing", category: "Concrete", description: "Skilled in concrete finishing and troweling" },
      { name: "Concrete Forming", category: "Concrete", description: "Experienced in building concrete forms" },
      { name: "Concrete Pouring", category: "Concrete", description: "Skilled in concrete placement and pouring" },
      { name: "Rebar Tying", category: "Concrete", description: "Proficient in rebar installation and tying" },
      
      { name: "Rough Carpentry", category: "Carpentry", description: "Skilled in framing and structural carpentry" },
      { name: "Finish Carpentry", category: "Carpentry", description: "Skilled in trim, molding, and finish work" },
      { name: "Cabinet Installation", category: "Carpentry", description: "Experienced in cabinet and countertop installation" },
      { name: "Drywall Installation", category: "Carpentry", description: "Skilled in drywall hanging and finishing" },
      
      { name: "Electrical Wiring", category: "Electrical", description: "Skilled in electrical wiring and connections" },
      { name: "Conduit Bending", category: "Electrical", description: "Proficient in conduit bending and installation" },
      { name: "Panel Installation", category: "Electrical", description: "Experienced in electrical panel installation" },
      
      { name: "Pipe Fitting", category: "Plumbing", description: "Skilled in pipe fitting and installation" },
      { name: "Copper Soldering", category: "Plumbing", description: "Proficient in copper pipe soldering" },
      { name: "PVC Installation", category: "Plumbing", description: "Experienced in PVC pipe systems" },
      
      { name: "Blueprint Reading", category: "General", description: "Able to read and interpret construction blueprints" },
      { name: "Surveying/Layout", category: "General", description: "Skilled in site layout and surveying" },
      { name: "Welding", category: "General", description: "Certified welder for structural and pipe welding" },
      { name: "Painting", category: "General", description: "Skilled in commercial and industrial painting" },
      { name: "Roofing", category: "General", description: "Experienced in roofing installation and repair" },
      { name: "Masonry", category: "General", description: "Skilled in brick, block, and stone work" },
      
      { name: "Crew Leadership", category: "Leadership", description: "Experience leading construction crews" },
      { name: "Project Coordination", category: "Leadership", description: "Able to coordinate multiple trades and tasks" },
      { name: "Quality Control", category: "Leadership", description: "Trained in construction quality control procedures" },
    ];

    const existingSkills = await db.select({ name: skills.name }).from(skills);
    const existingNames = new Set(existingSkills.map(s => s.name.toLowerCase()));

    const newSkills = predefinedSkills.filter(
      skill => !existingNames.has(skill.name.toLowerCase())
    );

    if (newSkills.length === 0) {
      res.status(200).json({ message: "All skills already exist", created: 0 });
      return;
    }

    const createdSkills = await db.insert(skills).values(newSkills).returning();

    for (const skill of createdSkills) {
      await logCreate(req.user!.id, "skills", skill.id, {
        name: skill.name,
        category: skill.category,
        generated: true,
      }, req);
    }

    res.status(201).json({ 
      message: `Generated ${createdSkills.length} new skills`,
      created: createdSkills.length,
      skills: createdSkills 
    });
  } catch (error) {
    logError("Error generating skills:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/skills/:id", requireRole("ADMIN"), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const [existing] = await db.select().from(skills).where(eq(skills.id, id)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "Skill not found" });
      return;
    }

    await db.delete(skills).where(eq(skills.id, id));
    
    await logDelete(req.user!.id, "skills", id, { name: existing.name }, req);

    res.json({ success: true });
  } catch (error) {
    logError("Error deleting skill:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/users/:userId/skills", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { userId } = req.params;

    const userSkillsList = await db
      .select({
        userSkill: userSkills,
        skill: skills,
      })
      .from(userSkills)
      .innerJoin(skills, eq(userSkills.skillId, skills.id))
      .where(eq(userSkills.userId, userId))
      .orderBy(skills.category, skills.name);

    res.json(userSkillsList);
  } catch (error) {
    logError("Error fetching user skills:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/users/:userId/skills", requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const { userId } = req.params;
    const { skillId, proficiencyLevel, yearsExperience } = req.body;

    if (!skillId) {
      res.status(400).json({ error: "skillId is required" });
      return;
    }

    const [existing] = await db
      .select()
      .from(userSkills)
      .where(and(eq(userSkills.userId, userId), eq(userSkills.skillId, skillId)))
      .limit(1);

    if (existing) {
      res.status(400).json({ error: "User already has this skill" });
      return;
    }

    const [newUserSkill] = await db
      .insert(userSkills)
      .values({ userId, skillId, proficiencyLevel, yearsExperience })
      .returning();

    await logCreate(req.user!.id, "user_skills", newUserSkill.id, {
      userId,
      skillId,
      proficiencyLevel,
    }, req);

    res.status(201).json(newUserSkill);
  } catch (error) {
    logError("Error assigning skill:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/users/:userId/skills/:skillId", requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const { userId, skillId } = req.params;

    const [existing] = await db
      .select()
      .from(userSkills)
      .where(and(eq(userSkills.userId, userId), eq(userSkills.skillId, skillId)))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "User skill not found" });
      return;
    }

    await db
      .delete(userSkills)
      .where(and(eq(userSkills.userId, userId), eq(userSkills.skillId, skillId)));

    await logDelete(req.user!.id, "user_skills", existing.id, {
      userId,
      skillId,
    }, req);

    res.json({ success: true});
  } catch (error) {
    logError("Error removing skill:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
