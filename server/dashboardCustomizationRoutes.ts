import { Router, type Response } from "express";
import { db } from "./db";
import { 
  userDashboardPermissions, 
  userDashboardLayouts, 
  userColorPalettes,
  users,
  type UserDashboardPermission,
  type UserDashboardLayout,
  type UserColorPalette,
  type DashboardLayoutConfig,
  type PaletteValidationResult,
  type ColorContrastResult
} from "@shared/schema";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const router = Router();

// ============================================
// WCAG CONTRAST VALIDATION UTILITIES
// ============================================

// Parse HSL string to components (format: "220 14% 96%")
function parseHSL(hsl: string): { h: number; s: number; l: number } | null {
  if (!hsl) return null;
  const parts = hsl.trim().split(/\s+/);
  if (parts.length !== 3) return null;
  
  const h = parseFloat(parts[0]);
  const s = parseFloat(parts[1].replace('%', ''));
  const l = parseFloat(parts[2].replace('%', ''));
  
  if (isNaN(h) || isNaN(s) || isNaN(l)) return null;
  return { h, s, l };
}

// Convert HSL to RGB
function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  s /= 100;
  l /= 100;
  
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  
  let r = 0, g = 0, b = 0;
  
  if (h >= 0 && h < 60) { r = c; g = x; b = 0; }
  else if (h >= 60 && h < 120) { r = x; g = c; b = 0; }
  else if (h >= 120 && h < 180) { r = 0; g = c; b = x; }
  else if (h >= 180 && h < 240) { r = 0; g = x; b = c; }
  else if (h >= 240 && h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  };
}

// Calculate relative luminance (WCAG formula)
function getRelativeLuminance(r: number, g: number, b: number): number {
  const rsRGB = r / 255;
  const gsRGB = g / 255;
  const bsRGB = b / 255;
  
  const rL = rsRGB <= 0.03928 ? rsRGB / 12.92 : Math.pow((rsRGB + 0.055) / 1.055, 2.4);
  const gL = gsRGB <= 0.03928 ? gsRGB / 12.92 : Math.pow((gsRGB + 0.055) / 1.055, 2.4);
  const bL = bsRGB <= 0.03928 ? bsRGB / 12.92 : Math.pow((bsRGB + 0.055) / 1.055, 2.4);
  
  return 0.2126 * rL + 0.7152 * gL + 0.0722 * bL;
}

// Calculate contrast ratio between two colors
function getContrastRatio(hsl1: string, hsl2: string): number | null {
  const color1 = parseHSL(hsl1);
  const color2 = parseHSL(hsl2);
  
  if (!color1 || !color2) return null;
  
  const rgb1 = hslToRgb(color1.h, color1.s, color1.l);
  const rgb2 = hslToRgb(color2.h, color2.s, color2.l);
  
  const l1 = getRelativeLuminance(rgb1.r, rgb1.g, rgb1.b);
  const l2 = getRelativeLuminance(rgb2.r, rgb2.g, rgb2.b);
  
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  
  return (lighter + 0.05) / (darker + 0.05);
}

// Validate a color pair meets WCAG AA standard (4.5:1 for normal text)
function validateColorPair(foreground: string, background: string, pairName: string): ColorContrastResult {
  const ratio = getContrastRatio(foreground, background);
  
  if (ratio === null) {
    return { isValid: false, contrastRatio: 0, wcagLevel: "FAIL", pair: pairName };
  }
  
  let wcagLevel: "AAA" | "AA" | "FAIL";
  if (ratio >= 7) wcagLevel = "AAA";
  else if (ratio >= 4.5) wcagLevel = "AA";
  else wcagLevel = "FAIL";
  
  return {
    isValid: ratio >= 4.5,
    contrastRatio: Math.round(ratio * 100) / 100,
    wcagLevel,
    pair: pairName
  };
}

