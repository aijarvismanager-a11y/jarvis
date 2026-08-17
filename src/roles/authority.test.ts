import { describe, expect, test } from 'bun:test';
import {
  IMPACT_MAP,
  impactFromCategory,
  gateVoiceApprovalResolution,
  VOICE_APPROVAL_CONFIDENCE_FLOOR,
  toSpecLevel,
  specLevelLabel,
  SPEC_LEVEL_LABELS,
  AUTHORITY_REQUIREMENTS,
  type ActionCategory,
} from './authority.ts';
import {
  toSpecLevel as uiToSpecLevel,
  SPEC_LEVEL_LABELS as uiSpecLevelLabels,
} from '../../ui/src/v2/rooms/agents/specLevel.ts';

describe('IMPACT_MAP / impactFromCategory', () => {
  test('every ActionCategory has an impact assigned (no missing entries)', () => {
    const allCategories: ActionCategory[] = [
      'read_data', 'write_data', 'delete_data',
      'send_message', 'send_email',
      'execute_command', 'install_software',
      'make_payment', 'modify_settings',
      'spawn_agent', 'terminate_agent',
      'access_browser', 'control_app',
    ];
    for (const cat of allCategories) {
      const impact = impactFromCategory(cat);
      expect(['read', 'write', 'external', 'destructive']).toContain(impact);
    }
  });

  test('the destructive set matches what gateVoiceApprovalResolution refuses', () => {
    // Pinning the contract: if a category is mapped 'destructive' here, it
    // must be refused by the voice gate (no quiet drift).
    const destructive: ActionCategory[] = [
      'execute_command', 'install_software', 'make_payment',
      'modify_settings', 'delete_data', 'terminate_agent',
    ];
    for (const cat of destructive) {
      expect(IMPACT_MAP[cat]).toBe('destructive');
      const gate = gateVoiceApprovalResolution(cat, 1.0);
      expect(gate.kind).toBe('clarify');
      if (gate.kind === 'clarify') {
        expect(gate.reason).toBe('destructive_impact');
      }
    }
  });
});

