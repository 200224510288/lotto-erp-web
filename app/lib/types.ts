export type GameDef = {
  id: string;
  name: string;
  shortCode?: string | null;
  board?: string | null;
};

export type Cell = string | number | null;

export type StructuredRow = {
  DealerCode: string;
  Game: string;
  Draw: string;
  Qty: number;
};

export type BreakingSegment = {
  start: number;
  end: number;
};