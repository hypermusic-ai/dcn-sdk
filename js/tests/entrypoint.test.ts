import { describe, expect, it } from 'vitest';
import { DcnClient } from '../src/client';
import { DcnClient as PublicDcnClient } from '../src';

describe('DCN JS package entrypoint', () => {
  it('exports the public client facade', () => {
    expect(PublicDcnClient).toBe(DcnClient);
  });
});
