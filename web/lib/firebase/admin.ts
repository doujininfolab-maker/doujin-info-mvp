import { getApp, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

const APP_NAME = "doujin-info-mvp-web-admin";

function getProjectId(): string {
  return (
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    "demo-project"
  );
}

export function getAdminApp(): App {
  const existing = getApps().find((app) => app.name === APP_NAME);

  if (existing) {
    return getApp(APP_NAME);
  }

  return initializeApp(
    {
      projectId: getProjectId(),
    },
    APP_NAME,
  );
}

export function getAdminDb(): Firestore {
  return getFirestore(getAdminApp());
}