import { describe, expect, it } from 'vitest';
import { libraryPageUrl } from '../src/amazon/client.js';

describe('libraryPageUrl', () => {
  it('sends the library token as Amazon gives it, without a second encoding', () => {
    const token = '%252Fabc%252Bdef%253D%253D';
    expect(libraryPageUrl(token)).toBe(`/notebook?library=list&token=${token}`);
  });
});
