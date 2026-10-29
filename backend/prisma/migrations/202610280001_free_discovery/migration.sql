ALTER TABLE "Application" ADD COLUMN "matchScore" INTEGER;
ALTER TABLE "Application" ADD COLUMN "discoverySource" TEXT;
CREATE TABLE "PublicFeedCache" (
    "url" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PublicFeedCache_pkey" PRIMARY KEY ("url")
);
