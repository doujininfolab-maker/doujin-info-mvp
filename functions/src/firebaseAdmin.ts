import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (getApps().length === 0) {
  initializeApp();
}

const firestore = getFirestore();

// Firestore does not accept `undefined` values by default. DLsite pages often do not
// expose optional fields such as discountRate / wishlistCount, so we omit those
// fields instead of failing the whole batch.
firestore.settings({ ignoreUndefinedProperties: true });

export const db = firestore;
