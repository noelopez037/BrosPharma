export type CellAlign = "left" | "right" | "center";
export type ColumnKind = "text" | "int" | "money" | "date" | "month";

export type ReportColumn<Row> = {
  key: string;
  label: string;
  align?: CellAlign;
  kind?: ColumnKind;
  value?: (row: Row) => any;
  formatPdf?: (value: any, row: Row) => string;
  formatCsv?: (value: any, row: Row) => string;
};

export type ReportFetchResult<Row> = {
  rows: Row[];
  summary?: { label: string; value: string }[];
};

export type ReportDefinition<Filters extends Record<string, any>, Row> = {
  id: string;
  title: string;
  description?: string;
  columns: ReportColumn<Row>[];
  defaultFilters: Filters;
  requires?: (filters: Filters) => string | null;
  buildSubtitle?: (filters: Filters) => string;
  buildFileNameStem?: (filters: Filters) => string;
  fetchRows: (filters: Filters) => Promise<ReportFetchResult<Row>>;
};
