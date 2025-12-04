"use client";

import { FormEvent, useState } from "react";
import {
  GameDef,
  createGame,
  updateGame,
  deleteGame,
} from "../lib/gameService";

interface GameAdminProps {
  games: GameDef[];
  onRefresh: () => Promise<void>;
}

export function GameAdmin({ games, onRefresh }: GameAdminProps) {
  const [name, setName] = useState("");
  const [shortCode, setShortCode] = useState("");
  const [board, setBoard] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit(game: GameDef) {
    setEditingId(game.id);
    setName(game.name);
    setShortCode(game.shortCode ?? "");
    setBoard(game.board ?? "");
  }

  function resetForm() {
    setEditingId(null);
    setName("");
    setShortCode("");
    setBoard("");
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Game name is required.");
      return;
    }

    setIsBusy(true);
    try {
      if (editingId) {
        await updateGame(editingId, {
          name: name.trim(),
          shortCode: shortCode.trim() || null,
          board: board.trim() || null,
        });
      } else {
        await createGame({
          name: name.trim(),
          shortCode: shortCode.trim() || null,
          board: board.trim() || null,
        });
      }

      await onRefresh();
      resetForm();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error saving game.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this game?")) return;
    setIsBusy(true);
    try {
      await deleteGame(id);
      await onRefresh();
      if (editingId === id) {
        resetForm();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error deleting game.");
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <section className="border border-gray-300 rounded-lg p-3 bg-white space-y-3">
      <h3 className="text-xs font-semibold text-gray-800 uppercase tracking-wide">
        Game Master (CRUD)
      </h3>

      <form onSubmit={handleSubmit} className="space-y-2">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <div>
            <label className="block text-xs text-gray-700 mb-1">
              Game name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm bg-white text-gray-900"
              placeholder="e.g. SUPER BALL (FRI)"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-700 mb-1">
              Short code (optional)
            </label>
            <input
              type="text"
              value={shortCode}
              onChange={(e) => setShortCode(e.target.value)}
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm bg-white text-gray-900"
              placeholder="e.g. SBF"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-700 mb-1">
              Board (optional)
            </label>
            <input
              type="text"
              value={board}
              onChange={(e) => setBoard(e.target.value)}
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm bg-white text-gray-900"
              placeholder="e.g. DLB / NLB"
            />
          </div>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={isBusy}
            className="px-3 py-1.5 rounded bg-blue-600 text-white text-xs font-medium disabled:opacity-60"
          >
            {editingId ? "Update game" : "Add game"}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="px-3 py-1.5 rounded border border-gray-300 text-xs"
            >
              Cancel edit
            </button>
          )}
        </div>
      </form>

      <div className="border border-gray-200 rounded max-h-48 overflow-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-2 py-1 text-left font-medium">Name</th>
              <th className="px-2 py-1 text-left font-medium">Short</th>
              <th className="px-2 py-1 text-left font-medium">Board</th>
              <th className="px-2 py-1 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {games.map((g) => (
              <tr key={g.id} className="border-t border-gray-200">
                <td className="px-2 py-1">{g.name}</td>
                <td className="px-2 py-1">{g.shortCode}</td>
                <td className="px-2 py-1">{g.board}</td>
                <td className="px-2 py-1 text-right space-x-2">
                  <button
                    type="button"
                    onClick={() => startEdit(g)}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(g.id)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {games.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-2 py-2 text-center text-gray-500 text-xs"
                >
                  No games defined yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
