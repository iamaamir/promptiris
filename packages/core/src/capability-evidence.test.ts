import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { CapabilityEvidence } from '@promptiris/protocol';
import { evaluateCapabilities, type CapabilityRequirementInput } from './capability-evidence.js';

const req = (
  requirement: CapabilityRequirementInput['requirement'] = 'required',
): CapabilityRequirementInput => ({
  capability: 'output/json-object',
  bindingFingerprint: 'bind-a',
  requirement,
});
const ev = (
  evidenceId: string,
  state: CapabilityEvidence['state'],
  source: CapabilityEvidence['source']['kind'],
  digest?: string,
  bindingFingerprint = 'bind-a',
): CapabilityEvidence => ({
  evidenceId,
  capability: 'output/json-object',
  bindingFingerprint,
  state,
  source: { kind: source, id: source },
  ...(digest ? { digest } : {}),
});

describe('evaluateCapabilities', () => {
  it('applies precedence, isolation, stable ordering, and freezes copies', () => {
    const input = [
      ev('z', 'supported', 'observation'),
      ev('a', 'unsupported', 'policy'),
      ev('foreign', 'unsupported', 'policy', undefined, 'other'),
    ];
    const result = evaluateCapabilities([req()], input);
    expect(result[0]).toMatchObject({
      outcome: 'missing',
      diagnostic: { code: 'promptiris.capability.missing' },
    });
    expect(result[0]?.evidence.map((item) => item.evidenceId)).toEqual(['a', 'z']);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0])).toBe(true);
    expect(input[0]?.state).toBe('supported');
  });

  it('detects same-strength positive digest conflicts and handles requirement modes', () => {
    const evidence = [
      ev('b', 'supported', 'profile', 'sha256:b'),
      ev('a', 'supported', 'profile', 'sha256:a'),
    ];
    expect(evaluateCapabilities([req()], evidence)[0]?.outcome).toBe('conflict');
    expect(
      evaluateCapabilities([req('preferred')], [ev('x', 'unknown', 'observation')])[0]?.outcome,
    ).toBe('fallback');
    expect(evaluateCapabilities([req('optional')], [])[0]?.outcome).toBe('missing');
  });

  it('lets lower explicit support survive higher unknown and retains the audit trail', () => {
    const result = evaluateCapabilities(
      [req()],
      [ev('high', 'unknown', 'policy'), ev('low', 'supported', 'observation')],
    )[0];
    expect(result?.outcome).toBe('satisfied');
    expect(result?.evidence.map((item) => item.evidenceId)).toEqual(['high', 'low']);
  });

  it('returns the exact required-missing diagnostic contract', () => {
    expect(evaluateCapabilities([req()], [])).toEqual([
      {
        capability: 'output/json-object',
        bindingFingerprint: 'bind-a',
        requirement: 'required',
        outcome: 'missing',
        evidence: [],
        reason: 'capability support is not proven',
        diagnostic: {
          schemaVersion: '1',
          id: 'promptiris.capability.missing:bind-a:output/json-object',
          code: 'promptiris.capability.missing',
          category: 'capability',
          severity: 'error',
          title: 'promptiris.capability.missing',
          detail: 'bind-a:output/json-object',
        },
      },
    ]);
  });

  it('distinguishes unsupported, unknown, and positive evidence exactly', () => {
    const requirements = [req('preferred'), req('optional'), req('required')];
    const unsupported = evaluateCapabilities(requirements, [
      ev('configured-no', 'unsupported', 'configuration'),
    ]);
    expect(
      unsupported.map(({ outcome, reason, diagnostic }) => ({
        outcome,
        reason,
        diagnostic: diagnostic?.code,
      })),
    ).toEqual([
      {
        outcome: 'fallback',
        reason: 'capability is explicitly unsupported',
        diagnostic: undefined,
      },
      {
        outcome: 'missing',
        reason: 'capability is explicitly unsupported',
        diagnostic: undefined,
      },
      {
        outcome: 'missing',
        reason: 'capability is explicitly unsupported',
        diagnostic: 'promptiris.capability.missing',
      },
    ]);
    expect(
      evaluateCapabilities([req()], [ev('yes', 'supported', 'profile')])[0],
    ).not.toHaveProperty('reason');
  });

  it('returns the exact conflict diagnostic and ignores unrelated capabilities', () => {
    const unrelated: CapabilityEvidence = {
      ...ev('other', 'unsupported', 'policy'),
      capability: 'provider/other',
    };
    const result = evaluateCapabilities(
      [req()],
      [unrelated, ev('yes', 'supported', 'policy'), ev('no', 'unsupported', 'policy')],
    )[0];
    expect(result).toMatchObject({
      outcome: 'conflict',
      reason: 'same-strength capability evidence conflicts',
      evidence: [{ evidenceId: 'no' }, { evidenceId: 'yes' }],
      diagnostic: {
        id: 'promptiris.capability.evidence-conflict:bind-a:output/json-object',
        code: 'promptiris.capability.evidence-conflict',
        title: 'promptiris.capability.evidence-conflict',
        detail: 'bind-a:output/json-object',
      },
    });
  });

  it('is invariant under fixed-seed evidence permutations', () => {
    const items = [
      ev('a', 'supported', 'observation'),
      ev('b', 'unknown', 'profile'),
      ev('c', 'supported', 'configuration'),
    ];
    const baseline = evaluateCapabilities([req()], items);
    fc.assert(
      fc.property(fc.shuffledSubarray([0, 1, 2], { minLength: 3, maxLength: 3 }), (order) => {
        const permutation = order
          .map((index) => items[index])
          .filter((item): item is CapabilityEvidence => item !== undefined);
        expect(evaluateCapabilities([req()], permutation)).toEqual(baseline);
      }),
      { seed: 1701, numRuns: 25 },
    );
  });
});
