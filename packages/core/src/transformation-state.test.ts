import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Patch, PromptDocument, TextSelector } from '@promptiris/protocol';
import {
  applyPatch,
  blockDigest,
  createTransformationState,
  type TransformationState,
} from './transformation-state.js';

interface TransformationFixture {
  selectorCases: {
    name: string;
    text: string;
    currentRevision: number;
    selector: TextSelector;
    graphemeValid: boolean;
  }[];
}

function selector(
  blockId: string,
  revision: number,
  start: number,
  end: number,
  exact: string,
): TextSelector {
  return {
    blockId,
    revision,
    range: { unit: 'unicode-scalar', start, end },
    quote: { exact },
  };
}

function patch(baseRevision: number, operations: Patch['operations']): Patch {
  return { schemaVersion: '1', id: 'test-patch', baseRevision, operations };
}

function textState(text = 'A👩‍💻B'): TransformationState {
  return createTransformationState({
    schemaVersion: '1',
    content: [{ id: 'input', text }],
  });
}

describe('transformation state', () => {
  it('agrees with the shared TypeScript/Go selector fixture', () => {
    const fixtureUrl = new URL('../../../spec/fixtures/transformation-state.json', import.meta.url);
    const fixture = JSON.parse(readFileSync(fixtureUrl, 'utf8')) as TransformationFixture;

    for (const item of fixture.selectorCases) {
      const state = createTransformationState(
        { schemaVersion: '1', content: [{ id: 'input', text: item.text }] },
        item.currentRevision,
      );
      const result = applyPatch(
        state,
        patch(item.currentRevision, [
          { type: 'replace-text', selector: item.selector, text: item.selector.quote.exact },
        ]),
        'example/plugin',
      );
      expect(result.ok, item.name).toBe(item.graphemeValid);
    }
  });

  it('defensively clones and deeply freezes a rich Prompt Document', () => {
    const source: PromptDocument = {
      schemaVersion: '1',
      content: [{ id: 'input', text: 'original' }],
      context: [{ uri: 'file:///tmp/reference' }],
      constraints: [{ id: 'host/intent', kind: 'host/semantic', value: { keep: true } }],
      extensions: { 'host/state': { nested: ['value'] } },
    };

    const state = createTransformationState(source);
    const sourceBlock = source.content[0];
    if (sourceBlock === undefined) throw new Error('fixture block missing');
    sourceBlock.text = 'mutated';

    expect(state.document.content[0]?.text).toBe('original');
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.document)).toBe(true);
    expect(Object.isFrozen(state.document.extensions?.['host/state'])).toBe(true);
  });

  it('rejects invalid initial documents, duplicate blocks, and invalid protections', () => {
    expect(() => createTransformationState({ schemaVersion: '1', content: [] })).toThrow(
      /invalid-document/i,
    );
    expect(() =>
      createTransformationState({
        schemaVersion: '1',
        content: [
          { id: 'duplicate', text: 'first' },
          { id: 'duplicate', text: 'second' },
        ],
      }),
    ).toThrow(/duplicate-block/i);
    expect(() =>
      createTransformationState({
        schemaVersion: '1',
        content: [{ id: 'input', text: 'input' }],
        protections: [{ id: 'host/missing', selector: selector('missing', 0, 0, 1, 'x') }],
      }),
    ).toThrow(/unknown-block/i);
    expect(() =>
      createTransformationState({
        schemaVersion: '1',
        content: [{ id: 'input', text: 'input' }],
        protections: [{ id: 'host/bad', selector: selector('input', 0, 0, 1, 'x') }],
      }),
    ).toThrow(/quote-mismatch/i);
    expect(() =>
      createTransformationState({
        schemaVersion: '1',
        content: [{ id: 'input', text: 'input' }],
        protections: [
          { id: 'host/good', selector: selector('input', 0, 0, 1, 'i') },
          { id: 'host/bad-second', selector: selector('input', 0, 1, 2, 'x') },
        ],
      }),
    ).toThrow(/quote-mismatch/i);
  });

  it('uses Unicode scalar offsets and rejects endpoints inside a grapheme', () => {
    const state = textState();
    const accepted = applyPatch(
      state,
      patch(0, [
        {
          type: 'replace-text',
          selector: selector('input', 0, 1, 4, '👩‍💻'),
          text: 'X',
        },
      ]),
      'example/plugin',
    );
    const split = applyPatch(
      state,
      patch(0, [
        {
          type: 'replace-text',
          selector: selector('input', 0, 2, 3, '\u200d'),
          text: 'X',
        },
      ]),
      'example/plugin',
    );

    expect(accepted.ok && accepted.state.document.content[0]?.text).toBe('AXB');
    expect(split).toMatchObject({ ok: false, code: 'invalid-selector' });
  });

  it('validates revision, exact quote, prefix, and suffix evidence', () => {
    const state = textState('prefix target suffix');
    const exact = selector('input', 0, 7, 13, 'target');

    expect(
      applyPatch(
        state,
        patch(0, [{ type: 'replace-text', selector: { ...exact, revision: 1 }, text: 'x' }]),
        'example/plugin',
      ),
    ).toMatchObject({ ok: false, code: 'stale-selector' });
    expect(
      applyPatch(
        state,
        patch(0, [
          { type: 'replace-text', selector: { ...exact, quote: { exact: 'wrong' } }, text: 'x' },
        ]),
        'example/plugin',
      ),
    ).toMatchObject({ ok: false, code: 'quote-mismatch' });
    expect(
      applyPatch(
        state,
        patch(0, [
          {
            type: 'replace-text',
            selector: { ...exact, quote: { exact: 'target', prefix: 'wrong' } },
            text: 'x',
          },
        ]),
        'example/plugin',
      ),
    ).toMatchObject({ ok: false, code: 'quote-mismatch' });
    expect(
      applyPatch(
        state,
        patch(1, [{ type: 'replace-text', selector: exact, text: 'x' }]),
        'example/plugin',
      ),
    ).toMatchObject({ ok: false, code: 'stale-revision' });
    expect(
      applyPatch(
        state,
        patch(0, [
          {
            type: 'replace-text',
            selector: { ...exact, quote: { exact: 'target', suffix: 'wrong' } },
            text: 'x',
          },
        ]),
        'example/plugin',
      ),
    ).toMatchObject({ ok: false, code: 'quote-mismatch' });
    expect(
      applyPatch(
        state,
        patch(0, [
          { type: 'replace-text', selector: selector('missing', 0, 0, 1, 'x'), text: 'x' },
        ]),
        'example/plugin',
      ),
    ).toMatchObject({ ok: false, code: 'unknown-block' });

    const contextual = {
      ...exact,
      quote: { exact: 'target', prefix: 'prefix ', suffix: ' suffix' },
    };
    expect(
      applyPatch(
        state,
        patch(0, [{ type: 'replace-text', selector: contextual, text: 'x' }]),
        'example/plugin',
      ),
    ).toMatchObject({ ok: true });
    expect(
      applyPatch(
        state,
        patch(0, [
          {
            type: 'replace-text',
            selector: { ...contextual, quote: { ...contextual.quote, prefix: 'prefix' } },
            text: 'x',
          },
        ]),
        'example/plugin',
      ),
    ).toMatchObject({ ok: false, code: 'quote-mismatch' });
    expect(
      applyPatch(
        state,
        patch(0, [
          {
            type: 'replace-text',
            selector: { ...contextual, quote: { ...contextual.quote, suffix: 'suffix' } },
            text: 'x',
          },
        ]),
        'example/plugin',
      ),
    ).toMatchObject({ ok: false, code: 'quote-mismatch' });
    expect(
      applyPatch(
        state,
        patch(0, [{ type: 'replace-text', selector: selector('input', 0, 10, 9, ''), text: 'x' }]),
        'example/plugin',
      ),
    ).toMatchObject({ ok: false, code: 'invalid-selector' });
  });

  it.each([
    ['wrong unit', { unit: 'utf16', start: 0, end: 1 }, 'invalid-patch', 'schema'],
    ['fractional start', { unit: 'unicode-scalar', start: 0.5, end: 1 }, 'invalid-patch', 'schema'],
    ['fractional end', { unit: 'unicode-scalar', start: 0, end: 1.5 }, 'invalid-patch', 'schema'],
    ['negative start', { unit: 'unicode-scalar', start: -1, end: 1 }, 'invalid-patch', 'schema'],
    ['reversed range', { unit: 'unicode-scalar', start: 2, end: 1 }, 'invalid-selector', 'input'],
    ['past end', { unit: 'unicode-scalar', start: 0, end: 99 }, 'invalid-selector', 'input'],
  ])('rejects an invalid selector range: %s', (_name, range, code, detail) => {
    const malformed = {
      schemaVersion: '1',
      id: 'malformed-range',
      baseRevision: 0,
      operations: [
        {
          type: 'replace-text',
          selector: { blockId: 'input', revision: 0, range, quote: { exact: 'a' } },
          text: 'x',
        },
      ],
    } as Patch;

    expect(applyPatch(textState('abc'), malformed, 'example/plugin')).toMatchObject({
      ok: false,
      code,
      detail,
    });
  });

  it('rejects protected overlap and atomically discards earlier candidate operations', () => {
    const state = createTransformationState({
      schemaVersion: '1',
      content: [{ id: 'input', text: 'hello TOKEN' }],
      protections: [{ id: 'host/token', selector: selector('input', 0, 6, 11, 'TOKEN') }],
    });
    const result = applyPatch(
      state,
      patch(0, [
        { type: 'insert-content-block', block: { id: 'temporary', text: 'must roll back' } },
        { type: 'replace-text', selector: selector('input', 0, 6, 11, 'TOKEN'), text: 'changed' },
      ]),
      'example/plugin',
    );

    expect(result).toMatchObject({ ok: false, code: 'protected-span' });
    expect(state.document.content).toEqual([{ id: 'input', text: 'hello TOKEN' }]);
  });

  it('rebases protected selectors after a non-overlapping edit', () => {
    const state = createTransformationState({
      schemaVersion: '1',
      content: [{ id: 'input', text: 'a TOKEN' }],
      protections: [{ id: 'host/token', selector: selector('input', 0, 2, 7, 'TOKEN') }],
    });
    const result = applyPatch(
      state,
      patch(0, [
        { type: 'replace-text', selector: selector('input', 0, 0, 1, 'a'), text: 'alpha' },
      ]),
      'example/plugin',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.document.content[0]?.text).toBe('alpha TOKEN');
    expect(result.state.document.protections?.[0]?.selector).toMatchObject({
      revision: 1,
      range: { start: 6, end: 11 },
      quote: { exact: 'TOKEN' },
    });
    expect(result.applied.changes).toHaveLength(1);
  });

  it('computes protected-range deltas from non-zero edit ranges', () => {
    const state = createTransformationState({
      schemaVersion: '1',
      content: [{ id: 'input', text: 'xxa TOKEN' }],
      protections: [{ id: 'host/token', selector: selector('input', 0, 4, 9, 'TOKEN') }],
    });
    const result = applyPatch(
      state,
      patch(0, [{ type: 'replace-text', selector: selector('input', 0, 2, 3, 'a'), text: 'AAAA' }]),
      'example/plugin',
    );

    expect(result.ok && result.state.document.protections?.[0]?.selector.range).toMatchObject({
      start: 7,
      end: 12,
    });
  });

  it('rebases later non-overlapping operations declared against one base revision', () => {
    const state = textState('abcdef');
    const result = applyPatch(
      state,
      patch(0, [
        { type: 'replace-text', selector: selector('input', 0, 0, 1, 'a'), text: 'AAA' },
        { type: 'replace-text', selector: selector('input', 0, 5, 6, 'f'), text: 'F' },
      ]),
      'example/plugin',
    );

    expect(result.ok && result.state.document.content[0]?.text).toBe('AAAbcdeF');
  });

  it('computes rebase deltas from non-zero base ranges', () => {
    const state = textState('abcdef');
    const result = applyPatch(
      state,
      patch(0, [
        { type: 'replace-text', selector: selector('input', 0, 2, 3, 'c'), text: 'CCC' },
        { type: 'replace-text', selector: selector('input', 0, 5, 6, 'f'), text: 'F' },
      ]),
      'example/plugin',
    );

    expect(result.ok && result.state.document.content[0]?.text).toBe('abCCCdeF');
  });

  it('does not shift a following edit when an earlier edit ends after its start', () => {
    const state = textState('abcdef');
    const result = applyPatch(
      state,
      patch(0, [
        { type: 'replace-text', selector: selector('input', 0, 4, 6, 'ef'), text: 'EF' },
        { type: 'replace-text', selector: selector('input', 0, 0, 2, 'ab'), text: 'AB' },
      ]),
      'example/plugin',
    );

    expect(result.ok && result.state.document.content[0]?.text).toBe('ABcdEF');
  });

  it('treats touching ranges as non-overlapping in either order', () => {
    const state = textState('abcd');
    const result = applyPatch(
      state,
      patch(0, [
        { type: 'replace-text', selector: selector('input', 0, 0, 2, 'ab'), text: 'A' },
        { type: 'replace-text', selector: selector('input', 0, 2, 4, 'cd'), text: 'C' },
      ]),
      'example/plugin',
    );

    expect(result.ok && result.state.document.content[0]?.text).toBe('AC');
  });

  it('leaves earlier selectors unchanged when a later edit follows them', () => {
    const state = createTransformationState({
      schemaVersion: '1',
      content: [{ id: 'input', text: 'TOKEN suffix' }],
      protections: [{ id: 'host/token', selector: selector('input', 0, 0, 5, 'TOKEN') }],
    });
    const result = applyPatch(
      state,
      patch(0, [
        { type: 'replace-text', selector: selector('input', 0, 6, 12, 'suffix'), text: 'tail' },
      ]),
      'example/plugin',
    );

    expect(result.ok && result.state.document.protections?.[0]?.selector.range).toEqual({
      unit: 'unicode-scalar',
      start: 0,
      end: 5,
    });
  });

  it('does not rebase a protection belonging to another block', () => {
    const state = createTransformationState({
      schemaVersion: '1',
      content: [
        { id: 'first', text: 'abc' },
        { id: 'second', text: 'TOKEN' },
      ],
      protections: [{ id: 'host/token', selector: selector('second', 0, 0, 5, 'TOKEN') }],
    });
    const result = applyPatch(
      state,
      patch(0, [{ type: 'replace-text', selector: selector('first', 0, 1, 2, 'b'), text: 'BBBB' }]),
      'example/plugin',
    );

    expect(result.ok && result.state.document.protections?.[0]?.selector).toMatchObject({
      revision: 1,
      range: { start: 0, end: 5 },
    });
  });

  it('rejects overlapping text operations from the same base revision', () => {
    const state = textState('abcdef');
    const result = applyPatch(
      state,
      patch(0, [
        { type: 'replace-text', selector: selector('input', 0, 0, 3, 'abc'), text: 'A' },
        { type: 'replace-text', selector: selector('input', 0, 2, 5, 'cde'), text: 'B' },
      ]),
      'example/plugin',
    );

    expect(result).toMatchObject({ ok: false, code: 'conflicting-operations' });
  });

  it('does not conflict identical ranges belonging to different blocks', () => {
    const state = createTransformationState({
      schemaVersion: '1',
      content: [
        { id: 'first', text: 'abc' },
        { id: 'second', text: 'xyz' },
      ],
    });
    const result = applyPatch(
      state,
      patch(0, [
        { type: 'replace-text', selector: selector('first', 0, 0, 1, 'a'), text: 'A' },
        { type: 'replace-text', selector: selector('second', 0, 0, 1, 'x'), text: 'X' },
      ]),
      'example/plugin',
    );

    expect(result.ok && result.state.document.content.map((block) => block.text)).toEqual([
      'Abc',
      'Xyz',
    ]);
  });

  it('inserts before stable block IDs and rejects duplicate or missing targets', () => {
    const state = createTransformationState({
      schemaVersion: '1',
      content: [
        { id: 'first', text: 'first' },
        { id: 'second', text: 'second' },
      ],
    });
    const inserted = applyPatch(
      state,
      patch(0, [
        {
          type: 'insert-content-block',
          block: { id: 'middle', text: 'middle' },
          beforeBlockId: 'second',
        },
      ]),
      'example/plugin',
    );

    expect(inserted.ok && inserted.state.document.content.map((block) => block.id)).toEqual([
      'first',
      'middle',
      'second',
    ]);
    const insertedFirst = applyPatch(
      state,
      patch(0, [
        {
          type: 'insert-content-block',
          block: { id: 'zeroth', text: 'zeroth' },
          beforeBlockId: 'first',
        },
      ]),
      'example/plugin',
    );
    expect(insertedFirst.ok && insertedFirst.state.document.content[0]?.id).toBe('zeroth');
    expect(
      applyPatch(
        state,
        patch(0, [{ type: 'insert-content-block', block: { id: 'first', text: 'duplicate' } }]),
        'example/plugin',
      ),
    ).toMatchObject({ ok: false, code: 'duplicate-block', detail: 'first' });
    expect(
      applyPatch(
        state,
        patch(0, [
          {
            type: 'insert-content-block',
            block: { id: 'new', text: 'new' },
            beforeBlockId: 'missing',
          },
        ]),
        'example/plugin',
      ),
    ).toMatchObject({ ok: false, code: 'unknown-block', detail: 'missing' });
  });

  it('enforces block preconditions, stable identities, and protected block ownership', () => {
    const state = createTransformationState({
      schemaVersion: '1',
      content: [
        { id: 'first', text: 'first' },
        { id: 'second', text: 'second' },
      ],
      protections: [{ id: 'host/first', selector: selector('first', 0, 0, 5, 'first') }],
    });

    expect(
      applyPatch(
        state,
        patch(0, [
          {
            type: 'remove-content-block',
            blockId: 'second',
            expectedDigest: blockDigest({ text: 'wrong' }),
          },
        ]),
        'example/plugin',
      ),
    ).toMatchObject({ ok: false, code: 'precondition-failed' });
    expect(
      applyPatch(
        state,
        patch(0, [
          {
            type: 'remove-content-block',
            blockId: 'first',
            expectedDigest: blockDigest({ text: 'first' }),
          },
        ]),
        'example/plugin',
      ),
    ).toMatchObject({ ok: false, code: 'protected-span' });
    expect(
      applyPatch(
        state,
        patch(0, [
          {
            type: 'replace-content-block',
            blockId: 'second',
            expectedDigest: blockDigest({ text: 'second' }),
            block: { id: 'renamed', text: 'replacement' },
          },
        ]),
        'example/plugin',
      ),
    ).toMatchObject({ ok: false, code: 'invalid-document' });
  });

  it('rejects block replacement mixed with text edits against the same base snapshot', () => {
    const state = textState('abc');
    const result = applyPatch(
      state,
      patch(0, [
        {
          type: 'replace-content-block',
          blockId: 'input',
          expectedDigest: blockDigest({ text: 'abc' }),
          block: { id: 'input', text: 'replacement' },
        },
        { type: 'replace-text', selector: selector('input', 0, 0, 1, 'a'), text: 'A' },
      ]),
      'example/plugin',
    );

    expect(result).toMatchObject({ ok: false, code: 'conflicting-operations' });
    expect(state.document.content[0]?.text).toBe('abc');
  });

  it('replaces and removes unprotected blocks after matching their digests', () => {
    const state = createTransformationState({
      schemaVersion: '1',
      content: [
        { id: 'first', text: 'first' },
        { id: 'second', text: 'second' },
      ],
    });
    const replaced = applyPatch(
      state,
      patch(0, [
        {
          type: 'replace-content-block',
          blockId: 'second',
          expectedDigest: blockDigest({ text: 'second' }),
          block: { id: 'second', text: 'updated' },
        },
      ]),
      'example/plugin',
    );
    expect(replaced.ok && replaced.state.document.content[1]?.text).toBe('updated');
    const removed = applyPatch(
      state,
      patch(0, [
        {
          type: 'remove-content-block',
          blockId: 'second',
          expectedDigest: blockDigest({ text: 'second' }),
        },
      ]),
      'example/plugin',
    );
    expect(removed.ok && removed.state.document.content).toEqual([{ id: 'first', text: 'first' }]);
    expect(
      applyPatch(
        textState('only'),
        patch(0, [
          {
            type: 'remove-content-block',
            blockId: 'input',
            expectedDigest: blockDigest({ text: 'only' }),
          },
        ]),
        'example/plugin',
      ),
    ).toMatchObject({ ok: false, code: 'invalid-document' });
    expect(
      applyPatch(
        state,
        patch(0, [
          {
            type: 'remove-content-block',
            blockId: 'missing',
            expectedDigest: blockDigest({ text: 'missing' }),
          },
        ]),
        'example/plugin',
      ),
    ).toMatchObject({ ok: false, code: 'unknown-block' });
  });

  it('allows only the invoking Plugin to write its extension namespace', () => {
    const state = textState('input');
    const denied = applyPatch(
      state,
      patch(0, [{ type: 'set-namespaced-extension', key: 'other/plugin/state', value: 1 }]),
      'example/plugin',
    );
    const accepted = applyPatch(
      state,
      patch(0, [{ type: 'set-namespaced-extension', key: 'example/plugin/state', value: 1 }]),
      'example/plugin',
    );

    expect(denied).toMatchObject({ ok: false, code: 'invalid-namespace' });
    expect(accepted.ok && accepted.state.document.extensions).toEqual({
      'example/plugin/state': 1,
    });
    expect(accepted.ok && accepted.applied.changes[0]).toEqual({
      operationIndex: 0,
      type: 'set-namespaced-extension',
      after: 1,
    });
    expect(accepted.ok && Object.hasOwn(accepted.applied.changes[0] ?? {}, 'before')).toBe(false);
    const overwritten = accepted.ok
      ? applyPatch(
          accepted.state,
          patch(1, [{ type: 'set-namespaced-extension', key: 'example/plugin/state', value: 2 }]),
          'example/plugin',
        )
      : accepted;
    expect(overwritten.ok && overwritten.applied.changes[0]?.before).toBe(1);
    expect(overwritten.ok && overwritten.applied.changes[0]?.after).toBe(2);
    expect(
      applyPatch(
        state,
        patch(0, [{ type: 'set-namespaced-extension', key: 'example/plugin', value: true }]),
        'example/plugin',
      ).ok,
    ).toBe(true);
  });

  it('rejects structurally invalid Patch envelopes before application', () => {
    const invalid = { schemaVersion: '1', id: 'empty', baseRevision: 0, operations: [] } as Patch;
    expect(applyPatch(textState(), invalid, 'example/plugin')).toEqual({
      ok: false,
      code: 'invalid-patch',
      detail: 'schema',
    });
  });

  it('preserves state atomically for arbitrary valid prefixes when a later operation fails', () => {
    const ascii = fc
      .array(fc.constantFrom('a', 'b', 'c', ' '), { maxLength: 40 })
      .map((characters) => characters.join(''));

    fc.assert(
      fc.property(ascii, (text) => {
        const state = textState(text);
        const result = applyPatch(
          state,
          patch(0, [
            { type: 'insert-content-block', block: { id: 'candidate', text: 'candidate' } },
            { type: 'set-namespaced-extension', key: 'other/plugin/state', value: true },
          ]),
          'example/plugin',
        );
        expect(result.ok).toBe(false);
        expect(state.document.content).toEqual([{ id: 'input', text }]);
      }),
      { seed: 20260828, numRuns: 200 },
    );
  });

  it('rebases arbitrary protected ASCII suffixes without changing their exact text', () => {
    const ascii = fc
      .array(fc.constantFrom('a', 'b', 'c'), { minLength: 1, maxLength: 30 })
      .map((characters) => characters.join(''));

    fc.assert(
      fc.property(ascii, ascii, (prefix, protectedText) => {
        const state = createTransformationState({
          schemaVersion: '1',
          content: [{ id: 'input', text: `${prefix}${protectedText}` }],
          protections: [
            {
              id: 'host/protected',
              selector: selector(
                'input',
                0,
                prefix.length,
                prefix.length + protectedText.length,
                protectedText,
              ),
            },
          ],
        });
        const result = applyPatch(
          state,
          patch(0, [
            {
              type: 'replace-text',
              selector: selector('input', 0, 0, prefix.length, prefix),
              text: `${prefix}${prefix}`,
            },
          ]),
          'example/plugin',
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const protection = result.state.document.protections?.[0]?.selector;
        expect(protection?.quote.exact).toBe(protectedText);
        expect(protection?.range.start).toBe(prefix.length * 2);
      }),
      { seed: 20260828, numRuns: 200 },
    );
  });
});
