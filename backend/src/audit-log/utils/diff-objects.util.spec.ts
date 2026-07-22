import { diffObjects } from './diff-objects.util';

describe('diffObjects', () => {
  describe('null handling', () => {
    it('returns null when before is null', () => {
      expect(diffObjects(null, { name: 'A' })).toBeNull();
    });

    it('returns null when after is null', () => {
      expect(diffObjects({ name: 'A' }, null)).toBeNull();
    });

    it('returns null when both are null', () => {
      expect(diffObjects(null, null)).toBeNull();
    });
  });

  describe('no changes', () => {
    it('returns null when nothing changed', () => {
      const before = { name: 'Alice', role: 'admin' };
      const after = { name: 'Alice', role: 'admin' };
      expect(diffObjects(before, after)).toBeNull();
    });

    it('returns null when only ignored fields differ', () => {
      const before = { name: 'Alice', updated_at: '2026-01-01' };
      const after = { name: 'Alice', updated_at: '2026-07-22' };
      expect(diffObjects(before, after)).toBeNull();
    });
  });

  describe('primitive changes', () => {
    it('captures a single field change', () => {
      const before = { name: 'Alice' };
      const after = { name: 'Bob' };
      expect(diffObjects(before, after)).toEqual({
        name: { old: 'Alice', new: 'Bob' },
      });
    });

    it('captures multiple field changes', () => {
      const before = { name: 'Alice', role: 'cashier' };
      const after = { name: 'Bob', role: 'admin' };
      expect(diffObjects(before, after)).toEqual({
        name: { old: 'Alice', new: 'Bob' },
        role: { old: 'cashier', new: 'admin' },
      });
    });

    it('excludes ignored fields even when they change', () => {
      const before = {
        name: 'Alice',
        updated_at: '2026-01-01',
        created_at: '2025-01-01',
      };
      const after = {
        name: 'Bob',
        updated_at: '2026-07-22',
        created_at: '2025-01-01',
      };
      expect(diffObjects(before, after)).toEqual({
        name: { old: 'Alice', new: 'Bob' },
      });
    });
  });

  describe('nested / complex values', () => {
    it('detects changes in nested objects', () => {
      const before = { meta: { active: true } };
      const after = { meta: { active: false } };
      expect(diffObjects(before, after)).toEqual({
        meta: { old: { active: true }, new: { active: false } },
      });
    });

    it('returns null for deeply-equal nested objects', () => {
      const before = { meta: { active: true, count: 3 } };
      const after = { meta: { active: true, count: 3 } };
      expect(diffObjects(before, after)).toBeNull();
    });
  });
});
