// The repository the screens use: one RemoteRepository per browser tab, talking to PostgreSQL through
// the server. Screens only call getRepository() and the Repository methods.
//
// Browser only. No key or connection string is ever here.

import { RemoteRepository } from "./remote";

let instance: RemoteRepository | null = null;

export function getRepository(): RemoteRepository {
  if (!instance) instance = new RemoteRepository();
  return instance;
}
