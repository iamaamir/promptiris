import type {
  CapabilityEvidence,
  CapabilityRequirement,
  CapabilityResolution,
  Diagnostic,
  NamespacedId,
} from '@promptiris/protocol';

export interface CapabilityRequirementInput {
  readonly capability: NamespacedId;
  readonly bindingFingerprint: string;
  readonly requirement: CapabilityRequirement;
}

const strength = { observation: 1, profile: 2, configuration: 3, policy: 4 } as const;

function matching(
  requirement: CapabilityRequirementInput,
  evidence: readonly CapabilityEvidence[],
) {
  return evidence
    .filter(
      (item) =>
        item.capability === requirement.capability &&
        item.bindingFingerprint === requirement.bindingFingerprint,
    )
    .slice()
    .sort(
      (a, b) =>
        strength[b.source.kind] - strength[a.source.kind] ||
        a.evidenceId.localeCompare(b.evidenceId),
    );
}

function clone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map(clone)) as T;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) result[key] = clone(item);
  return Object.freeze(result) as T;
}

function diagnostic(code: string, detail: string): Diagnostic {
  return {
    schemaVersion: '1',
    id: `${code}:${detail}`,
    code,
    category: 'capability',
    severity: 'error',
    title: code,
    detail,
  };
}

export function evaluateCapabilities(
  requirements: readonly CapabilityRequirementInput[],
  evidence: readonly CapabilityEvidence[],
): readonly CapabilityResolution[] {
  return Object.freeze(requirements.map((requirement) => resolveOne(requirement, evidence)));
}

function resolveOne(
  requirement: CapabilityRequirementInput,
  evidence: readonly CapabilityEvidence[],
): CapabilityResolution {
  const relevant = matching(requirement, evidence);
  const decisive = relevant.filter((item) => item.state !== 'unknown');
  const strongest = decisive[0] && strength[decisive[0].source.kind];
  const claims =
    strongest === undefined
      ? []
      : decisive.filter((item) => strength[item.source.kind] === strongest);
  const decision = decide(requirement, claims);
  return clone({
    ...requirement,
    outcome: decision.outcome,
    evidence: relevant,
    ...decision.details,
  });
}

function decide(requirement: CapabilityRequirementInput, claims: readonly CapabilityEvidence[]) {
  const unsupported = claims.filter((item) => item.state === 'unsupported');
  const supported = claims.filter((item) => item.state === 'supported');
  const digests = new Set(supported.map((item) => item.digest).filter(Boolean));
  const conflict = conflictingClaims(unsupported, supported, digests);
  let outcome: CapabilityResolution['outcome'];
  let reason: string | undefined;
  let failure: Diagnostic | undefined;
  if (conflict) {
    outcome = 'conflict';
    reason = 'same-strength capability evidence conflicts';
    failure = diagnostic(
      'promptiris.capability.evidence-conflict',
      `${requirement.bindingFingerprint}:${requirement.capability}`,
    );
  } else if (unsupported.length > 0 || supported.length === 0) {
    outcome = requirement.requirement === 'preferred' ? 'fallback' : 'missing';
    reason =
      unsupported.length > 0
        ? 'capability is explicitly unsupported'
        : 'capability support is not proven';
    if (requirement.requirement === 'required')
      failure = diagnostic(
        'promptiris.capability.missing',
        `${requirement.bindingFingerprint}:${requirement.capability}`,
      );
  } else {
    outcome = 'satisfied';
  }
  return {
    outcome,
    details: {
      ...(reason === undefined ? {} : { reason }),
      ...(failure === undefined ? {} : { diagnostic: failure }),
    },
  };
}

function conflictingClaims(
  unsupported: readonly CapabilityEvidence[],
  supported: readonly CapabilityEvidence[],
  digests: ReadonlySet<string | undefined>,
) {
  return (unsupported.length > 0 && supported.length > 0) || digests.size > 1;
}
