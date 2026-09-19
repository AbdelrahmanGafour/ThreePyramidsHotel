// Shared types for the Privacy feature — components read only through this
// shape and have no knowledge of which sections are demo content.

export type PrivacySection = {
  id: string;
  title: string;
  paragraphs: string[];
};
