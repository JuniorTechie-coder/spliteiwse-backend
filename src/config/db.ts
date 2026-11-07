import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Keep your existing SSL configuration if your Neon setup requires it.
});
pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL error:", error);
});









