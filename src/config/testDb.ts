import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
    throw new Error("TEST_DATABASE_URL is not configured");
}

export const testPool = new Pool({
    connectionString: testDatabaseUrl,
    ssl: {
        rejectUnauthorized: false,
    },
});