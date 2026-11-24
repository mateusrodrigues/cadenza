export const CATEGORY_IDS = ['correctness', 'clarity', 'style', 'tone'] as const;
export type Category = (typeof CATEGORY_IDS)[number];

export interface CategoryInfo {
  id: Category;
  label: string;
  /** Underline and chip color. Single source of truth for the palette. */
  color: string;
  /** Non-color cue so categories stay distinguishable without color vision. */
  lineStyle: 'wavy' | 'solid' | 'dotted' | 'dashed';
  /** Lower number wins when two suggestions overlap. */
  priority: number;
}

export const CATEGORIES: Record<Category, CategoryInfo> = {
  correctness: {
    id: 'correctness',
    label: 'Correctness',
    color: '#E5484D',
    lineStyle: 'wavy',
    priority: 0,
  },
  clarity: { id: 'clarity', label: 'Clarity', color: '#3E63DD', lineStyle: 'solid', priority: 1 },
  style: { id: 'style', label: 'Style', color: '#F5A623', lineStyle: 'dotted', priority: 2 },
  tone: { id: 'tone', label: 'Tone', color: '#8E4EC6', lineStyle: 'dashed', priority: 3 },
};
