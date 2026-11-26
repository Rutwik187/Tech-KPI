import { describe, expect, it } from 'vitest';
import { open, seal } from '../secret-box';

describe('secret box', () => {
  it('reads back what it stored, and each value looks different', () => {
    const a = seal('refresh-token-value', 'secret-1');
    const b = seal('refresh-token-value', 'secret-1');
    expect(a).not.toBe(b);
    expect(a).not.toContain('refresh-token-value');
    expect(open(a, 'secret-1')).toBe('refresh-token-value');
  });
  it('refuses a different key or a changed value', () => {
    const sealed = seal('refresh-token-value', 'secret-1');
    expect(() => open(sealed, 'secret-2')).toThrow();
    const [v, iv, tag, body] = sealed.split('.');
    expect(() => open([v, iv, tag, body.slice(0, -2) + (body.endsWith('AA') ? 'BB' : 'AA')].join('.'), 'secret-1')).toThrow();
    expect(() => open('plain-text', 'secret-1')).toThrow();
  });
});
