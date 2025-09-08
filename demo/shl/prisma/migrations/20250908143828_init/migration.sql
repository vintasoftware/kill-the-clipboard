-- CreateTable
CREATE TABLE "manifests" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "entropy" TEXT NOT NULL,
    "builderState" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "passcodes" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "entropy" TEXT NOT NULL,
    "hashedPasscode" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "manifests_entropy_key" ON "manifests"("entropy");

-- CreateIndex
CREATE UNIQUE INDEX "passcodes_entropy_key" ON "passcodes"("entropy");
