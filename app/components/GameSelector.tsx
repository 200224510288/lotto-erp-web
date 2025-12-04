"use client";

import { GameDef } from "../lib/gameService";

interface GameSelectorProps {
  games: GameDef[];
  selectedGameId: string;
  onChange: (id: string) => void;
}

export function GameSelector({
  games,
  selectedGameId,
  onChange,
}: GameSelectorProps) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-gray-800">
        Select Game (official name)
      </label>
      <select
        value={selectedGameId}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm bg-white text-gray-900"
      >
        <option value="">-- Choose game --</option>
        {games.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name} {g.board ? `(${g.board})` : ""}
          </option>
        ))}
      </select>
      <p className="text-xs text-gray-500">
        This name will be stored in the <span className="font-semibold">Game</span> column.
      </p>
    </div>
  );
}
