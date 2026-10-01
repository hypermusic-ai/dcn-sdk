import { describe, expect, it } from 'vitest';
import { DecentralisedArtApiError, DecentralisedArtClient } from '../src/client';
import {
  DecentralisedArtApiError as PublicDecentralisedArtApiError,
  DecentralisedArtClient as PublicDecentralisedArtClient,
} from '../src';

describe('decentralised.art JS package entrypoint', () => {
  it('exports the public client facade', () => {
    expect(PublicDecentralisedArtClient).toBe(DecentralisedArtClient);
  });

  it('exports the API error so callers can use instanceof', () => {
    expect(PublicDecentralisedArtApiError).toBe(DecentralisedArtApiError);
  });
});