// Validate entire palette for accessibility
function validatePalette(palette: Partial<UserColorPalette>, mode: 'light' | 'dark'): PaletteValidationResult {
  const results: ColorContrastResult[] = [];
  const failedPairs: string[] = [];
  
  const pairs = mode === 'light' ? [
    { fg: palette.lightForeground, bg: palette.lightBackground, name: 'foreground/background' },
    { fg: palette.lightPrimaryForeground, bg: palette.lightPrimary, name: 'primary-foreground/primary' },
    { fg: palette.lightSecondaryForeground, bg: palette.lightSecondary, name: 'secondary-foreground/secondary' },
    { fg: palette.lightAccentForeground, bg: palette.lightAccent, name: 'accent-foreground/accent' },
    { fg: palette.lightMutedForeground, bg: palette.lightMuted, name: 'muted-foreground/muted' },
    { fg: palette.lightCardForeground, bg: palette.lightCard, name: 'card-foreground/card' },
  ] : [
    { fg: palette.darkForeground, bg: palette.darkBackground, name: 'foreground/background' },
    { fg: palette.darkPrimaryForeground, bg: palette.darkPrimary, name: 'primary-foreground/primary' },
    { fg: palette.darkSecondaryForeground, bg: palette.darkSecondary, name: 'secondary-foreground/secondary' },
    { fg: palette.darkAccentForeground, bg: palette.darkAccent, name: 'accent-foreground/accent' },
    { fg: palette.darkMutedForeground, bg: palette.darkMuted, name: 'muted-foreground/muted' },
    { fg: palette.darkCardForeground, bg: palette.darkCard, name: 'card-foreground/card' },
  ];
  
  for (const pair of pairs) {
    if (pair.fg && pair.bg) {
      const result = validateColorPair(pair.fg, pair.bg, `${mode}:${pair.name}`);
      results.push(result);
      if (!result.isValid) {
        failedPairs.push(result.pair);
      }
    }
  }
  
  return {
    isValid: failedPairs.length === 0,
    results,
    failedPairs
  };
}

// ============================================
// DEFAULT LAYOUT CONFIGURATION
// ============================================

const KNOWN_WIDGET_TYPES = [
  'QUICK_STATS', 'WEATHER', 'AI_INSIGHTS', 'MESSAGES', 'NOTIFICATIONS',
  'CALENDAR_EVENTS', 'AI_TASKS', 'OUTSTANDING_ITEMS', 'ACTIVE_PROJECTS',
  'ACTIVE_BIDS', 'CREW_OVERVIEW', 'PROJECT_ASSIGNMENTS'
];

const DEFAULT_WIDGETS: DashboardLayoutConfig = {
  widgets: [
    { id: 'quick-stats', type: 'QUICK_STATS', x: 0, y: 0, w: 12, h: 3, visible: true, minW: 6, minH: 2, maxW: 12, maxH: 4 },
    { id: 'weather', type: 'WEATHER', x: 0, y: 3, w: 12, h: 4, visible: true, minW: 6, minH: 3, maxW: 12, maxH: 6 },
    { id: 'ai-insights', type: 'AI_INSIGHTS', x: 0, y: 7, w: 12, h: 5, visible: true, minW: 6, minH: 3, maxW: 12, maxH: 8 },
    { id: 'messages', type: 'MESSAGES', x: 0, y: 12, w: 4, h: 6, visible: true, minW: 3, minH: 4, maxW: 8, maxH: 10 },
    { id: 'notifications', type: 'NOTIFICATIONS', x: 4, y: 12, w: 4, h: 6, visible: true, minW: 3, minH: 4, maxW: 8, maxH: 10 },
    { id: 'calendar-events', type: 'CALENDAR_EVENTS', x: 8, y: 12, w: 4, h: 6, visible: true, minW: 3, minH: 4, maxW: 8, maxH: 10 },
    { id: 'ai-tasks', type: 'AI_TASKS', x: 0, y: 18, w: 4, h: 5, visible: true, minW: 3, minH: 3, maxW: 8, maxH: 8 },
    { id: 'outstanding-items', type: 'OUTSTANDING_ITEMS', x: 4, y: 18, w: 4, h: 6, visible: true, minW: 3, minH: 4, maxW: 8, maxH: 10 },
    { id: 'active-projects', type: 'ACTIVE_PROJECTS', x: 8, y: 18, w: 4, h: 6, visible: true, minW: 3, minH: 4, maxW: 8, maxH: 10 },
    { id: 'active-bids', type: 'ACTIVE_BIDS', x: 0, y: 24, w: 4, h: 6, visible: true, minW: 3, minH: 4, maxW: 8, maxH: 10 },
    { id: 'project-assignments', type: 'PROJECT_ASSIGNMENTS', x: 4, y: 24, w: 8, h: 4, visible: true, minW: 6, minH: 3, maxW: 12, maxH: 6 },
  ],
  gridCols: 12,
  version: 2
};

