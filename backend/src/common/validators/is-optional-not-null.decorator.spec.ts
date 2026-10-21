import { plainToInstance } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, validate } from 'class-validator';
import { PartialType } from '@nestjs/swagger';
import { IsOptionalNotNull } from './is-optional-not-null.decorator';

class CreateThing {
  @IsString()
  name!: string;

  @IsOptionalNotNull()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsString()
  notes?: string | null;
}

class UpdateThing extends PartialType(CreateThing, {
  skipNullProperties: false,
}) {}

const errorsFor = async (cls: new () => object, body: object) => {
  const errors = await validate(plainToInstance(cls, body));
  return Object.fromEntries(
    errors.map((e) => [e.property, Object.values(e.constraints ?? {})]),
  );
};

describe('IsOptionalNotNull', () => {
  it('lets an omitted field through', async () => {
    expect(await errorsFor(CreateThing, { name: 'A' })).toEqual({});
  });

  it('rejects null with "must not be null"', async () => {
    const errors = await errorsFor(CreateThing, {
      name: 'A',
      is_active: null,
    });
    expect(errors.is_active).toContain('is_active must not be null');
  });

  it("runs the field's own validators on a value", async () => {
    const errors = await errorsFor(CreateThing, {
      name: 'A',
      is_active: 'yes',
    });
    expect(errors.is_active).toEqual(['is_active must be a boolean value']);
    expect(
      await errorsFor(CreateThing, { name: 'A', is_active: false }),
    ).toEqual({});
  });

  describe('with PartialType(..., { skipNullProperties: false })', () => {
    it('allows an empty update', async () => {
      expect(await errorsFor(UpdateThing, {})).toEqual({});
    });

    it('rejects null on a field required on create', async () => {
      const errors = await errorsFor(UpdateThing, { name: null });
      expect(errors.name).toEqual(['name must be a string']);
    });

    it('rejects null on an optional NOT NULL field', async () => {
      const errors = await errorsFor(UpdateThing, { is_active: null });
      expect(errors.is_active).toContain('is_active must not be null');
    });

    it('still lets null clear a nullable field', async () => {
      expect(await errorsFor(UpdateThing, { notes: null })).toEqual({});
    });
  });
});
