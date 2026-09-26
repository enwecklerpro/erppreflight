import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '../test/render';
import { Severity, ConfidenceClass, CleanCoreTier, SapObjectType } from '@erppreflight/schemas';
import { SeverityBadge } from '../components/findings/severity-badge';
import { ConfidenceBadge } from '../components/findings/confidence-badge';
import { CleanCoreBadge, CleanCoreTierBadge } from '../components/findings/clean-core-badge';
import { ObjectTypeBadge } from '../components/objects/object-type-badge';
import { ObjectTierBadge } from '../components/objects/object-tier-badge';

describe('Accessible Severity & Domain Badge Triad Verification', () => {
  describe('SeverityBadge Non-Color Triad (Axiom 1, Criterion 5)', () => {
    const severities: Array<{ severity: Severity; expectedText: string; expectedAria: string }> = [
      { severity: 'BLOCKER', expectedText: 'Blocker', expectedAria: 'Severity: Blocker' },
      { severity: 'CRITICAL', expectedText: 'Critical', expectedAria: 'Severity: Critical' },
      { severity: 'MAJOR', expectedText: 'Major', expectedAria: 'Severity: Major' },
      { severity: 'MEDIUM', expectedText: 'Medium', expectedAria: 'Severity: Medium' },
      { severity: 'MINOR', expectedText: 'Minor', expectedAria: 'Severity: Minor' },
      { severity: 'LOW', expectedText: 'Low', expectedAria: 'Severity: Low' },
      { severity: 'INFO', expectedText: 'Info', expectedAria: 'Severity: Info' },
    ];

    it.each(severities)(
      'renders $severity with non-color triad: text, icon, and accessible ARIA role',
      ({ severity, expectedText, expectedAria }) => {
        render(<SeverityBadge severity={severity} />);

        const badge = screen.getByRole('status', { name: expectedAria });
        expect(badge).toBeInTheDocument();
        expect(badge).toHaveTextContent(expectedText);

        // Icon must be present and marked aria-hidden="true"
        const icon = badge.querySelector('svg');
        expect(icon).toBeInTheDocument();
        expect(icon).toHaveAttribute('aria-hidden', 'true');

        // Color and border classes must be present
        expect(badge.className).toMatch(/border/);
        expect(badge.className).toMatch(/bg-/);
      }
    );

    it('respects showIcon=false by omitting icon while preserving textual and ARIA labels', () => {
      render(<SeverityBadge severity="CRITICAL" showIcon={false} />);

      const badge = screen.getByRole('status', { name: 'Severity: Critical' });
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent('Critical');
      expect(badge.querySelector('svg')).toBeNull();
    });

    it('applies smaller typography and padding classes when size="sm"', () => {
      render(<SeverityBadge severity="BLOCKER" size="sm" />);

      const badge = screen.getByRole('status', { name: 'Severity: Blocker' });
      expect(badge.className).toContain('text-[11px]');
      expect(badge.className).toContain('px-2');
    });

    it('gracefully falls back to INFO for unmapped severities', () => {
      // @ts-expect-error Testing runtime fallback
      render(<SeverityBadge severity="UNKNOWN_SEVERITY" />);

      const badge = screen.getByRole('status', { name: 'Severity: Info' });
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent('Info');
    });
  });

  describe('ConfidenceBadge Epistemic Classification Triad', () => {
    const confidenceCases: Array<{
      confidence: ConfidenceClass;
      expectedText: string;
      expectedDefaultScore: string;
    }> = [
      { confidence: 'VERIFIED', expectedText: 'Verified', expectedDefaultScore: '1.0' },
      { confidence: 'RULE_DERIVED', expectedText: 'Rule Derived', expectedDefaultScore: '0.85' },
      { confidence: 'INFERRED', expectedText: 'Inferred', expectedDefaultScore: '0.60' },
      { confidence: 'UNKNOWN', expectedText: 'Unknown', expectedDefaultScore: '0.30' },
    ];

    it.each(confidenceCases)(
      'renders $confidence with explicit classification, score, and non-color triad',
      ({ confidence, expectedText, expectedDefaultScore }) => {
        render(<ConfidenceBadge confidence={confidence} />);

        const badge = screen.getByRole('status');
        expect(badge).toHaveTextContent(expectedText);
        expect(badge).toHaveTextContent(`(${expectedDefaultScore})`);
        expect(badge).toHaveAttribute(
          'aria-label',
          `Confidence: ${expectedText}, Trust Score: ${expectedDefaultScore}`
        );

        const icon = badge.querySelector('svg');
        expect(icon).toBeInTheDocument();
        expect(icon).toHaveAttribute('aria-hidden', 'true');
      }
    );

    it('formats custom numerical scores to 2 decimal places in label and text', () => {
      render(<ConfidenceBadge confidence="INFERRED" score={0.589} />);

      const badge = screen.getByRole('status', {
        name: 'Confidence: Inferred, Trust Score: 0.59',
      });
      expect(badge).toHaveTextContent('(0.59)');
    });
  });

  describe('CleanCoreBadge Extensibility Hierarchy Triad', () => {
    const tiers: Array<{ tier: CleanCoreTier; expectedLabel: string; expectedDesc: string }> = [
      {
        tier: 'TIER_1_CLOUD',
        expectedLabel: 'Tier 1 Cloud',
        expectedDesc: 'Cloud Compliant (Public API / RAP)',
      },
      {
        tier: 'TIER_2_DEVELOPER',
        expectedLabel: 'Tier 2 Developer',
        expectedDesc: 'Developer Extensibility (Custom Code in Core)',
      },
      {
        tier: 'TIER_3_CLASSIC',
        expectedLabel: 'Tier 3 Classic',
        expectedDesc: 'Classic Modification (Direct DB / SSCR Key)',
      },
    ];

    it.each(tiers)(
      'renders $tier with accessible role, text badge, description, and SVG icon',
      ({ tier, expectedLabel, expectedDesc }) => {
        render(<CleanCoreBadge tier={tier} />);

        const badge = screen.getByRole('status', {
          name: `Clean Core: ${expectedLabel} - ${expectedDesc}`,
        });
        expect(badge).toBeInTheDocument();
        expect(badge).toHaveTextContent(expectedLabel);

        const icon = badge.querySelector('svg');
        expect(icon).toBeInTheDocument();
        expect(icon).toHaveAttribute('aria-hidden', 'true');
      }
    );

    it('handles undefined tier by rendering a clean em dash fallback', () => {
      render(<CleanCoreBadge tier={undefined} />);

      expect(screen.getByText('—')).toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('exports CleanCoreTierBadge alias matching CleanCoreBadge behavior', () => {
      render(<CleanCoreTierBadge tier="TIER_1_CLOUD" />);

      const badge = screen.getByRole('status');
      expect(badge).toHaveTextContent('Tier 1 Cloud');
    });
  });

  describe('ObjectTypeBadge SAP Metadata Triad', () => {
    const sapTypes: SapObjectType[] = [
      'PROG',
      'CLAS',
      'INTF',
      'FUGR',
      'TABL',
      'CDS',
      'VIEW',
      'DTEL',
      'DOMA',
      'TRAN',
      'AUTH',
      'DEVC',
      'FORM',
      'BADI',
      'ENHO',
      'WSDL',
    ];

    it.each(sapTypes)('renders SAP object type %s with icon, text, and ARIA label', (type) => {
      render(<ObjectTypeBadge type={type} />);

      const badge = screen.getByRole('status', { name: `SAP Object Type: ${type}` });
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent(type);

      const icon = badge.querySelector('svg');
      expect(icon).toBeInTheDocument();
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    });

    it('renders unlisted custom object types with fallback icon and label', () => {
      // @ts-expect-error Testing unexpected custom SAP object type
      render(<ObjectTypeBadge type="ZZ_CUSTOM_REPORT" />);

      const badge = screen.getByRole('status', { name: 'SAP Object Type: ZZ_CUSTOM_REPORT' });
      expect(badge).toHaveTextContent('ZZ_CUSTOM_REPORT');
      expect(badge.querySelector('svg')).toBeInTheDocument();
    });
  });

  describe('ObjectTierBadge Clean Core Architectural Risk Triad', () => {
    const tierRisks: Array<{
      tier: CleanCoreTier;
      expectedLabel: string;
      expectedDesc: string;
    }> = [
      {
        tier: 'TIER_1_CLOUD',
        expectedLabel: 'Tier 1: Cloud',
        expectedDesc: 'Cloud Compliant (Public API / RAP)',
      },
      {
        tier: 'TIER_2_DEVELOPER',
        expectedLabel: 'Tier 2: Developer',
        expectedDesc: 'Developer Extensibility (Transitional Custom Code)',
      },
      {
        tier: 'TIER_3_CLASSIC',
        expectedLabel: 'Tier 3: Classic',
        expectedDesc: 'Classic Modification (Prohibited Migration Hazard)',
      },
    ];

    it.each(tierRisks)(
      'renders $tier with explicit text, risk description, and Lucide icon',
      ({ tier, expectedLabel, expectedDesc }) => {
        render(<ObjectTierBadge tier={tier} />);

        const badge = screen.getByRole('status', {
          name: `Clean Core: ${expectedLabel} - ${expectedDesc}`,
        });
        expect(badge).toBeInTheDocument();
        expect(badge).toHaveTextContent(expectedLabel);

        const icon = badge.querySelector('svg');
        expect(icon).toBeInTheDocument();
        expect(icon).toHaveAttribute('aria-hidden', 'true');
      }
    );
  });
});
