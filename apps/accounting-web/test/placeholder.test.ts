import { describe, expect, it } from 'vitest';
import { SERVICE } from '../app/service.js';

describe('accounting-web', () => {
  it('ระบุชื่อ service', () => expect(SERVICE).toBe('accounting-web'));
});
