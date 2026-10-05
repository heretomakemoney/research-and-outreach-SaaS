// The one PostgreSQL repository for this server process. SERVER ONLY: reads DATABASE_URL.

import "server-only";
import { connect, PostgresRepository } from "./postgres";

const globalForDb = globalThis as unknown as { __rorRepo?: PostgresRepository };

export class MissingDatabaseUrlError extends Error {
  constructor() {
    super("DATABASE_URL is not set. Add it to .env.local (local) or to the Vercel project's environment variables, then restart / redeploy.");
  }
}

export function getServerRepository(): PostgresRepository {
  if (!globalForDb.__rorRepo) {
    const url = process.env.DATABASE_URL?.trim();
    if (!url) throw new MissingDatabaseUrlError();
    globalForDb.__rorRepo = new PostgresRepository(connect(url));
  }
  return globalForDb.__rorRepo;
}