// Preset color palettes
const PRESET_PALETTES = {
  default: {
    name: 'Default Blue',
    light: {
      primary: '222 47% 11%',
      primaryForeground: '210 40% 98%',
      secondary: '210 40% 96%',
      secondaryForeground: '222 47% 11%',
      accent: '210 40% 96%',
      accentForeground: '222 47% 11%',
      background: '0 0% 100%',
      foreground: '222 47% 11%',
      muted: '210 40% 96%',
      mutedForeground: '215 16% 43%',
      card: '0 0% 100%',
      cardForeground: '222 47% 11%',
      border: '214 32% 91%',
    },
    dark: {
      primary: '210 40% 98%',
      primaryForeground: '222 47% 11%',
      secondary: '217 33% 17%',
      secondaryForeground: '210 40% 98%',
      accent: '217 33% 17%',
      accentForeground: '210 40% 98%',
      background: '222 47% 11%',
      foreground: '210 40% 98%',
      muted: '217 33% 17%',
      mutedForeground: '215 20% 65%',
      card: '222 47% 11%',
      cardForeground: '210 40% 98%',
      border: '217 33% 17%',
    }
  },
  forest: {
    name: 'Forest Green',
    light: {
      primary: '142 76% 30%',
      primaryForeground: '0 0% 100%',
      secondary: '138 30% 90%',
      secondaryForeground: '142 76% 20%',
      accent: '142 50% 32%',
      accentForeground: '0 0% 100%',
      background: '0 0% 100%',
      foreground: '142 76% 10%',
      muted: '138 30% 90%',
      mutedForeground: '142 20% 36%',
      card: '0 0% 100%',
      cardForeground: '142 76% 10%',
      border: '142 30% 85%',
    },
    dark: {
      primary: '142 70% 50%',
      primaryForeground: '0 0% 0%',
      secondary: '142 30% 20%',
      secondaryForeground: '142 70% 85%',
      accent: '142 50% 30%',
      accentForeground: '0 0% 100%',
      background: '142 30% 8%',
      foreground: '142 10% 95%',
      muted: '142 30% 15%',
      mutedForeground: '142 20% 60%',
      card: '142 30% 10%',
      cardForeground: '142 10% 95%',
      border: '142 30% 20%',
    }
  },
  sunset: {
    name: 'Sunset Orange',
    light: {
      primary: '25 95% 38%',
      primaryForeground: '0 0% 100%',
      secondary: '30 50% 92%',
      secondaryForeground: '25 95% 25%',
      accent: '25 80% 40%',
      accentForeground: '0 0% 100%',
      background: '0 0% 100%',
      foreground: '25 50% 10%',
      muted: '30 50% 92%',
      mutedForeground: '25 30% 40%',
      card: '0 0% 100%',
      cardForeground: '25 50% 10%',
      border: '25 40% 88%',
    },
    dark: {
      primary: '25 95% 60%',
      primaryForeground: '0 0% 0%',
      secondary: '25 40% 18%',
      secondaryForeground: '25 90% 85%',
      accent: '25 80% 38%',
      accentForeground: '0 0% 100%',
      background: '25 30% 8%',
      foreground: '25 10% 95%',
      muted: '25 30% 15%',
      mutedForeground: '25 20% 60%',
      card: '25 30% 10%',
      cardForeground: '25 10% 95%',
      border: '25 30% 20%',
    }
  },
  ocean: {
    name: 'Ocean Blue',
    light: {
      primary: '200 95% 36%',
      primaryForeground: '0 0% 100%',
      secondary: '200 50% 92%',
      secondaryForeground: '200 95% 20%',
      accent: '200 80% 38%',
      accentForeground: '0 0% 100%',
      background: '0 0% 100%',
      foreground: '200 50% 10%',
      muted: '200 50% 92%',
      mutedForeground: '200 30% 40%',
      card: '0 0% 100%',
      cardForeground: '200 50% 10%',
      border: '200 40% 88%',
    },
    dark: {
      primary: '200 90% 55%',
      primaryForeground: '0 0% 0%',
      secondary: '200 40% 18%',
      secondaryForeground: '200 90% 85%',
      accent: '200 70% 33%',
      accentForeground: '0 0% 100%',
      background: '200 30% 8%',
      foreground: '200 10% 95%',
      muted: '200 30% 15%',
      mutedForeground: '200 20% 60%',
      card: '200 30% 10%',
      cardForeground: '200 10% 95%',
      border: '200 30% 20%',
    }
  },
  royal: {
    name: 'Royal Purple',
    light: {
      primary: '271 81% 56%',
      primaryForeground: '0 0% 100%',
      secondary: '270 50% 92%',
      secondaryForeground: '271 81% 25%',
      accent: '271 70% 58%',
      accentForeground: '0 0% 100%',
      background: '0 0% 100%',
      foreground: '271 50% 10%',
      muted: '270 50% 92%',
      mutedForeground: '271 30% 40%',
      card: '0 0% 100%',
      cardForeground: '271 50% 10%',
      border: '271 40% 88%',
    },
    dark: {
      primary: '271 80% 65%',
      primaryForeground: '0 0% 0%',
      secondary: '271 40% 18%',
      secondaryForeground: '271 80% 85%',
      accent: '271 60% 45%',
      accentForeground: '0 0% 100%',
      background: '271 30% 8%',
      foreground: '271 10% 95%',
      muted: '271 30% 15%',
      mutedForeground: '271 20% 60%',
      card: '271 30% 10%',
      cardForeground: '271 10% 95%',
      border: '271 30% 20%',
    }
  }
};

