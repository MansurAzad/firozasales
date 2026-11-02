import { describe, it, expect } from 'vitest';
import { accessChangeBlock, accessReasonSchema, accessRules, type AccessUser } from './access-control';
const admin: AccessUser = { id: 'a', role: 'admin', full_name: 'Admin', is_active: true, created_at: '' };
const sr: AccessUser = { ...admin, id: 'b', role: 'salesman' };
describe('access management rules', () => {
  it('blocks changing your own access', () => expect(accessChangeBlock('a', admin, [admin, sr], 'salesman', true)).toBe('self'));
  it('blocks disabling the last active admin', () => expect(accessChangeBlock('b', admin, [admin, sr], 'admin', false)).toBe('last-admin'));
  it('ignores inactive admins when protecting the last active admin', () => expect(accessChangeBlock('b', admin, [admin, { ...admin, id: 'c', is_active: false }], 'salesman', true)).toBe('last-admin'));
  it('permits another admin to manage an SR', () => expect(accessChangeBlock('a', sr, [admin, sr], 'salesman', false)).toBeUndefined());
  it('permits a no-op without changing access', () => expect(accessChangeBlock('a', admin, [admin], 'admin', true)).toBeUndefined());
  it('requires a nonblank reason of 3 to 500 characters', () => { expect(accessReasonSchema.safeParse('  ').success).toBe(false); expect(accessReasonSchema.safeParse('ok').success).toBe(false); expect(accessReasonSchema.safeParse('reviewed').success).toBe(true); expect(accessReasonSchema.safeParse('a'.repeat(501)).success).toBe(false); });
  it('does not allow either role to edit posted accounts', () => { const rule = accessRules.find(r => r.en === 'Edit / delete posted accounts'); expect(rule?.admin).toBe('none'); expect(rule?.sr).toBe('none'); });
});