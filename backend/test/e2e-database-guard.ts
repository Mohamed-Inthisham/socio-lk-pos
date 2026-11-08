import { TEST_DATABASE } from '../src/config/test-database-guard';

/**
 * Refuses unless the live connection is the test database. The environment
 * rules (load-test-env.ts) only prove what was configured; this asks the
 * server. truncateAllTables calls it first, on the connection it truncates
 * with. The message names only the expected database, never the one found.
 */
export async function assertConnectedToTestDatabase(connection: {
  query(sql: string): Promise<{ current_database: string }[]>;
}): Promise<void> {
  const rows = await connection.query('SELECT current_database()');
  if (rows[0]?.current_database !== TEST_DATABASE) {
    throw new Error(
      `Refusing to reset: the connection is not ${TEST_DATABASE}.`,
    );
  }
}
