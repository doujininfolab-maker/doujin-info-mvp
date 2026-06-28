import {
  getApp,
  getApps,
  initializeApp,
  type FirebaseApp,
} from "firebase/app";
import {
  connectFirestoreEmulator,
  getFirestore,
  type Firestore,
} from "firebase/firestore/lite";

const APP_NAME = "doujin-info-mvp-web-lite";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "demo-api-key",
  authDomain:
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ??
    "demo-project.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "demo-project",
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ??
    "demo-project.appspot.com",
  messagingSenderId:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "000000000000",
  appId:
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID ??
    "1:000000000000:web:demo",
};

type FirebaseGlobal = typeof globalThis & {
  __doujinInfoFirestoreLiteEmulatorConnectedV3?: boolean;
};

const globalForFirebase = globalThis as FirebaseGlobal;

export function getFirebaseApp(): FirebaseApp {
  const existing = getApps().find((app) => app.name === APP_NAME);

  if (existing) {
    return getApp(APP_NAME);
  }

  return initializeApp(firebaseConfig, APP_NAME);
}

export function getDb(): Firestore {
  const db = getFirestore(getFirebaseApp());

  const useEmulator =
    process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true";

  if (
    useEmulator &&
    !globalForFirebase.__doujinInfoFirestoreLiteEmulatorConnectedV3
  ) {
    const host =
      process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST ?? "127.0.0.1";
    const port = Number(
      process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT ?? "8080",
    );

    try {
      connectFirestoreEmulator(db, host, port);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);

      if (
        !message.includes("already been started") &&
        !message.includes("already been used")
      ) {
        throw error;
      }
    }

    globalForFirebase.__doujinInfoFirestoreLiteEmulatorConnectedV3 = true;
  }

  return db;
}