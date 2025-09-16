-- CreateTable
CREATE TABLE "recipients" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shlId" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "accessTime" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "recipients_shlId_fkey" FOREIGN KEY ("shlId") REFERENCES "shls" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "recipients_shlId_idx" ON "recipients"("shlId");
