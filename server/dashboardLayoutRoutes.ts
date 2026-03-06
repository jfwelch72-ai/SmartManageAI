import { Router, type Response } from "express";
import { db } from "./db";
import {
  userDashboardPermissions,
  userDashboardLayouts,
  users,
  type DashboardLayoutConfig
} from "@shared/schema";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { KNOWN_WIDGET_TYPES, migrateV2ToV3, getDefaultLayoutForRole } from "./dashboardDefaults";

const router = Router();

router.get('/permissions', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: 'Organization required' });
    }

    const orgUsers = await db.select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      role: users.role,
    }).from(users).where(eq(users.organizationId, orgId));

    const permissions = await db.select().from(userDashboardPermissions)
      .where(eq(userDashboardPermissions.organizationId, orgId));

    const usersWithPermissions = orgUsers.map(user => {
      const perm = permissions.find(p => p.userId === user.id);
      return {
        ...user,
        canCustomizeDashboard: perm?.canCustomizeDashboard || false,
        canCustomizeColorScheme: perm?.canCustomizeColorScheme || false,
        grantedAt: perm?.grantedAt,
      };
    });

    res.json(usersWithPermissions);
  } catch (error) {
    console.error('Error fetching permissions:', error);
    res.status(500).json({ error: 'Failed to fetch permissions' });
  }
});

router.put('/permissions/:userId', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;
    const orgId = req.user!.organizationId;
    const adminId = req.user!.id;

    if (!orgId) {
      return res.status(403).json({ error: 'Organization required' });
    }

    const schema = z.object({
      canCustomizeDashboard: z.boolean(),
      canCustomizeColorScheme: z.boolean(),
    });

    const data = schema.parse(req.body);

    const [targetUser] = await db.select().from(users)
      .where(and(eq(users.id, userId), eq(users.organizationId, orgId)));

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found in your organization' });
    }

    const existing = await db.select().from(userDashboardPermissions)
      .where(and(
        eq(userDashboardPermissions.organizationId, orgId),
        eq(userDashboardPermissions.userId, userId)
      ));

    if (existing.length > 0) {
      await db.update(userDashboardPermissions)
        .set({
          canCustomizeDashboard: data.canCustomizeDashboard,
          canCustomizeColorScheme: data.canCustomizeColorScheme,
          grantedByUserId: adminId,
          grantedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(userDashboardPermissions.id, existing[0].id));
    } else {
      await db.insert(userDashboardPermissions).values({
        organizationId: orgId,
        userId,
        canCustomizeDashboard: data.canCustomizeDashboard,
        canCustomizeColorScheme: data.canCustomizeColorScheme,
        grantedByUserId: adminId,
        grantedAt: new Date(),
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating permissions:', error);
    res.status(500).json({ error: 'Failed to update permissions' });
  }
});

router.get('/my-permissions', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;
    const role = req.user!.role;

    if (role === 'ADMIN' || role === 'SUPER_ADMIN') {
      return res.json({
        canCustomizeDashboard: true,
        canCustomizeColorScheme: true,
      });
    }

    if (!orgId) {
      return res.json({
        canCustomizeDashboard: false,
        canCustomizeColorScheme: false,
      });
    }

    const [permission] = await db.select().from(userDashboardPermissions)
      .where(and(
        eq(userDashboardPermissions.organizationId, orgId),
        eq(userDashboardPermissions.userId, userId)
      ));

    res.json({
      canCustomizeDashboard: permission?.canCustomizeDashboard ?? true,
      canCustomizeColorScheme: permission?.canCustomizeColorScheme ?? true,
    });
  } catch (error) {
    console.error('Error fetching user permissions:', error);
    res.status(500).json({ error: 'Failed to fetch permissions' });
  }
});

