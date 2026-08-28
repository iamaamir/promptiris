import { createHash } from 'node:crypto';
import {
  validatePatch,
  validatePromptDocument,
  type JsonValue,
  type Patch,
  type PatchOperation,
  type PromptDocument,
  type Protection,
  type TextBlock,
  type TextSelector,
} from '@promptiris/protocol';

/** @public */
export interface TransformationState {
  readonly document: Readonly<PromptDocument>;
  readonly revision: number;
}

/** @public */
export interface PatchChange {
  readonly operationIndex: number;
  readonly type: PatchOperation['type'];
  readonly blockId?: string;
  readonly before?: JsonValue;
  readonly after?: JsonValue;
}

/** @public */
export interface AppliedPatch {
  readonly patchId: string;
  readonly baseRevision: number;
  readonly revision: number;
  readonly changes: readonly PatchChange[];
}

/** @public */
export type PatchFailureCode =
  | 'invalid-patch'
  | 'stale-revision'
  | 'stale-selector'
  | 'unknown-block'
  | 'invalid-selector'
  | 'quote-mismatch'
  | 'protected-span'
  | 'precondition-failed'
  | 'duplicate-block'
  | 'invalid-namespace'
  | 'conflicting-operations'
  | 'invalid-document';

/** @public */
export type PatchResult =
  | { readonly ok: true; readonly state: TransformationState; readonly applied: AppliedPatch }
  | { readonly ok: false; readonly code: PatchFailureCode; readonly detail: string };

interface BaseTextEdit {
  readonly selector: TextSelector;
  readonly replacement: string;
}

interface Candidate {
  document: PromptDocument;
  readonly changes: PatchChange[];
  readonly textEdits: Map<string, BaseTextEdit[]>;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function cloneDocument(document: PromptDocument): PromptDocument {
  return structuredClone(document);
}

function scalars(text: string): string[] {
  return Array.from(text);
}

function graphemeBoundaries(text: string): Set<number> {
  const boundaries = new Set<number>([0, scalars(text).length]);
  // Stryker disable next-line ObjectLiteral: grapheme is Intl.Segmenter's default granularity;
  // the explicit option documents the protocol coordinate contract.
  const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text);
  for (const segment of segments) boundaries.add(scalars(text.slice(0, segment.index)).length);
  return boundaries;
}

function failure(code: PatchFailureCode, detail: string): PatchResult {
  return { ok: false, code, detail };
}

function findBlock(document: PromptDocument, blockId: string): TextBlock | undefined {
  return document.content.find((block) => block.id === blockId);
}

function rangesOverlap(left: TextSelector, right: TextSelector): boolean {
  return (
    left.blockId === right.blockId &&
    left.range.start < right.range.end &&
    right.range.start < left.range.end
  );
}

function quoteContextMatches(text: string, selector: TextSelector): boolean {
  const units = scalars(text);
  const { start, end } = selector.range;
  const prefix = selector.quote.prefix;
  const suffix = selector.quote.suffix;
  const prefixMatches = prefix === undefined || units.slice(0, start).join('').endsWith(prefix);
  const suffixMatches = suffix === undefined || units.slice(end).join('').startsWith(suffix);
  return prefixMatches && suffixMatches;
}

function selectorRangeIsValid(selector: TextSelector, length: number): boolean {
  const { start, end, unit } = selector.range;
  return (
    unit === 'unicode-scalar' &&
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    end >= start &&
    end <= length
  );
}

function validateSelector(
  selector: TextSelector,
  text: string,
  revision: number,
): PatchFailureCode | undefined {
  if (selector.revision !== revision) return 'stale-selector';
  const units = scalars(text);
  const { start, end } = selector.range;
  if (!selectorRangeIsValid(selector, units.length)) return 'invalid-selector';
  const boundaries = graphemeBoundaries(text);
  if (!boundaries.has(start) || !boundaries.has(end)) return 'invalid-selector';
  if (units.slice(start, end).join('') !== selector.quote.exact) return 'quote-mismatch';
  return quoteContextMatches(text, selector) ? undefined : 'quote-mismatch';
}

function validateDocumentState(
  document: PromptDocument,
  revision: number,
): PatchFailureCode | undefined {
  if (!validatePromptDocument(document)) return 'invalid-document';
  if (new Set(document.content.map((block) => block.id)).size !== document.content.length) {
    return 'duplicate-block';
  }
  for (const protection of document.protections ?? []) {
    const block = findBlock(document, protection.selector.blockId);
    if (block === undefined) return 'unknown-block';
    const selectorFailure = validateSelector(protection.selector, block.text, revision);
    if (selectorFailure !== undefined) return selectorFailure;
  }
  return undefined;
}

/** @public */
export function createTransformationState(
  document: PromptDocument,
  revision = 0,
): TransformationState {
  const copy = cloneDocument(document);
  const invalid = validateDocumentState(copy, revision);
  if (invalid !== undefined) throw new TypeError(`Invalid Prompt Document state: ${invalid}`);
  return deepFreeze({ document: copy, revision });
}

