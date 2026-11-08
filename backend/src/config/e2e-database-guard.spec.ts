// Here, not in test/: the unit run's rootDir is src, and test/*.ts is e2e-only.
import { assertConnectedToTestDatabase } from '../../test/e2e-database-guard';

/** A stand-in connection answering with these rows: no database involved. */
const connection = (rows: { current_database: string }[]) => ({
  query: jest.fn().mockResolvedValue(rows),
});

describe('assertConnectedToTestDatabase', () => {
  it('accepts the test database, asking the server by current_database()', async () => {
    const db = connection([{ current_database: 'socio_lk_pos_test' }]);

    await expect(assertConnectedToTestDatabase(db)).resolves.toBeUndefined();
    expect(db.query).toHaveBeenCalledWith('SELECT current_database()');
  });

  it.each([
    ['the development database', 'socio_lk_pos_dev'],
    ['another case', 'SOCIO_LK_POS_TEST'],
    ['a longer name', 'socio_lk_pos_test_copy'],
    ['an empty name', ''],
  ])('refuses %s', async (_, current_database) => {
    await expect(
      assertConnectedToTestDatabase(connection([{ current_database }])),
    ).rejects.toThrow(/not socio_lk_pos_test/);
  });

  it('refuses an empty answer', async () => {
    await expect(assertConnectedToTestDatabase(connection([]))).rejects.toThrow(
      /not socio_lk_pos_test/,
    );
  });

  it('refuses when the check itself fails', async () => {
    const db = { query: jest.fn().mockRejectedValue(new Error('no server')) };

    await expect(assertConnectedToTestDatabase(db)).rejects.toThrow(
      'no server',
    );
  });

  it('does not print the database it found', async () => {
    await expect(
      assertConnectedToTestDatabase(
        connection([{ current_database: 'private_db' }]),
      ),
    ).rejects.not.toThrow(/private_db/);
  });
});
