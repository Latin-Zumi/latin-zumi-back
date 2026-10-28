import { Pool } from 'pg';
import { getPoolConfig } from './db-connection.js';

export const pool = new Pool(getPoolConfig());