// ============================================
// PERMISSION MANAGEMENT ENDPOINTS (Admin Only)
// ============================================

// Get all user permissions for the organization
router.get('/permissions', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: 'Organization required' });
    }

    // Get all users in the organization with their permissions
    const orgUsers = await db.select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      role: users.role,
    }).from(users).where(eq(users.organizationId, orgId));

    const permissions = await db.select().from(userDashboardPermissions)
      .where(eq(userDashboardPermissions.organizationId, orgId));

    // Merge user data with permissions
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

// Update user permissions
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

    // Verify user belongs to same organization
    const [targetUser] = await db.select().from(users)
      .where(and(eq(users.id, userId), eq(users.organizationId, orgId)));

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found in your organization' });
    }

    // Upsert permission record
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

// Get current user's permissions
router.get('/my-permissions', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;
    const role = req.user!.role;

    // Admins always have full permissions
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
      canCustomizeDashboard: permission?.canCustomizeDashboard || false,
      canCustomizeColorScheme: permission?.canCustomizeColorScheme || false,
    });
  } catch (error) {
    console.error('Error fetching user permissions:', error);
    res.status(500).json({ error: 'Failed to fetch permissions' });
  }
});

// ============================================
// DASHBOARD LAYOUT ENDPOINTS
// ============================================

// Get user's dashboard layout
router.get('/layout', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;

    if (!orgId) {
      return res.json({ layout: DEFAULT_WIDGETS, isCustom: false });
    }

    const [layout] = await db.select().from(userDashboardLayouts)
      .where(and(
        eq(userDashboardLayouts.organizationId, orgId),
        eq(userDashboardLayouts.userId, userId)
      ));

    if (layout) {
      try {
        const config = JSON.parse(layout.layoutConfig) as DashboardLayoutConfig;
        if (!config.version || config.version < DEFAULT_WIDGETS.version) {
          return res.json({ layout: DEFAULT_WIDGETS, isCustom: false });
        }
        return res.json({ layout: config, isCustom: layout.isCustom });
      } catch {
        return res.json({ layout: DEFAULT_WIDGETS, isCustom: false });
      }
    }

    res.json({ layout: DEFAULT_WIDGETS, isCustom: false });
  } catch (error) {
    console.error('Error fetching layout:', error);
    res.status(500).json({ error: 'Failed to fetch layout' });
  }
});

// Get default layout
router.get('/layout/default', requireAuth, async (req: AuthRequest, res: Response) => {
  res.json({ layout: DEFAULT_WIDGETS });
});

// Save user's dashboard layout
router.put('/layout', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;
    const role = req.user!.role;

    if (!orgId) {
      return res.status(403).json({ error: 'Organization required' });
    }

    // Check permissions (admins always allowed)
    if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
      const [permission] = await db.select().from(userDashboardPermissions)
        .where(and(
          eq(userDashboardPermissions.organizationId, orgId),
          eq(userDashboardPermissions.userId, userId)
        ));

      if (!permission?.canCustomizeDashboard) {
        return res.status(403).json({ error: 'Dashboard customization not permitted' });
      }
    }

    const schema = z.object({
      layout: z.object({
        widgets: z.array(z.object({
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
        })),
        gridCols: z.number(),
        version: z.number(),
      }),
    });

    const { layout } = schema.parse(req.body);

    const unknownTypes = layout.widgets
      .map(w => w.type)
      .filter(t => !KNOWN_WIDGET_TYPES.includes(t));
    if (unknownTypes.length > 0) {
      return res.status(400).json({ error: `Unknown widget types: ${unknownTypes.join(', ')}` });
    }

    // Upsert layout
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

