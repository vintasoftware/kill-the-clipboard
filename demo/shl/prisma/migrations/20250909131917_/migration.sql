/*
  Warnings:

  - You are about to alter the column `builderState` on the `manifests` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_manifests" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "entropy" TEXT NOT NULL,
    "builderState" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_manifests" ("builderState", "createdAt", "entropy", "id") SELECT "builderState", "createdAt", "entropy", "id" FROM "manifests";
DROP TABLE "manifests";
ALTER TABLE "new_manifests" RENAME TO "manifests";
CREATE UNIQUE INDEX "manifests_entropy_key" ON "manifests"("entropy");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
