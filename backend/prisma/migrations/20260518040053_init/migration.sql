-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hcmEmployeeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "managerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Employee_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Employee" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Balance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "balanceMinutes" INTEGER NOT NULL DEFAULT 0,
    "pendingMinutes" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "hcmBalanceVersion" TEXT,
    "lastSyncedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Balance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Balance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PTORequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "requestedMinutes" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actionedAt" DATETIME,
    "actionedById" TEXT,
    "memo" TEXT,
    "hcmRequestId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PTORequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PTORequest_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PTORequest_actionedById_fkey" FOREIGN KEY ("actionedById") REFERENCES "Employee" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "correlationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "actorId" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "result" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "HcmBalanceSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "hcmBalanceMinutes" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "hcmAsOf" DATETIME NOT NULL,
    "externalId" TEXT,
    "processedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HcmBalanceSnapshot_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "HcmBalanceSnapshot_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReconciliationRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "inspectedRows" INTEGER NOT NULL DEFAULT 0,
    "driftCount" INTEGER NOT NULL DEFAULT 0,
    "repairsApplied" INTEGER NOT NULL DEFAULT 0,
    "errorsCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT
);

-- CreateTable
CREATE TABLE "BalanceAdjustmentEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "balanceId" TEXT NOT NULL,
    "ptoRequestId" TEXT,
    "eventType" TEXT NOT NULL,
    "deltaMinutes" INTEGER NOT NULL,
    "resultingBalanceMinutes" INTEGER NOT NULL,
    "resultingPendingMinutes" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "externalEventId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BalanceAdjustmentEvent_balanceId_fkey" FOREIGN KEY ("balanceId") REFERENCES "Balance" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BalanceAdjustmentEvent_ptoRequestId_fkey" FOREIGN KEY ("ptoRequestId") REFERENCES "PTORequest" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Employee_hcmEmployeeId_key" ON "Employee"("hcmEmployeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_email_key" ON "Employee"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Location_code_key" ON "Location"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Balance_employeeId_locationId_key" ON "Balance"("employeeId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "PTORequest_hcmRequestId_key" ON "PTORequest"("hcmRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "PTORequest_employeeId_idempotencyKey_key" ON "PTORequest"("employeeId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_scope_key_actorId_key" ON "IdempotencyKey"("scope", "key", "actorId");

-- CreateIndex
CREATE UNIQUE INDEX "HcmBalanceSnapshot_externalId_key" ON "HcmBalanceSnapshot"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "BalanceAdjustmentEvent_externalEventId_key" ON "BalanceAdjustmentEvent"("externalEventId");
