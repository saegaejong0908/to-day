import {
  collection,
  getDocs,
  query,
  where,
  writeBatch,
  deleteDoc,
  doc,
} from "firebase/firestore";
import type { Firestore } from "firebase/firestore";

const BATCH_LIMIT = 450;

/** goalTrackId에 해당하는 모든 goalTrackEvents 삭제 (batch 500 고려) */
export async function deleteGoalTrackEventsByGoalTrackId(
  db: Firestore,
  userId: string,
  goalTrackId: string
): Promise<void> {
  const eventsRef = collection(db, "users", userId, "goalTrackEvents");
  const q = query(eventsRef, where("goalTrackId", "==", goalTrackId));
  for (;;) {
    const snapshot = await getDocs(q);
    if (snapshot.empty) break;
    const batch = writeBatch(db);
    const docsToDelete = snapshot.docs.slice(0, BATCH_LIMIT);
    for (const d of docsToDelete) {
      batch.delete(d.ref);
    }
    await batch.commit();
    if (snapshot.docs.length <= BATCH_LIMIT) break;
  }
}

/** todoId에 해당하는 모든 goalTrackEvents 삭제 */
export async function deleteGoalTrackEventsByTodoId(
  db: Firestore,
  userId: string,
  todoId: string
): Promise<void> {
  const eventsRef = collection(db, "users", userId, "goalTrackEvents");
  const q = query(eventsRef, where("todoId", "==", todoId));
  for (;;) {
    const snapshot = await getDocs(q);
    if (snapshot.empty) break;
    const batch = writeBatch(db);
    const docsToDelete = snapshot.docs.slice(0, BATCH_LIMIT);
    for (const d of docsToDelete) {
      batch.delete(d.ref);
    }
    await batch.commit();
    if (snapshot.docs.length <= BATCH_LIMIT) break;
  }
}
