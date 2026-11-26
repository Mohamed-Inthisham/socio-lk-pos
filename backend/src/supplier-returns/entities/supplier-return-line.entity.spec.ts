import { instanceToPlain } from 'class-transformer';
import { COST_GROUP } from '../../common/utils/cost-visibility';
import { SupplierReturnLine } from './supplier-return-line.entity';

describe('SupplierReturnLine cost visibility', () => {
  it('hides the informational unit cost unless the cost serializer group is enabled', () => {
    const line = Object.assign(new SupplierReturnLine(), {
      id: 'return-line-id',
      unit_cost_snapshot: '1250.00',
    });

    expect(instanceToPlain(line)).not.toHaveProperty('unit_cost_snapshot');
    expect(instanceToPlain(line, { groups: [COST_GROUP] })).toHaveProperty(
      'unit_cost_snapshot',
      '1250.00',
    );
  });
});
