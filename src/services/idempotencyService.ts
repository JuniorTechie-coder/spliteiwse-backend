
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

export type IdempotencyOperation =
    | "create_expense"
    | "record_settlement";

interface ClaimIdempotencyKeyParams {
    userId: number;
    operation: IdempotencyOperation;
    idempotencyKey: string;
    requestHash: string;
}

interface IdempotencyResponse {
    status: number;
    body: unknown;
}

export type IdempotencyClaim =
    | {
          isReplay: false;
          id: string;
      }
    | {
          isReplay: true;
          response: IdempotencyResponse;
      }
    | {
          isReplay: false;
          conflict: true;
      };

// Generate a SHA-256 hash of the normalized request payload.
export function createRequestHash(
    payload: Record<string, unknown>
): string {
    const serializedPayload = JSON.stringify(payload);

    return createHash("sha256")
        .update(serializedPayload)
        .digest("hex");
}

// Claim a key or retrieve its previously stored response.
export async function claimIdempotencyKey(
    client: PoolClient,
    params: ClaimIdempotencyKeyParams
): Promise<IdempotencyClaim> {
    const {
        userId,
        operation,
        idempotencyKey,
        requestHash,
    } = params;

    // Try to create a new idempotency record.
    const insertResult = await client.query(
        `INSERT INTO idempotency_keys
            (user_id, operation, idempotency_key, request_hash)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, operation, idempotency_key)
         DO NOTHING
         RETURNING id`,
        [userId, operation, idempotencyKey, requestHash]
    );

    // This request successfully claimed the key.
    if (insertResult.rowCount === 1) {
        return {
            isReplay: false,
            id: String(insertResult.rows[0].id),
        };
    }

    // The key already exists. Lock and inspect its record.
    const existingResult = await client.query(
        `SELECT id, request_hash, response_status, response_body
         FROM idempotency_keys
         WHERE user_id = $1
           AND operation = $2
           AND idempotency_key = $3
         FOR UPDATE`,
        [userId, operation, idempotencyKey]
    );

    if (existingResult.rowCount !== 1) {
        throw new Error("Idempotency record could not be retrieved");
    }

    const existing = existingResult.rows[0];

    // Same key cannot be reused for a different request.
    if (existing.request_hash !== requestHash) {
        return {
            isReplay: false,
            conflict: true,
        };
    }

    // A committed record should always contain its response.
    if (
        existing.response_status === null ||
        existing.response_body === null
    ) {
        throw new Error(
            "Idempotency record exists without a completed response"
        );
    }

    return {
        isReplay: true,
        response: {
            status: existing.response_status,
            body: existing.response_body,
        },
    };
}

// Store the original successful response before committing.
export async function completeIdempotencyKey(
    client: PoolClient,
    id: string,
    responseStatus: number,
    responseBody: unknown
): Promise<void> {
    const result = await client.query(
        `UPDATE idempotency_keys
         SET response_status = $1,
             response_body = $2
         WHERE id = $3
           AND response_status IS NULL
           AND response_body IS NULL
         RETURNING id`,
        [responseStatus, responseBody, id]
    );

    if (result.rowCount !== 1) {
        throw new Error("Failed to complete idempotency record");
    }
}
