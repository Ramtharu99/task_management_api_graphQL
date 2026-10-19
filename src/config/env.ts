import { config } from "dotenv";

config({ quiet: true });

const nodeEnv = process.env.NODE_ENV ?? "development";

const parsePort = (value: string | undefined): number => {
    if (value === undefined || value.trim() === "") return 4000;
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid PORT "${value}". Expected an integer between 1 and 65535.`);
    }
    return port;
};

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill in your connection string.");
}

const jwtSecret = process.env.JWT_SECRET ?? "";
if (jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must be set to a random string of at least 32 characters.");
}

const jwtExpiresIn = process.env.JWT_EXPIRES_IN?.trim() || "7d";
if (!/^\d+(s|m|h|d|w|y)?$/.test(jwtExpiresIn)) {
    throw new Error(`Invalid JWT_EXPIRES_IN "${jwtExpiresIn}". Use a number of seconds or a value like 15m, 12h, 7d.`);
}

export const env = {
    nodeEnv,
    isProduction: nodeEnv === "production",
    port: parsePort(process.env.PORT),
    corsOrigin: process.env.CORS_ORIGIN,
    jwtSecret,
    jwtExpiresIn,
} as const;
