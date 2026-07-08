export type ElementKind = 'text' | 'table' | 'image' | 'line' | 'rect' | 'datetime';
export type Paper = 'A4' | 'Letter';
export type Orientation = 'portrait' | 'landscape';

export interface Rect { x: number; y: number; w: number; h: number; }

export type TextAlign = 'left' | 'center' | 'right';

export interface ElementStyle {
  fontSize?: number;
  bold?: boolean;
  align?: TextAlign;
  color?: string;
  strokeColor?: string;
  strokeWidth?: number;
  fill?: string;
}

export interface Margins { top: number; right: number; bottom: number; left: number; }

export interface DesignElement {
  id: string;
  kind: ElementKind;
  name: string;
  rect: Rect;
  /** text/datetime content */
  text?: string;
  /** table column headers */
  columns?: string[];
  /** table sample rows (looks-only) */
  rows?: string[][];
  /** table binding label, e.g. "AMR resistance" */
  boundReport?: string;
  /** presentational style (text/line/rect) */
  style?: ElementStyle;
  /** image source (URL or data: URI) */
  src?: string;
}

export interface DesignPage { id: string; elements: DesignElement[]; }

export interface TemplateParam { key: string; label: string; value: string; }

export interface ReportTemplate {
  id: string;
  name: string;
  paper: Paper;
  orientation: Orientation;
  pages: DesignPage[];
  parameters: TemplateParam[];
  margins?: Margins;
}
