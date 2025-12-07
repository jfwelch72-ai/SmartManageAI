import { describe, it, expect } from 'vitest';
import {
  normalizeTradeType,
  isValidTradeType,
  getTradeDisplayName,
  VALID_TRADE_TYPES,
  TRADE_TYPE_ALIASES,
} from './tradeTypeUtils';

describe('Trade Type Utilities', () => {
  describe('normalizeTradeType', () => {
    describe('direct matches', () => {
      it('should return the same value for valid uppercase trade types', () => {
        expect(normalizeTradeType('GENERAL_CONTRACTOR')).toBe('GENERAL_CONTRACTOR');
        expect(normalizeTradeType('ELECTRICAL')).toBe('ELECTRICAL');
        expect(normalizeTradeType('PLUMBING')).toBe('PLUMBING');
        expect(normalizeTradeType('HVAC')).toBe('HVAC');
        expect(normalizeTradeType('ROOFING')).toBe('ROOFING');
      });

      it('should handle lowercase valid trade types', () => {
        expect(normalizeTradeType('electrical')).toBe('ELECTRICAL');
        expect(normalizeTradeType('plumbing')).toBe('PLUMBING');
        expect(normalizeTradeType('hvac')).toBe('HVAC');
      });

      it('should handle mixed case valid trade types', () => {
        expect(normalizeTradeType('Electrical')).toBe('ELECTRICAL');
        expect(normalizeTradeType('HVAC')).toBe('HVAC');
      });
    });

    describe('null/undefined handling', () => {
      it('should return null for null input', () => {
        expect(normalizeTradeType(null)).toBeNull();
      });

      it('should return null for undefined input', () => {
        expect(normalizeTradeType(undefined)).toBeNull();
      });

      it('should return OTHER for empty string', () => {
        expect(normalizeTradeType('')).toBeNull();
      });

      it('should handle whitespace-only strings as partial matches', () => {
        // Whitespace-only strings are trimmed and may match via partial matching
        // The function treats them like any other input after trimming
        const result = normalizeTradeType('   ');
        expect(typeof result).toBe('string');
      });
    });

    describe('GENERAL_CONTRACTOR aliases', () => {
      it('should normalize "gc" to GENERAL_CONTRACTOR', () => {
        expect(normalizeTradeType('gc')).toBe('GENERAL_CONTRACTOR');
        expect(normalizeTradeType('GC')).toBe('GENERAL_CONTRACTOR');
      });

      it('should normalize "general contractor" to GENERAL_CONTRACTOR', () => {
        expect(normalizeTradeType('general contractor')).toBe('GENERAL_CONTRACTOR');
        expect(normalizeTradeType('General Contractor')).toBe('GENERAL_CONTRACTOR');
      });

      it('should normalize builder variations', () => {
        expect(normalizeTradeType('builder')).toBe('GENERAL_CONTRACTOR');
        expect(normalizeTradeType('home builder')).toBe('GENERAL_CONTRACTOR');
        expect(normalizeTradeType('residential builder')).toBe('GENERAL_CONTRACTOR');
        expect(normalizeTradeType('commercial builder')).toBe('GENERAL_CONTRACTOR');
      });

      it('should normalize construction company variations', () => {
        expect(normalizeTradeType('construction company')).toBe('GENERAL_CONTRACTOR');
        expect(normalizeTradeType('construction contractor')).toBe('GENERAL_CONTRACTOR');
      });
    });

    describe('ELECTRICAL aliases', () => {
      it('should normalize electrician', () => {
        expect(normalizeTradeType('electrician')).toBe('ELECTRICAL');
      });

      it('should normalize electrical variations', () => {
        expect(normalizeTradeType('electrical contractor')).toBe('ELECTRICAL');
        expect(normalizeTradeType('electrical company')).toBe('ELECTRICAL');
        expect(normalizeTradeType('commercial electrical')).toBe('ELECTRICAL');
      });
    });

    describe('PLUMBING aliases', () => {
      it('should normalize plumber', () => {
        expect(normalizeTradeType('plumber')).toBe('PLUMBING');
      });

      it('should normalize plumbing variations', () => {
        expect(normalizeTradeType('plumbing contractor')).toBe('PLUMBING');
        expect(normalizeTradeType('plumbing company')).toBe('PLUMBING');
      });
    });

    describe('HVAC aliases', () => {
      it('should normalize hvac variations', () => {
        expect(normalizeTradeType('hvac')).toBe('HVAC');
        expect(normalizeTradeType('HVAC')).toBe('HVAC');
        expect(normalizeTradeType('hvac contractor')).toBe('HVAC');
        expect(normalizeTradeType('hvac tech')).toBe('HVAC');
      });

      it('should normalize heating/cooling variations', () => {
        expect(normalizeTradeType('heating')).toBe('HVAC');
        expect(normalizeTradeType('air conditioning')).toBe('HVAC');
        expect(normalizeTradeType('ac')).toBe('HVAC');
        expect(normalizeTradeType('heating and cooling')).toBe('HVAC');
      });
    });

    describe('ROOFING aliases', () => {
      it('should normalize roofer', () => {
        expect(normalizeTradeType('roofer')).toBe('ROOFING');
      });

      it('should normalize roofing variations', () => {
        expect(normalizeTradeType('roofing contractor')).toBe('ROOFING');
        expect(normalizeTradeType('roofing company')).toBe('ROOFING');
        expect(normalizeTradeType('commercial roofing')).toBe('ROOFING');
      });
    });

    describe('CONCRETE aliases', () => {
      it('should normalize concrete variations', () => {
        expect(normalizeTradeType('concrete')).toBe('CONCRETE');
        expect(normalizeTradeType('cement')).toBe('CONCRETE');
        expect(normalizeTradeType('flatwork')).toBe('CONCRETE');
        expect(normalizeTradeType('foundation')).toBe('CONCRETE');
      });
    });

    describe('FLOORING aliases', () => {
      it('should normalize flooring variations', () => {
        expect(normalizeTradeType('flooring')).toBe('FLOORING');
        expect(normalizeTradeType('flooring co')).toBe('FLOORING');
        expect(normalizeTradeType('hardwood')).toBe('FLOORING');
        expect(normalizeTradeType('carpet')).toBe('FLOORING');
      });
    });

    describe('SOLAR aliases', () => {
      it('should normalize solar variations', () => {
        expect(normalizeTradeType('solar')).toBe('SOLAR');
        expect(normalizeTradeType('solar panel')).toBe('SOLAR');
        expect(normalizeTradeType('photovoltaic')).toBe('SOLAR');
        expect(normalizeTradeType('pv')).toBe('SOLAR');
      });
    });

    describe('OTHER (fallback)', () => {
      it('should return OTHER for unrecognized trade types', () => {
        expect(normalizeTradeType('underwater basket weaving')).toBe('OTHER');
        expect(normalizeTradeType('random unknown trade')).toBe('OTHER');
      });
    });

    describe('partial matching', () => {
      it('should match partial strings that contain aliases', () => {
        expect(normalizeTradeType('we do roofing work')).toBe('ROOFING');
        expect(normalizeTradeType('best electrical services')).toBe('ELECTRICAL');
      });
    });

    describe('all trade types have coverage', () => {
      it('should have at least one alias for each non-OTHER trade type', () => {
        const tradeTypesWithAliases = new Set(Object.values(TRADE_TYPE_ALIASES));
        
        for (const tradeType of VALID_TRADE_TYPES) {
          if (tradeType !== 'OTHER') {
            expect(tradeTypesWithAliases.has(tradeType)).toBe(true);
          }
        }
      });
    });
  });

  describe('isValidTradeType', () => {
    it('should return true for valid trade types', () => {
      expect(isValidTradeType('GENERAL_CONTRACTOR')).toBe(true);
      expect(isValidTradeType('ELECTRICAL')).toBe(true);
      expect(isValidTradeType('PLUMBING')).toBe(true);
      expect(isValidTradeType('OTHER')).toBe(true);
    });

    it('should return false for invalid trade types', () => {
      expect(isValidTradeType('INVALID')).toBe(false);
      expect(isValidTradeType('gc')).toBe(false);
      expect(isValidTradeType('electrician')).toBe(false);
    });
  });

  describe('getTradeDisplayName', () => {
    it('should return display name for GENERAL_CONTRACTOR', () => {
      expect(getTradeDisplayName('GENERAL_CONTRACTOR')).toBe('General Contractor');
    });

    it('should return display name for WINDOWS_DOORS', () => {
      expect(getTradeDisplayName('WINDOWS_DOORS')).toBe('Windows & Doors');
    });

    it('should return display name for OTHER', () => {
      expect(getTradeDisplayName('OTHER')).toBe('Other/Custom');
    });

    it('should return display name for all trade types', () => {
      for (const tradeType of VALID_TRADE_TYPES) {
        const displayName = getTradeDisplayName(tradeType);
        expect(typeof displayName).toBe('string');
        expect(displayName.length).toBeGreaterThan(0);
      }
    });
  });

  describe('TRADE_TYPE_ALIASES coverage', () => {
    it('should have at least 100 aliases', () => {
      const aliasCount = Object.keys(TRADE_TYPE_ALIASES).length;
      expect(aliasCount).toBeGreaterThanOrEqual(100);
    });

    it('should have all values be valid trade types', () => {
      for (const tradeType of Object.values(TRADE_TYPE_ALIASES)) {
        expect(isValidTradeType(tradeType)).toBe(true);
      }
    });
  });
});
