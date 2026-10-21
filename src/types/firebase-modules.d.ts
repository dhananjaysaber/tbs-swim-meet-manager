declare module '../firebase/auth' {
  import type { Auth } from 'firebase/auth';
  export const auth: Auth;
}

declare module '../firebase/auth.js' {
  import type { Auth } from 'firebase/auth';
  export const auth: Auth;
}

declare module '../firebase/db' {
  import type { Database } from 'firebase/database';
  export const db: Database;
}

declare module '../firebase/db.js' {
  import type { Database } from 'firebase/database';
  export const db: Database;
}

declare module '../firebase/client' {
  import type { FirebaseApp } from 'firebase/app';
  export const app: FirebaseApp;
}

declare module '../firebase/client.js' {
  import type { FirebaseApp } from 'firebase/app';
  export const app: FirebaseApp;
}
