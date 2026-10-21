import { getDatabase } from 'firebase/database';
import { app } from './client';

export const db = getDatabase(app);
