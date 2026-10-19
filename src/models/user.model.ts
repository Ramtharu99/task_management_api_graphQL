import type { User } from "../generated/prisma/client.js";

/** A user as exposed by the API — never includes the password hash. */
export type PublicUser = Omit<User, "passwordHash">;

export interface RegisterInput {
    name: string;
    email: string;
    password: string;
}

export interface LoginInput {
    email: string;
    password: string;
}

export interface AuthPayload {
    token: string;
    user: PublicUser;
}
