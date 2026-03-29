/**
 * Calculator API Routes
 * Endpoints for material calculations and verification
 */

import { logError } from "./utils/logger";
import { Router } from 'express';
import { TradeCalculators } from './tradeCalculators';
import { CALCULATION_VERIFICATION_SUITE, runAllVerificationTests, printVerificationReport } from './calculatorVerification';
import { seedMasterCalculators } from './seedCalculators';

const router = Router();

// ============================================
// VERIFICATION ENDPOINT
// ============================================

/**
 * Run all calculator verification tests
 * GET /api/calculators/verify
 */
router.get('/verify', async (req, res) => {
  try {
    const summary = runAllVerificationTests();
    
    // Print to console for logging
    printVerificationReport(summary);
    
    res.json({
      success: true,
      summary: {
        totalTests: summary.totalTests,
        passed: summary.passed,
        failed: summary.failed,
        passRate: summary.passRate,
        byTrade: summary.byTrade,
      },
      failedTests: summary.results.filter(r => r.result === 'FAIL'),
      allResults: summary.results,
    });
  } catch (error: any) {
    logError('Verification error:', {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================
// CONCRETE CALCULATION ENDPOINTS
// ============================================

/**
 * Calculate concrete slab volume
 * POST /api/calculators/concrete/slab
 */
router.post('/concrete/slab', (req, res) => {
  try {
    const { areaSF, thicknessInches, wasteFactor } = req.body;
    const result = TradeCalculators.calculateConcreteSlabCY({ areaSF, thicknessInches, wasteFactor });
    res.json({ success: true, result, unit: 'CY' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * Calculate concrete footing volume
 * POST /api/calculators/concrete/footing
 */
router.post('/concrete/footing', (req, res) => {
  try {
    const { lengthLF, widthInches, depthInches, wasteFactor } = req.body;
    const result = TradeCalculators.calculateConcreteFootingCY({ lengthLF, widthInches, depthInches, wasteFactor });
    res.json({ success: true, result, unit: 'CY' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * Calculate concrete wall volume
 * POST /api/calculators/concrete/wall
 */
router.post('/concrete/wall', (req, res) => {
  try {
    const { lengthLF, heightFeet, thicknessInches, wasteFactor } = req.body;
    const result = TradeCalculators.calculateConcreteWallCY({ lengthLF, heightFeet, thicknessInches, wasteFactor });
    res.json({ success: true, result, unit: 'CY' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * Calculate rebar pieces
 * POST /api/calculators/concrete/rebar
 */
router.post('/concrete/rebar', (req, res) => {
  try {
    const { areaSF, spacingInches, barLengthFeet } = req.body;
    const result = TradeCalculators.calculateRebarPieces(areaSF, spacingInches, barLengthFeet);
    res.json({ success: true, result, unit: 'pieces' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * Calculate wire mesh rolls
 * POST /api/calculators/concrete/wiremesh
 */
router.post('/concrete/wiremesh', (req, res) => {
  try {
    const { areaSF, sfPerRoll } = req.body;
    const result = TradeCalculators.calculateWireMeshRolls(areaSF, sfPerRoll);
    res.json({ success: true, result, unit: 'rolls' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ============================================
// EARTHWORK CALCULATION ENDPOINTS
// ============================================

/**
 * Calculate excavation volume
 * POST /api/calculators/earthwork/excavation
 */
router.post('/earthwork/excavation', (req, res) => {
  try {
    const { areaSF, depthInches, swellFactor } = req.body;
    const result = TradeCalculators.calculateExcavationCY({ areaSF, depthInches, swellFactor });
    res.json({ success: true, result, unit: 'CY' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * Calculate stone base tons
 * POST /api/calculators/earthwork/stone
 */
router.post('/earthwork/stone', (req, res) => {
  try {
    const { areaSF, depthInches, wasteFactor } = req.body;
    const result = TradeCalculators.calculateStoneBaseTons(areaSF, depthInches, wasteFactor);
    res.json({ success: true, result, unit: 'tons' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ============================================
// ASPHALT CALCULATION ENDPOINTS
// ============================================

/**
 * Calculate asphalt tonnage
 * POST /api/calculators/asphalt/tonnage
 */
router.post('/asphalt/tonnage', (req, res) => {
  try {
    const { areaSF, thicknessInches, wasteFactor } = req.body;
    const result = TradeCalculators.calculateAsphaltTons({ areaSF, thicknessInches, wasteFactor });
    res.json({ success: true, result, unit: 'tons' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * Calculate sealcoat gallons
 * POST /api/calculators/asphalt/sealcoat
 */
router.post('/asphalt/sealcoat', (req, res) => {
  try {
    const { areaSF, coverageSFPerGallon, coats } = req.body;
    const result = TradeCalculators.calculateSealcoatGallons(areaSF, coverageSFPerGallon, coats);
    res.json({ success: true, result, unit: 'gallons' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ============================================
// ROOFING CALCULATION ENDPOINTS
// ============================================

/**
 * Calculate roofing squares with pitch
 * POST /api/calculators/roofing/squares
 */
router.post('/roofing/squares', (req, res) => {
  try {
    const { footprintSF, pitchRise } = req.body;
    const result = TradeCalculators.calculateRoofingSquares({ footprintSF, pitchRise });
    res.json({ success: true, result, unit: 'SQ' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * Calculate roof coating gallons
 * POST /api/calculators/roofing/coating
 */
router.post('/roofing/coating', (req, res) => {
  try {
    const { areaSF, milThickness, wasteFactor, coatingType } = req.body;
    let result: number;
    
    switch (coatingType) {
      case 'silicone':
        result = TradeCalculators.calculateSiliconeCoatingGallons(areaSF, milThickness);
        break;
      case 'acrylic':
        result = TradeCalculators.calculateAcrylicCoatingGallons(areaSF, milThickness);
        break;
      case 'polyurea':
        result = TradeCalculators.calculatePolyureaCoatingGallons(areaSF, milThickness);
        break;
      case 'elastomeric':
        result = TradeCalculators.calculateElastomericCoatingGallons(areaSF, milThickness);
        break;
      default:
        result = TradeCalculators.calculateRoofCoatingGallons({ areaSF, milThickness, wasteFactor });
    }
    
    res.json({ success: true, result, unit: 'gallons' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ============================================
// MASONRY CALCULATION ENDPOINTS
// ============================================

/**
 * Calculate CMU blocks
 * POST /api/calculators/masonry/cmu
 */
router.post('/masonry/cmu', (req, res) => {
  try {
    const { lengthFeet, heightFeet, blockWidthInches } = req.body;
    const result = TradeCalculators.calculateCMUBlocks({ lengthFeet, heightFeet, blockWidthInches });
    res.json({ success: true, result, unit: 'blocks' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * Calculate brick count
 * POST /api/calculators/masonry/brick
 */
router.post('/masonry/brick', (req, res) => {
  try {
    const { areaSF } = req.body;
    const result = TradeCalculators.calculateBrickCount(areaSF);
    res.json({ success: true, result, unit: 'bricks' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ============================================
// ELECTRICAL CALCULATION ENDPOINTS
// ============================================

/**
 * Calculate wire pull length
 * POST /api/calculators/electrical/wirepull
 */
router.post('/electrical/wirepull', (req, res) => {
  try {
    const { conduitLengthLF, pullBoxCount, wiresPerRun } = req.body;
    const result = TradeCalculators.calculateWirePullLF({ conduitLengthLF, pullBoxCount, wiresPerRun });
    res.json({ success: true, result, unit: 'LF' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * Calculate circuit amps
 * POST /api/calculators/electrical/circuit
 */
router.post('/electrical/circuit', (req, res) => {
  try {
    const { deviceCount, wattsPerDevice, voltage } = req.body;
    const result = TradeCalculators.calculateCircuitAmps({ deviceCount, wattsPerDevice, voltage });
    res.json({ success: true, result, unit: 'amps' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ============================================
// PLUMBING CALCULATION ENDPOINTS
// ============================================

/**
 * Calculate pipe length
 * POST /api/calculators/plumbing/pipe
 */
router.post('/plumbing/pipe', (req, res) => {
  try {
    const { lengthLF } = req.body;
    const result = TradeCalculators.calculatePipeLF(lengthLF);
    res.json({ success: true, result, unit: 'LF' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * Calculate pipe hangers
 * POST /api/calculators/plumbing/hangers
 */
router.post('/plumbing/hangers', (req, res) => {
  try {
    const { lengthLF, pipeDiameterInches } = req.body;
    const result = TradeCalculators.calculatePipeHangers(lengthLF, pipeDiameterInches);
    res.json({ success: true, result, unit: 'EA' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ============================================
// HVAC CALCULATION ENDPOINTS
// ============================================

/**
 * Calculate duct surface area
 * POST /api/calculators/hvac/duct
 */
router.post('/hvac/duct', (req, res) => {
  try {
    const { lengthLF, widthInches, heightInches } = req.body;
    const result = TradeCalculators.calculateDuctSF({ lengthLF, widthInches, heightInches });
    res.json({ success: true, result, unit: 'SF' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * Calculate HVAC tonnage
 * POST /api/calculators/hvac/tonnage
 */
router.post('/hvac/tonnage', (req, res) => {
  try {
    const { areaSF, sfPerTon } = req.body;
    const result = TradeCalculators.calculateHVACTons(areaSF, sfPerTon);
    res.json({ success: true, result, unit: 'tons' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ============================================
// FIRE PROTECTION CALCULATION ENDPOINTS
// ============================================

/**
 * Calculate sprinkler heads
 * POST /api/calculators/fireprotection/heads
 */
router.post('/fireprotection/heads', (req, res) => {
  try {
    const { areaSF, hazardLevel } = req.body;
    const result = TradeCalculators.calculateSprinklerHeads(areaSF, hazardLevel);
    res.json({ success: true, result, unit: 'EA' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ============================================
// LANDSCAPING CALCULATION ENDPOINTS
// ============================================

/**
 * Calculate mulch volume
 * POST /api/calculators/landscaping/mulch
 */
router.post('/landscaping/mulch', (req, res) => {
  try {
    const { areaSF, depthInches } = req.body;
    const result = TradeCalculators.calculateMulchCY(areaSF, depthInches);
    res.json({ success: true, result, unit: 'CY' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * Calculate sod pallets
 * POST /api/calculators/landscaping/sod
 */
router.post('/landscaping/sod', (req, res) => {
  try {
    const { areaSF, sfPerPallet } = req.body;
    const result = TradeCalculators.calculateSodPallets(areaSF, sfPerPallet);
    res.json({ success: true, result, unit: 'pallets' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ============================================
// DEMOLITION CALCULATION ENDPOINTS
// ============================================

/**
 * Calculate demo haul-off volume
 * POST /api/calculators/demolition/hauloff
 */
router.post('/demolition/hauloff', (req, res) => {
  try {
    const { areaSF, depthInches, expansionFactor } = req.body;
    const result = TradeCalculators.calculateDemoHaulOffCY(areaSF, depthInches, expansionFactor);
    res.json({ success: true, result, unit: 'CY' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * Calculate dumpster loads
 * POST /api/calculators/demolition/dumpsters
 */
router.post('/demolition/dumpsters', (req, res) => {
  try {
    const { totalCY, dumpsterSizeCY } = req.body;
    const result = TradeCalculators.calculateDumpsterLoads(totalCY, dumpsterSizeCY);
    res.json({ success: true, result, unit: 'loads' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ============================================
// GENERIC CALCULATION ENDPOINTS
// ============================================

/**
 * Calculate painting gallons
 * POST /api/calculators/painting
 */
router.post('/painting', (req, res) => {
  try {
    const { areaSF, coats, coverageSFPerGallon } = req.body;
    const result = TradeCalculators.calculatePaintGallons({ areaSF, coats, coverageSFPerGallon });
    res.json({ success: true, result, unit: 'gallons' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * Calculate drywall sheets
 * POST /api/calculators/drywall
 */
router.post('/drywall', (req, res) => {
  try {
    const { areaSF, sheetSizeSF } = req.body;
    const result = TradeCalculators.calculateDrywallSheets(areaSF, sheetSizeSF);
    res.json({ success: true, result, unit: 'sheets' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * Calculate flooring cartons
 * POST /api/calculators/flooring
 */
router.post('/flooring', (req, res) => {
  try {
    const { areaSF, sfPerCarton } = req.body;
    const result = TradeCalculators.calculateFlooringCartons(areaSF, sfPerCarton);
    res.json({ success: true, result, unit: 'cartons' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * Calculate insulation
 * POST /api/calculators/insulation
 */
router.post('/insulation', (req, res) => {
  try {
    const { areaSF, type, thicknessInches, sfPerBag } = req.body;
    let result: number;
    
    switch (type) {
      case 'batt':
        result = TradeCalculators.calculateBattInsulationSF(areaSF);
        break;
      case 'spray_foam':
        result = TradeCalculators.calculateSprayFoamBoardFeet(areaSF, thicknessInches || 2);
        break;
      case 'blown':
        result = TradeCalculators.calculateBlownInsulationBags(areaSF, sfPerBag || 30);
        break;
      default:
        result = TradeCalculators.calculateBattInsulationSF(areaSF);
    }
    
    res.json({ success: true, result, unit: type === 'blown' ? 'bags' : 'SF' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * Calculate low voltage cable
 * POST /api/calculators/lowvoltage
 */
router.post('/lowvoltage', (req, res) => {
  try {
    const { dropCount, avgDropLengthLF } = req.body;
    const result = TradeCalculators.calculateCableDropsLF(dropCount, avgDropLengthLF);
    res.json({ success: true, result, unit: 'LF' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ============================================
// DATABASE SEEDING ENDPOINT
// ============================================

/**
 * Seed master calculators table
 * POST /api/calculators/seed
 */
router.post('/seed', async (req, res) => {
  try {
    await seedMasterCalculators();
    res.json({ 
      success: true, 
      message: 'Master calculators seeded successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
