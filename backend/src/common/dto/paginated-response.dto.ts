import { ApiProperty } from '@nestjs/swagger';

/**
 * Metadata block returned alongside paginated data.
 *
 * total       — total row count matching the filters (across all pages)
 * page        — current page number (1-based)
 * limit       — page size
 * totalPages  — Math.ceil(total / limit); 0 if total is 0
 * hasNext     — is there a page after this one?
 * hasPrev     — is there a page before this one?
 *
 * hasNext/hasPrev are cheap to compute on the server and save frontend
 * math — reduces the chance of pagination bugs across many consumers.
 */
export class PaginationMeta {
  @ApiProperty({ example: 137 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 50 })
  limit!: number;

  @ApiProperty({ example: 3 })
  totalPages!: number;

  @ApiProperty({ example: true })
  hasNext!: boolean;

  @ApiProperty({ example: false })
  hasPrev!: boolean;
}

/**
 * Standard shape for any paginated list response.
 *
 * Usage in a service:
 *   return paginate(rows, total, page, limit);
 *
 * (See the paginate() helper below.)
 */
export class PaginatedResponse<T> {
  data!: T[];
  meta!: PaginationMeta;
}

/**
 * Build a PaginatedResponse from raw query results.
 *
 * @param data  Rows from the current page
 * @param total Total count matching the filters (from a separate COUNT query)
 * @param page  1-based page number requested
 * @param limit Rows per page requested
 */
export function paginate<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): PaginatedResponse<T> {
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
  return {
    data,
    meta: {
      total,
      page,
      limit,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
}
