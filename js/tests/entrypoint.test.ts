import { describe, expect, it } from 'vitest';
import { DecentralisedArtClient } from '../src/client';
import { DecentralisedArtClient as PublicDecentralisedArtClient } from '../src';

describe('decentralised.art JS package entrypoint', () => {
  it('exports the public client facade', () => {
    expect(PublicDecentralisedArtClient).toBe(DecentralisedArtClient);
  });
});