/** @public */
export function blockDigest(block: Pick<TextBlock, 'text'>): string {
  return `sha256:${createHash('sha256').update(block.text, 'utf8').digest('hex')}`;
}

function validateTextOperation(
  state: TransformationState,
  selector: TextSelector,
): PatchFailureCode | undefined {
  const block = findBlock(state.document, selector.blockId);
  if (block === undefined) return 'unknown-block';
  const selectorFailure = validateSelector(selector, block.text, state.revision);
  if (selectorFailure !== undefined) return selectorFailure;
  const overlapsProtection = (state.document.protections ?? []).some((protection) =>
    rangesOverlap(protection.selector, selector),
  );
  return overlapsProtection ? 'protected-span' : undefined;
}

function validateTextOperations(
  state: TransformationState,
  operations: readonly PatchOperation[],
): PatchResult | undefined {
  for (const operation of operations) {
    if (operation.type !== 'replace-text') continue;
    const invalid = validateTextOperation(state, operation.selector);
    if (invalid !== undefined) return failure(invalid, operation.selector.blockId);
  }
  return undefined;
}

function mutatingBlockId(operation: PatchOperation): string | undefined {
  switch (operation.type) {
    case 'replace-text':
      return operation.selector.blockId;
    case 'replace-content-block':
    case 'remove-content-block':
      return operation.blockId;
    case 'insert-content-block':
    case 'set-namespaced-extension':
      return undefined;
  }
}

function hasBlockOperationConflict(operations: readonly PatchOperation[]): boolean {
  const mutationTypes = new Map<string, PatchOperation['type'][]>();
  for (const operation of operations) {
    const blockId = mutatingBlockId(operation);
    if (blockId === undefined) continue;
    const types = mutationTypes.get(blockId) ?? [];
    types.push(operation.type);
    mutationTypes.set(blockId, types);
  }
  return [...mutationTypes.values()].some(
    (types) => types.length > 1 && types.some((type) => type !== 'replace-text'),
  );
}

function pluginOwnsKey(pluginId: string, key: string): boolean {
  return key === pluginId || key.startsWith(`${pluginId}/`);
}

function rebaseRange(
  selector: TextSelector,
  edits: readonly BaseTextEdit[],
): TextSelector | undefined {
  let shift = 0;
  for (const edit of edits) {
    if (rangesOverlap(selector, edit.selector)) return undefined;
    if (edit.selector.range.end <= selector.range.start) {
      shift +=
        scalars(edit.replacement).length - (edit.selector.range.end - edit.selector.range.start);
    }
  }
  return {
    ...selector,
    range: {
      ...selector.range,
      start: selector.range.start + shift,
      end: selector.range.end + shift,
    },
  };
}

function rebaseProtection(
  protection: Protection,
  edit: TextSelector,
  replacement: string,
): Protection {
  const delta = scalars(replacement).length - (edit.range.end - edit.range.start);
  const shift =
    edit.blockId === protection.selector.blockId &&
    edit.range.end <= protection.selector.range.start;
  const selector = shift
    ? {
        ...protection.selector,
        range: {
          ...protection.selector.range,
          start: protection.selector.range.start + delta,
          end: protection.selector.range.end + delta,
        },
      }
    : { ...protection.selector };
  return { ...protection, selector };
}

function applyReplaceText(
  candidate: Candidate,
  operation: Extract<PatchOperation, { type: 'replace-text' }>,
  index: number,
): PatchResult | undefined {
  const block = findBlock(candidate.document, operation.selector.blockId);
  if (block === undefined) return failure('unknown-block', operation.selector.blockId);
  const edits = candidate.textEdits.get(block.id) ?? [];
  const selector = rebaseRange(operation.selector, edits);
  if (selector === undefined) return failure('conflicting-operations', block.id);
  const units = scalars(block.text);
  const before = block.text;
  block.text =
    units.slice(0, selector.range.start).join('') +
    operation.text +
    units.slice(selector.range.end).join('');
  candidate.textEdits.set(block.id, [
    ...edits,
    { selector: operation.selector, replacement: operation.text },
  ]);
  candidate.document.protections = (candidate.document.protections ?? []).map((protection) =>
    rebaseProtection(protection, selector, operation.text),
  );
  candidate.changes.push({
    operationIndex: index,
    type: operation.type,
    blockId: block.id,
    before,
    after: block.text,
  });
  return undefined;
}

function applyInsertBlock(
  candidate: Candidate,
  operation: Extract<PatchOperation, { type: 'insert-content-block' }>,
  index: number,
): PatchResult | undefined {
  if (findBlock(candidate.document, operation.block.id) !== undefined) {
    return failure('duplicate-block', operation.block.id);
  }
  const target = operation.beforeBlockId;
  const insertionIndex =
    target === undefined
      ? candidate.document.content.length
      : candidate.document.content.findIndex((block) => block.id === target);
  // Stryker disable next-line StringLiteral: a negative index is reachable only for a defined,
  // missing beforeBlockId; the fallback is a type-narrowing safeguard with no runtime path.
  if (insertionIndex < 0) return failure('unknown-block', target ?? '');
  candidate.document.content.splice(insertionIndex, 0, { ...operation.block });
  candidate.changes.push({
    operationIndex: index,
    type: operation.type,
    blockId: operation.block.id,
    after: operation.block.text,
  });
  return undefined;
}

