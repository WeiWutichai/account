import { describe, expect, it } from 'vitest';
import { SERVICE } from '../app/service.js';

describe('id-web', () => {
  it('placeholder ระบุชื่อ service', () => expect(SERVICE).toBe('id-web'));
});