describe('gateVoiceApprovalResolution — security gate for voice approvals', () => {
  // The reviewer's failure mode this gate prevents: STT mishears, podcasts,
  // or someone else in the room saying "yes" resolves the approval queue.
  // For destructive impacts (payment, deletion, termination), a single
  // misheard syllable triggering action is unacceptable.

  test('destructive impact is refused regardless of confidence (even 1.0)', () => {
    const cases: ActionCategory[] = ['make_payment', 'delete_data', 'terminate_agent', 'execute_command'];
    for (const cat of cases) {
      // Even with perfect confidence, voice cannot resolve destructive actions.
      const gate = gateVoiceApprovalResolution(cat, 1.0);
      expect(gate.kind).toBe('clarify');
      if (gate.kind === 'clarify') {
        expect(gate.reason).toBe('destructive_impact');
        expect(gate.message.toLowerCase()).toContain('dashboard');
      }
    }
  });

  test('non-destructive with confidence ≥ 0.85 resolves', () => {
    expect(gateVoiceApprovalResolution('read_data', 0.85).kind).toBe('resolve');
    expect(gateVoiceApprovalResolution('write_data', 0.9).kind).toBe('resolve');
    expect(gateVoiceApprovalResolution('send_message', 1.0).kind).toBe('resolve');
    expect(gateVoiceApprovalResolution('access_browser', 0.95).kind).toBe('resolve');
    expect(gateVoiceApprovalResolution('send_email', 0.86).kind).toBe('resolve');
  });

  test('non-destructive below 0.85 is gated as low_confidence', () => {
    const cases: Array<[ActionCategory, number]> = [
      ['read_data', 0.84],
      ['write_data', 0.6],
      ['send_message', 0.0],
      ['access_browser', 0.7],
    ];
    for (const [cat, conf] of cases) {
      const gate = gateVoiceApprovalResolution(cat, conf);
      expect(gate.kind).toBe('clarify');
      if (gate.kind === 'clarify') {
        expect(gate.reason).toBe('low_confidence');
        expect(gate.message.toLowerCase()).toContain('repeat');
      }
    }
  });

  test('the floor sits exactly at VOICE_APPROVAL_CONFIDENCE_FLOOR (boundary check)', () => {
    // Just below the floor: gated.
    expect(gateVoiceApprovalResolution('read_data', VOICE_APPROVAL_CONFIDENCE_FLOOR - 0.0001).kind).toBe('clarify');
    // At and above the floor: resolved.
    expect(gateVoiceApprovalResolution('read_data', VOICE_APPROVAL_CONFIDENCE_FLOOR).kind).toBe('resolve');
    expect(gateVoiceApprovalResolution('read_data', VOICE_APPROVAL_CONFIDENCE_FLOOR + 0.0001).kind).toBe('resolve');
  });

  test('destructive supersedes the confidence floor — no escape hatch', () => {
    // High confidence does NOT unlock destructive resolution. This is the
    // critical security property: confidence is necessary but not sufficient.
    expect(gateVoiceApprovalResolution('make_payment', 0.99).kind).toBe('clarify');
    expect(gateVoiceApprovalResolution('make_payment', 1.0).kind).toBe('clarify');
  });

  test('low confidence on a destructive action returns destructive_impact (impact takes priority over confidence)', () => {
    // The order matters for the audit reason: a payment with low confidence
    // should be tagged as gated for impact, not for confidence.
    const gate = gateVoiceApprovalResolution('make_payment', 0.1);
    expect(gate.kind).toBe('clarify');
    if (gate.kind === 'clarify') {
      expect(gate.reason).toBe('destructive_impact');
    }
  });

  test('clarify outcomes always carry a non-empty message for the user', () => {
    const cases: Array<[ActionCategory, number]> = [
      ['make_payment', 1.0],
      ['read_data', 0.5],
      ['delete_data', 0.7],
    ];
    for (const [cat, conf] of cases) {
      const gate = gateVoiceApprovalResolution(cat, conf);
      if (gate.kind === 'clarify') {
        expect(gate.message.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('toSpecLevel — display-only 1-10 → 0-5 compression (spec §30)', () => {
  test('boundaries match describeAuthorityLevel()\'s existing bands exactly', () => {
    expect(toSpecLevel(0)).toBe(0);
    expect(toSpecLevel(-1)).toBe(0);
    expect(toSpecLevel(1)).toBe(1);
    expect(toSpecLevel(2)).toBe(1);
    expect(toSpecLevel(3)).toBe(2);
    expect(toSpecLevel(4)).toBe(2);
    expect(toSpecLevel(5)).toBe(3);
    expect(toSpecLevel(6)).toBe(3);
    expect(toSpecLevel(7)).toBe(4);
    expect(toSpecLevel(8)).toBe(4);
    expect(toSpecLevel(9)).toBe(5);
    expect(toSpecLevel(10)).toBe(5);
  });

  test('every SpecLevel band (1-5) has a non-empty label', () => {
    for (const level of [0, 1, 2, 3, 4, 5] as const) {
      expect(SPEC_LEVEL_LABELS[level].length).toBeGreaterThan(0);
    }
  });

  test('specLevelLabel is consistent with toSpecLevel for every AUTHORITY_REQUIREMENTS floor', () => {
    // Regression guard: every actual gating floor in use today must map to
    // a real, defined label — no silent gaps in the compression.
    for (const requiredLevel of Object.values(AUTHORITY_REQUIREMENTS)) {
      const label = specLevelLabel(requiredLevel);
      expect(label).toBe(SPEC_LEVEL_LABELS[toSpecLevel(requiredLevel)]);
      expect(label.length).toBeGreaterThan(0);
    }
  });

  test('the destructive-action floor (level 9) compresses to the top spec band (5)', () => {
    // Pinning the security-relevant boundary the audit worried about: a
    // mistake here could under-gate destructive actions. make_payment,
    // modify_settings, delete_data, terminate_agent all require level 9 —
    // confirm none of them silently drop to a lower spec band.
    for (const cat of ['make_payment', 'modify_settings', 'delete_data', 'terminate_agent'] as ActionCategory[]) {
      expect(toSpecLevel(AUTHORITY_REQUIREMENTS[cat])).toBe(5);
    }
  });

  test('stays in sync with ui/src/v2/rooms/agents/specLevel.ts (deliberate duplicate — see that file\'s doc comment)', () => {
    for (let level = -1; level <= 11; level++) {
      expect(uiToSpecLevel(level)).toBe(toSpecLevel(level));
    }
    expect(uiSpecLevelLabels).toEqual(SPEC_LEVEL_LABELS);
  });
});
