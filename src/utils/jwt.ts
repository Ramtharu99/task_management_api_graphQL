import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env.js";

const ALGORITHM = "HS256";

export const signToken = (userId: number): string =>
    jwt.sign({}, env.jwtSecret, {
        algorithm: ALGORITHM,
        subject: String(userId),
        expiresIn: env.jwtExpiresIn as NonNullable<SignOptions["expiresIn"]>,
    });

export type TokenResult = { userId: number } | { error: string };

/** Verifies a token and returns the user id, or a client-safe reason it was rejected. */
export const verifyToken = (token: string): TokenResult => {
    try {
        const payload = jwt.verify(token, env.jwtSecret, { algorithms: [ALGORITHM] });
        const userId = typeof payload === "object" ? Number(payload.sub) : Number.NaN;
        if (!Number.isSafeInteger(userId) || userId < 1) return { error: "Invalid token." };
        return { userId };
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) return { error: "Your session has expired. Please log in again." };
        return { error: "Invalid token." };
    }
};
