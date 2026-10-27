import { resolveSync } from '../../src/sync/resolve-sync';

const base = { id: 'campus-inc-001', version: 1, fields: { work: { assignedTechnicianId: 'technician-1', status: 'assigned' }, priority: 'medium' } };

describe('resolveSync (Abraham)', () => {
  test('same content with keys in another order is not a conflict', () => {
    const local = { ...base, fields: { ...base.fields, work: { status: 'in_progress', assignedTechnicianId: 'technician-1' } } };
    const remote = { ...base, version: 2, fields: { ...base.fields, work: { assignedTechnicianId: 'technician-1', status: 'in_progress' } } };
    expect(resolveSync(base, local, remote)).toEqual({
      kind: 'merged',
      fields: { work: { assignedTechnicianId: 'technician-1', status: 'in_progress' }, priority: 'medium' },
    });
  });

  test('several conflicts are reported in name order', () => {
    const local = { ...base, fields: { work: { assignedTechnicianId: 'technician-1', status: 'in_progress' }, priority: 'low' } };
    const remote = { ...base, version: 2, fields: { work: { assignedTechnicianId: 'technician-2', status: 'assigned' }, priority: 'high' } };
    expect(resolveSync(base, local, remote)).toEqual({ kind: 'conflict', fields: ['priority', 'work'] });
  });
});