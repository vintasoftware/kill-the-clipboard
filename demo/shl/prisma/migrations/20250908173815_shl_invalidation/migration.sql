-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_passcodes" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "entropy" TEXT NOT NULL,
    "hashedPasscode" TEXT NOT NULL,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "isInvalidated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_passcodes" ("createdAt", "entropy", "hashedPasscode", "id") SELECT "createdAt", "entropy", "hashedPasscode", "id" FROM "passcodes";
DROP TABLE "passcodes";
ALTER TABLE "new_passcodes" RENAME TO "passcodes";
CREATE UNIQUE INDEX "passcodes_entropy_key" ON "passcodes"("entropy");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
