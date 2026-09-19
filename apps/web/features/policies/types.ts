// Shared types for the Stay Policies feature — components read only through
// these shapes and have no knowledge of which values are demo content.

export type PolicyRow = {
  label: string;
  value: string;
};

export type PolicySection = {
  id: string;
  title: string;
  rows: PolicyRow[];
};

export type PolicyOverviewItem = {
  id: string;
  title: string;
  summary: string;
};
