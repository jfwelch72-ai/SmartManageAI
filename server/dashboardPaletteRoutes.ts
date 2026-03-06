import { Router, type Response } from "express";
import { db } from "./db";
import {
  userDashboardPermissions,
  userColorPalettes,
  type UserColorPalette,
  type PaletteValidationResult,
  type ColorContrastResult
} from "@shared/schema";
import { requireAuth, type AuthRequest } from "./auth";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { PRESET_PALETTES } from "./dashboardDefaults";

const router = Router();

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

function getRelativeLuminance(r: number, g: number, b: number): number {
  const rsRGB = r / 255;
  const gsRGB = g / 255;
  const bsRGB = b / 255;
  
  const rL = rsRGB <= 0.03928 ? rsRGB / 12.92 : Math.pow((rsRGB + 0.055) / 1.055, 2.4);
  const gL = gsRGB <= 0.03928 ? gsRGB / 12.92 : Math.pow((gsRGB + 0.055) / 1.055, 2.4);
  const bL = bsRGB <= 0.03928 ? bsRGB / 12.92 : Math.pow((bsRGB + 0.055) / 1.055, 2.4);
  
  return 0.2126 * rL + 0.7152 * gL + 0.0722 * bL;
}

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

router.get('/palettes/presets', requireAuth, async (req: AuthRequest, res: Response) => {
  res.json(PRESET_PALETTES);
});

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

router.post('/palette', requireAuth, async (req: AuthRequest, res: Response) => {
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

      if (permission && !permission.canCustomizeColorScheme) {
        return res.status(403).json({ error: 'Color scheme customization not permitted' });
      }
    }

    const schema = z.object({
      paletteName: z.string().min(1).max(50),
      isPreset: z.boolean().optional(),
      setActive: z.boolean().optional(),
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

    const lightValidation = validatePalette(data, 'light');
    const darkValidation = validatePalette(data, 'dark');

    const hasContrastWarnings = !lightValidation.isValid || !darkValidation.isValid;

    if (data.setActive) {
      await db.update(userColorPalettes)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(
          eq(userColorPalettes.organizationId, orgId),
          eq(userColorPalettes.userId, userId)
        ));
    }

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

router.put('/palette/:paletteId/activate', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { paletteId } = req.params;
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;

    if (!orgId) {
      return res.status(403).json({ error: 'Organization required' });
    }

    const [palette] = await db.select().from(userColorPalettes)
      .where(and(
        eq(userColorPalettes.id, paletteId),
        eq(userColorPalettes.organizationId, orgId),
        eq(userColorPalettes.userId, userId)
      ));

    if (!palette) {
      return res.status(404).json({ error: 'Palette not found' });
    }

    await db.update(userColorPalettes)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(
        eq(userColorPalettes.organizationId, orgId),
        eq(userColorPalettes.userId, userId)
      ));

    await db.update(userColorPalettes)
      .set({ isActive: true, updatedAt: new Date() })
      .where(eq(userColorPalettes.id, paletteId));

    res.json({ success: true });
  } catch (error) {
    console.error('Error activating palette:', error);
    res.status(500).json({ error: 'Failed to activate palette' });
  }
});

router.post('/palette/deactivate', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;

    if (!orgId) {
      return res.json({ success: true });
    }

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

router.delete('/palette/:paletteId', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { paletteId } = req.params;
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;

    if (!orgId) {
      return res.status(403).json({ error: 'Organization required' });
    }

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
