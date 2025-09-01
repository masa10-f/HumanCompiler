/**
 * Sorting options for API endpoints
 */
export enum SortBy {
  STATUS = 'status',
  TITLE = 'title',
  CREATED_AT = 'created_at',
  UPDATED_AT = 'updated_at',
  PRIORITY = 'priority',
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export interface SortOptions {
  sortBy?: SortBy;
  sortOrder?: SortOrder;
}
