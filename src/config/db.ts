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





// import pg from "pg"
// import dotenv from "dotenv"

// dotenv.config();

// const { pool } = pg;

// export const pool = new pool({
//   connectionString: process.env.DATABASE_URL,
// });

// pool.on("error", (error) => {
//     console.log("Unexpected PostgresSQL error:", error);
// });