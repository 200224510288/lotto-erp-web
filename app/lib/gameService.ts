import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
} from "firebase/firestore";
import { db } from "./firebase";
import { GameDef } from "./types";

const GAMES_COLLECTION = "games";

export async function fetchGames(): Promise<GameDef[]> {
  const snap = await getDocs(collection(db, GAMES_COLLECTION));
  const games: GameDef[] = [];

  snap.forEach((d) => {
    games.push({
      id: d.id,
      name: d.data().name,
      shortCode: d.data().shortCode ?? null,
      board: d.data().board ?? null,
    });
  });

  return games.sort((a, b) => a.name.localeCompare(b.name));
}

export async function createGame(payload: Omit<GameDef, "id">): Promise<void> {
  await addDoc(collection(db, GAMES_COLLECTION), {
    name: payload.name,
    shortCode: payload.shortCode ?? null,
    board: payload.board ?? null,
  });
}

export async function updateGame(
  id: string,
  payload: Partial<Omit<GameDef, "id">>
): Promise<void> {
  const ref = doc(db, GAMES_COLLECTION, id);
  await updateDoc(ref, payload);
}

export async function deleteGame(id: string): Promise<void> {
  await deleteDoc(doc(db, GAMES_COLLECTION, id));
}
export type GameDef = {
  id: string;        // Document ID
  name: string;      // Official game name
  shortCode?: string | null;
  board?: string | null;
};