// Reset layout to default
router.post('/layout/reset', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;

    if (!orgId) {
      return res.json({ layout: DEFAULT_WIDGETS });
    }

    // Delete custom layout
    await db.delete(userDashboardLayouts)
      .where(and(
        eq(userDashboardLayouts.organizationId, orgId),
        eq(userDashboardLayouts.userId, userId)
      ));

    res.json({ success: true, layout: DEFAULT_WIDGETS });
  } catch (error) {
    console.error('Error resetting layout:', error);
    res.status(500).json({ error: 'Failed to reset layout' });
  }
});

// ============================================
// COLOR PALETTE ENDPOINTS
// ============================================

// Get preset palettes
router.get('/palettes/presets', requireAuth, async (req: AuthRequest, res: Response) => {
  res.json(PRESET_PALETTES);
});

// Get user's active color palette
router.get('/palette', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;

    if (!orgId) {
      return res.json({ palette: null, isActive: false });
    }

    const [palette] = await db.select().from(userColorPalettes)
      .where(and(
        eq(userColorPalettes.organizationId, orgId),
        eq(userColorPalettes.userId, userId),
        eq(userColorPalettes.isActive, true)
      ));

    res.json({ palette: palette || null, isActive: !!palette });
  } catch (error) {
    console.error('Error fetching palette:', error);
    res.status(500).json({ error: 'Failed to fetch palette' });
  }
});

// Get all user's saved palettes
router.get('/palettes', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;

    if (!orgId) {
      return res.json([]);
    }

    const palettes = await db.select().from(userColorPalettes)
      .where(and(
        eq(userColorPalettes.organizationId, orgId),
        eq(userColorPalettes.userId, userId)
      ));

    res.json(palettes);
  } catch (error) {
    console.error('Error fetching palettes:', error);
    res.status(500).json({ error: 'Failed to fetch palettes' });
  }
});

// Validate a color palette
router.post('/palette/validate', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const palette = req.body;
    
    const lightValidation = validatePalette(palette, 'light');
    const darkValidation = validatePalette(palette, 'dark');

    res.json({
      isValid: lightValidation.isValid && darkValidation.isValid,
      light: lightValidation,
      dark: darkValidation,
    });
  } catch (error) {
    console.error('Error validating palette:', error);
    res.status(500).json({ error: 'Failed to validate palette' });
  }
});

// Save a color palette
router.post('/palette', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;
    const role = req.user!.role;

    if (!orgId) {
      return res.status(403).json({ error: 'Organization required' });
    }

    // Check permissions
    if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
      const [permission] = await db.select().from(userDashboardPermissions)
        .where(and(
          eq(userDashboardPermissions.organizationId, orgId),
          eq(userDashboardPermissions.userId, userId)
        ));

      if (!permission?.canCustomizeColorScheme) {
        return res.status(403).json({ error: 'Color scheme customization not permitted' });
      }
    }

    const schema = z.object({
      paletteName: z.string().min(1).max(50),
      isPreset: z.boolean().optional(),
      setActive: z.boolean().optional(),
      // Light mode
      lightPrimary: z.string().optional(),
      lightPrimaryForeground: z.string().optional(),
      lightSecondary: z.string().optional(),
      lightSecondaryForeground: z.string().optional(),
      lightAccent: z.string().optional(),
      lightAccentForeground: z.string().optional(),
      lightBackground: z.string().optional(),
      lightForeground: z.string().optional(),
      lightMuted: z.string().optional(),
      lightMutedForeground: z.string().optional(),
      lightCard: z.string().optional(),
      lightCardForeground: z.string().optional(),
      lightBorder: z.string().optional(),
      // Dark mode
      darkPrimary: z.string().optional(),
      darkPrimaryForeground: z.string().optional(),
      darkSecondary: z.string().optional(),
      darkSecondaryForeground: z.string().optional(),
      darkAccent: z.string().optional(),
      darkAccentForeground: z.string().optional(),
      darkBackground: z.string().optional(),
      darkForeground: z.string().optional(),
      darkMuted: z.string().optional(),
      darkMutedForeground: z.string().optional(),
      darkCard: z.string().optional(),
      darkCardForeground: z.string().optional(),
      darkBorder: z.string().optional(),
    });

    const data = schema.parse(req.body);

    // Validate contrast ratios
    const lightValidation = validatePalette(data, 'light');
    const darkValidation = validatePalette(data, 'dark');

    const hasContrastWarnings = !lightValidation.isValid || !darkValidation.isValid;

    // If setting as active, deactivate other palettes
    if (data.setActive) {
      await db.update(userColorPalettes)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(
          eq(userColorPalettes.organizationId, orgId),
          eq(userColorPalettes.userId, userId)
        ));
    }

    // Insert new palette
    const [newPalette] = await db.insert(userColorPalettes).values({
      organizationId: orgId,
      userId,
      paletteName: data.paletteName,
      isPreset: data.isPreset || false,
      isActive: data.setActive || false,
      contrastValidated: !hasContrastWarnings,
      lastValidatedAt: new Date(),
      lightPrimary: data.lightPrimary,
      lightPrimaryForeground: data.lightPrimaryForeground,
      lightSecondary: data.lightSecondary,
      lightSecondaryForeground: data.lightSecondaryForeground,
      lightAccent: data.lightAccent,
      lightAccentForeground: data.lightAccentForeground,
      lightBackground: data.lightBackground,
      lightForeground: data.lightForeground,
      lightMuted: data.lightMuted,
      lightMutedForeground: data.lightMutedForeground,
      lightCard: data.lightCard,
      lightCardForeground: data.lightCardForeground,
      lightBorder: data.lightBorder,
      darkPrimary: data.darkPrimary,
      darkPrimaryForeground: data.darkPrimaryForeground,
      darkSecondary: data.darkSecondary,
      darkSecondaryForeground: data.darkSecondaryForeground,
      darkAccent: data.darkAccent,
      darkAccentForeground: data.darkAccentForeground,
      darkBackground: data.darkBackground,
      darkForeground: data.darkForeground,
      darkMuted: data.darkMuted,
      darkMutedForeground: data.darkMutedForeground,
      darkCard: data.darkCard,
      darkCardForeground: data.darkCardForeground,
      darkBorder: data.darkBorder,
    }).returning();

    const response: any = { success: true, palette: newPalette };
    if (hasContrastWarnings) {
      response.contrastWarnings = {
        message: 'Some color pairs may have low contrast for accessibility',
        light: lightValidation,
        dark: darkValidation,
      };
    }
    res.json(response);
  } catch (error) {
    console.error('Error saving palette:', error);
    res.status(500).json({ error: 'Failed to save palette' });
  }
});