function blockIsProtected(document: PromptDocument, blockId: string): boolean {
  return (document.protections ?? []).some((protection) => protection.selector.blockId === blockId);
}

function validateBlockPrecondition(
  candidate: Candidate,
  operation: Extract<PatchOperation, { type: 'replace-content-block' | 'remove-content-block' }>,
): { block: TextBlock; index: number } | PatchResult {
  const index = candidate.document.content.findIndex((block) => block.id === operation.blockId);
  const block = candidate.document.content[index];
  if (block === undefined) return failure('unknown-block', operation.blockId);
  if (blockDigest(block) !== operation.expectedDigest) {
    return failure('precondition-failed', operation.blockId);
  }
  if (blockIsProtected(candidate.document, operation.blockId)) {
    return failure('protected-span', operation.blockId);
  }
  return { block, index };
}

function applyReplaceBlock(
  candidate: Candidate,
  operation: Extract<PatchOperation, { type: 'replace-content-block' }>,
  index: number,
): PatchResult | undefined {
  const precondition = validateBlockPrecondition(candidate, operation);
  if ('ok' in precondition) return precondition;
  if (operation.block.id !== operation.blockId)
    return failure('invalid-document', operation.block.id);
  candidate.document.content[precondition.index] = { ...operation.block };
  candidate.changes.push({
    operationIndex: index,
    type: operation.type,
    blockId: operation.blockId,
    before: precondition.block.text,
    after: operation.block.text,
  });
  return undefined;
}

function applyRemoveBlock(
  candidate: Candidate,
  operation: Extract<PatchOperation, { type: 'remove-content-block' }>,
  index: number,
): PatchResult | undefined {
  if (candidate.document.content.length === 1)
    return failure('invalid-document', operation.blockId);
  const precondition = validateBlockPrecondition(candidate, operation);
  if ('ok' in precondition) return precondition;
  candidate.document.content.splice(precondition.index, 1);
  candidate.changes.push({
    operationIndex: index,
    type: operation.type,
    blockId: operation.blockId,
    before: precondition.block.text,
  });
  return undefined;
}

function applyExtension(
  candidate: Candidate,
  operation: Extract<PatchOperation, { type: 'set-namespaced-extension' }>,
  index: number,
  pluginId: string,
): PatchResult | undefined {
  if (!pluginOwnsKey(pluginId, operation.key)) return failure('invalid-namespace', operation.key);
  const extensions = (candidate.document.extensions ??= {});
  const previous = extensions[operation.key];
  extensions[operation.key] = structuredClone(operation.value);
  candidate.changes.push({
    operationIndex: index,
    type: operation.type,
    ...(previous === undefined ? {} : { before: previous }),
    after: operation.value,
  });
  return undefined;
}

function applyOperation(
  candidate: Candidate,
  operation: PatchOperation,
  index: number,
  pluginId: string,
): PatchResult | undefined {
  switch (operation.type) {
    case 'replace-text':
      return applyReplaceText(candidate, operation, index);
    case 'insert-content-block':
      return applyInsertBlock(candidate, operation, index);
    case 'replace-content-block':
      return applyReplaceBlock(candidate, operation, index);
    case 'remove-content-block':
      return applyRemoveBlock(candidate, operation, index);
    case 'set-namespaced-extension':
      return applyExtension(candidate, operation, index, pluginId);
  }
}

function finalizeCandidate(candidate: Candidate, patch: Patch, nextRevision: number): PatchResult {
  candidate.document.protections = (candidate.document.protections ?? []).map((protection) => ({
    ...protection,
    selector: { ...protection.selector, revision: nextRevision },
  }));
  const invalid = validateDocumentState(candidate.document, nextRevision);
  if (invalid !== undefined) return failure(invalid, patch.id);
  const state = deepFreeze({ document: candidate.document, revision: nextRevision });
  const applied = deepFreeze({
    patchId: patch.id,
    baseRevision: patch.baseRevision,
    revision: nextRevision,
    changes: candidate.changes,
  });
  return { ok: true, state, applied };
}

/** @public */
export function applyPatch(
  state: TransformationState,
  patch: Patch,
  pluginId: string,
): PatchResult {
  if (!validatePatch(patch)) return failure('invalid-patch', 'schema');
  if (patch.baseRevision !== state.revision) return failure('stale-revision', patch.id);
  if (hasBlockOperationConflict(patch.operations)) {
    return failure('conflicting-operations', patch.id);
  }
  const invalidText = validateTextOperations(state, patch.operations);
  if (invalidText !== undefined) return invalidText;
  const candidate: Candidate = {
    document: cloneDocument(state.document),
    changes: [],
    textEdits: new Map(),
  };
  for (const [index, operation] of patch.operations.entries()) {
    const failed = applyOperation(candidate, operation, index, pluginId);
    if (failed !== undefined) return failed;
  }
  return finalizeCandidate(candidate, patch, state.revision + 1);
}
