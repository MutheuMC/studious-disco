ALTER TABLE "Application"
 ADD COLUMN "requirementsSatisfied" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "assessmentProfileUpdatedAt" TIMESTAMP(3),
 ADD COLUMN "automationState" TEXT NOT NULL DEFAULT 'NEW',
 ADD COLUMN "reviewReason" TEXT,
 ADD COLUMN "applicationInstructions" TEXT,
 ADD COLUMN "instructionsVerifiedAt" TIMESTAMP(3),
 ADD COLUMN "portalPreparedAt" TIMESTAMP(3),
 ADD COLUMN "autoAttemptedAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN "progress" TEXT, ADD COLUMN "result" JSONB;
CREATE TABLE "AutomationSettings" (
 "userId" TEXT NOT NULL PRIMARY KEY,
 "searchEnabled" BOOLEAN NOT NULL DEFAULT true,
 "searchIntervalHours" INTEGER NOT NULL DEFAULT 6,
 "nextSearchAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "lastSearchAt" TIMESTAMP(3),
 "lastSearchAdded" INTEGER NOT NULL DEFAULT 0,
 "lastSearchError" TEXT,
 "lastSearchWarnings" TEXT,
 "workerLastSeenAt" TIMESTAMP(3),
 "policyRevision" INTEGER NOT NULL DEFAULT 0,
 "autoApplyEnabled" BOOLEAN NOT NULL DEFAULT false,
 "minMatchScore" INTEGER NOT NULL DEFAULT 85,
 "dailyLimit" INTEGER NOT NULL DEFAULT 3,
 "allowedRoles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
 "allowedEmailDomains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
 "approvedDocumentIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
 "subjectTemplate" TEXT NOT NULL DEFAULT 'Application for {{title}} — {{name}}',
 "bodyTemplate" TEXT NOT NULL DEFAULT '',
 "preparePortalDrafts" BOOLEAN NOT NULL DEFAULT true,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "AutomationSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
