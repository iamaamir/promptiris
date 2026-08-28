import { describe, expect, it } from 'vitest';
import { makeTextDocument } from '@promptiris/protocol';
import { identityRecipe } from '@promptiris/core';
import { captureEvents, createRunContext } from './index.js';

describe('testkit event capture', () => {
  it('collects ordered identity lifecycle events', async () => {
    const capture = captureEvents();

    await identityRecipe.run(makeTextDocument('hello'), createRunContext('run-test', capture.emit));

    expect(capture.events.map((event) => event.sequence)).toEqual([0, 1]);
  });
});
