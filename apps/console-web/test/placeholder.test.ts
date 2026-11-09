import { describe, expect, it } from 'vitest';
import { SERVICE } from '../app/service.js';

describe('console-web', () => {
  it('placeholder ระบุชื่อ service', () => expect(SERVICE).toBe('console-web'));
});
