import type { PoolClient } from "pg";
import { pool } from "../config/db.js";

type TransactionOperation<T> = (
    client: PoolClient
) => Promise<T>;

function getPostgresErrorCode(error: unknown): string | undefined {
    if (typeof error !== "object" || error === null || !("code" in error)) {
        return undefined;
    }

    const code = (error as { code?: unknown }).code;

    return typeof code === "string" ? code : undefined;
}

function isRetryableTransactionError(error: unknown): boolean {
    const code = getPostgresErrorCode(error);

    return code === "40P01" || code === "40001";
}

export async function withTransactionRetry<T>(
    operation: TransactionOperation<T>,
    maxRetries = 3
): Promise<T> {
    if (!Number.isInteger(maxRetries) || maxRetries < 0) {
        throw new Error("maxRetries must be a non-negative integer");
    }

    let retryCount = 0;

    while (true) {
        const client = await pool.connect();
        let transactionStarted = false;

        try {
            await client.query("BEGIN");
            transactionStarted = true;

            const result = await operation(client);

            await client.query("COMMIT");

            return result;
        } catch (error: unknown) {
            if (transactionStarted) {
                try {
                    await client.query("ROLLBACK");
                } catch (rollbackError) {
                    console.error(
                        "Transaction rollback failed:",
                        rollbackError
                    );
                }
            }

            const canRetry = isRetryableTransactionError(error);

            if (!canRetry || retryCount >= maxRetries) {
                throw error;
            }

            retryCount++;
        } finally {
            client.release();
        }
    }
}
