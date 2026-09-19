// Shared types for the FAQ feature — components read only through this
// shape and have no knowledge of which categories/answers are demo content.

export type FaqItem = {
  question: string;
  answer: string;
};

export type FaqCategory = {
  name: string;
  items: FaqItem[];
};