router.get('/layout', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;

    const roleDefault = getDefaultLayoutForRole(req.user!.role || '');

    if (!orgId) {
      return res.json({ layout: roleDefault, isCustom: false });
    }

    const [layout] = await db.select().from(userDashboardLayouts)
      .where(and(
        eq(userDashboardLayouts.organizationId, orgId),
        eq(userDashboardLayouts.userId, userId)
      ));

    if (layout) {
      try {
        const config = JSON.parse(layout.layoutConfig);
        if (config.version === 2 && config.widgets && !config.sections) {
          const migrated = migrateV2ToV3(config);
          return res.json({ layout: migrated, isCustom: layout.isCustom });
        }
        if (!config.version || config.version < 3) {
          return res.json({ layout: roleDefault, isCustom: false });
        }
        return res.json({ layout: config as DashboardLayoutConfig, isCustom: layout.isCustom });
      } catch {
        return res.json({ layout: roleDefault, isCustom: false });
      }
    }

    res.json({ layout: roleDefault, isCustom: false });
  } catch (error) {
    console.error('Error fetching layout:', error);
    res.status(500).json({ error: 'Failed to fetch layout' });
  }
});

router.get('/layout/default', requireAuth, async (req: AuthRequest, res: Response) => {
  const roleDefault = getDefaultLayoutForRole(req.user!.role || '');
  res.json({ layout: roleDefault });
});

router.put('/layout', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;
    const role = req.user!.role;

    if (!orgId) {
      return res.status(403).json({ error: 'Organization required' });
    }

    if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
      const [permission] = await db.select().from(userDashboardPermissions)
        .where(and(
          eq(userDashboardPermissions.organizationId, orgId),
          eq(userDashboardPermissions.userId, userId)
        ));

      if (permission && !permission.canCustomizeDashboard) {
        return res.status(403).json({ error: 'Dashboard customization not permitted' });
      }
    }

    const widgetSchema = z.object({
      id: z.string(),
      type: z.string(),
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
      visible: z.boolean(),
      minW: z.number().optional(),
      minH: z.number().optional(),
      maxW: z.number().optional(),
      maxH: z.number().optional(),
      config: z.record(z.any()).optional(),
    });

    const sectionSchema = z.object({
      id: z.string(),
      title: z.string(),
      columns: z.number().min(1).max(4),
      collapsed: z.boolean(),
      widgets: z.array(widgetSchema),
    });

    const schema = z.object({
      layout: z.object({
        sections: z.array(sectionSchema),
        gridCols: z.number(),
        version: z.number(),
      }),
    });

    const { layout } = schema.parse(req.body);

    const allWidgets = layout.sections.flatMap(s => s.widgets);
    const unknownTypes = allWidgets
      .map(w => w.type)
      .filter(t => !KNOWN_WIDGET_TYPES.includes(t));
    if (unknownTypes.length > 0) {
      return res.status(400).json({ error: `Unknown widget types: ${unknownTypes.join(', ')}` });
    }

    const [existing] = await db.select().from(userDashboardLayouts)
      .where(and(
        eq(userDashboardLayouts.organizationId, orgId),
        eq(userDashboardLayouts.userId, userId)
      ));

    if (existing) {
      await db.update(userDashboardLayouts)
        .set({
          layoutConfig: JSON.stringify(layout),
          isCustom: true,
          updatedAt: new Date(),
        })
        .where(eq(userDashboardLayouts.id, existing.id));
    } else {
      await db.insert(userDashboardLayouts).values({
        organizationId: orgId,
        userId,
        layoutConfig: JSON.stringify(layout),
        isCustom: true,
      });
    }

    res.json({ success: true, layout });
  } catch (error) {
    console.error('Error saving layout:', error);
    res.status(500).json({ error: 'Failed to save layout' });
  }
});

router.post('/layout/reset', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;

    const roleDefault = getDefaultLayoutForRole(req.user!.role || '');

    if (!orgId) {
      return res.json({ layout: roleDefault });
    }

    await db.delete(userDashboardLayouts)
      .where(and(
        eq(userDashboardLayouts.organizationId, orgId),
        eq(userDashboardLayouts.userId, userId)
      ));

    res.json({ success: true, layout: roleDefault });
  } catch (error) {
    console.error('Error resetting layout:', error);
    res.status(500).json({ error: 'Failed to reset layout' });
  }
});

export default router;
