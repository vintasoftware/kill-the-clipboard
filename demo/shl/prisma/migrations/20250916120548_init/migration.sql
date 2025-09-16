-- CreateTable
CREATE TABLE "shls" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entropy" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "manifests" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shlId" TEXT NOT NULL,
    "builderState" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "manifests_shlId_fkey" FOREIGN KEY ("shlId") REFERENCES "shls" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "passcodes" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shlId" TEXT NOT NULL,
    "hashedPasscode" TEXT NOT NULL,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "isInvalidated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "passcodes_shlId_fkey" FOREIGN KEY ("shlId") REFERENCES "shls" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "shls_entropy_key" ON "shls"("entropy");

-- CreateIndex
CREATE UNIQUE INDEX "manifests_shlId_key" ON "manifests"("shlId");

-- CreateIndex
CREATE UNIQUE INDEX "passcodes_shlId_key" ON "passcodes"("shlId");
