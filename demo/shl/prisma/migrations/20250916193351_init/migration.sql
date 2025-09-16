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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "manifests_shlId_fkey" FOREIGN KEY ("shlId") REFERENCES "shls" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "manifest_files" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "manifestId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "ciphertextLength" INTEGER NOT NULL,
    "lastUpdated" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "manifest_files_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "manifests" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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

-- CreateTable
CREATE TABLE "recipients" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shlId" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "accessTime" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "recipients_shlId_fkey" FOREIGN KEY ("shlId") REFERENCES "shls" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "shls_entropy_key" ON "shls"("entropy");

-- CreateIndex
CREATE UNIQUE INDEX "manifests_shlId_key" ON "manifests"("shlId");

-- CreateIndex
CREATE INDEX "manifest_files_manifestId_idx" ON "manifest_files"("manifestId");

-- CreateIndex
CREATE UNIQUE INDEX "passcodes_shlId_key" ON "passcodes"("shlId");

-- CreateIndex
CREATE INDEX "recipients_shlId_idx" ON "recipients"("shlId");
