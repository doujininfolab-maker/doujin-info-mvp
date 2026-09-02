import assert from "node:assert/strict";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../firebaseAdmin";

const SEGMENT_ID = "dlsite_female_doujin";
const BACKUP_ID = "compactSearchRootBackup";

async function run(): Promise<void> {
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? "";
  assert.match(emulatorHost, /^(127\.0\.0\.1|localhost):\d+$/);
  assert.notEqual(process.env.GCLOUD_PROJECT, "doujin-info-prod");
  const mode = process.argv[2];
  const rootRef = db.collection("compactSearchIndexes").doc(SEGMENT_ID);
  const backupRef = db.collection("_localTestState").doc(BACKUP_ID);

  if (mode === "apply") {
    const root = await rootRef.get();
    assert.equal(root.exists, true);
    await backupRef.set({ root: root.data() }, { merge: false });
    await rootRef.set({
      activeVersion: "__missing_active_version__",
      previousVersion: FieldValue.delete(),
    }, { merge: true });
    console.log("Compact search fault applied to emulator only");
    return;
  }

  if (mode === "restore") {
    const backup = await backupRef.get();
    assert.equal(backup.exists, true, "Compact search root backup is missing");
    await rootRef.set(backup.data()?.root, { merge: false });
    await backupRef.delete();
    console.log("Compact search root restored in emulator");
    return;
  }

  throw new Error("Expected apply or restore");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