// Activate a saved palette
router.put('/palette/:paletteId/activate', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { paletteId } = req.params;
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;

    if (!orgId) {
      return res.status(403).json({ error: 'Organization required' });
    }

    // Verify palette belongs to user
    const [palette] = await db.select().from(userColorPalettes)
      .where(and(
        eq(userColorPalettes.id, paletteId),
        eq(userColorPalettes.organizationId, orgId),
        eq(userColorPalettes.userId, userId)
      ));

    if (!palette) {
      return res.status(404).json({ error: 'Palette not found' });
    }

    // Deactivate other palettes
    await db.update(userColorPalettes)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(
        eq(userColorPalettes.organizationId, orgId),
        eq(userColorPalettes.userId, userId)
      ));

    // Activate selected palette
    await db.update(userColorPalettes)
      .set({ isActive: true, updatedAt: new Date() })
      .where(eq(userColorPalettes.id, paletteId));

    res.json({ success: true });
  } catch (error) {
    console.error('Error activating palette:', error);
    res.status(500).json({ error: 'Failed to activate palette' });
  }
});

// Deactivate palette (use default)
router.post('/palette/deactivate', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;

    if (!orgId) {
      return res.json({ success: true });
    }

    // Deactivate all palettes
    await db.update(userColorPalettes)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(
        eq(userColorPalettes.organizationId, orgId),
        eq(userColorPalettes.userId, userId)
      ));

    res.json({ success: true });
  } catch (error) {
    console.error('Error deactivating palette:', error);
    res.status(500).json({ error: 'Failed to deactivate palette' });
  }
});

// Delete a saved palette
router.delete('/palette/:paletteId', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { paletteId } = req.params;
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;

    if (!orgId) {
      return res.status(403).json({ error: 'Organization required' });
    }

    // Verify palette belongs to user
    const [palette] = await db.select().from(userColorPalettes)
      .where(and(
        eq(userColorPalettes.id, paletteId),
        eq(userColorPalettes.organizationId, orgId),
        eq(userColorPalettes.userId, userId)
      ));

    if (!palette) {
      return res.status(404).json({ error: 'Palette not found' });
    }

    await db.delete(userColorPalettes)
      .where(eq(userColorPalettes.id, paletteId));

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting palette:', error);
    res.status(500).json({ error: 'Failed to delete palette' });
  }
});

export default router;
