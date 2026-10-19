import bcrypt from "bcryptjs";
import { prisma } from "../config/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import type { AuthPayload, LoginInput, PublicUser, RegisterInput } from "../models/user.model.js";
import { badUserInput, toGraphQLError, unauthenticated } from "../utils/errors.js";
import { signToken } from "../utils/jwt.js";
import { validateEmail, validateName, validatePassword } from "../utils/validation.js";
import type { DatabaseClient } from "./task.service.js";

const BCRYPT_ROUNDS = 10;

const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", BCRYPT_ROUNDS);

const publicUser = { id: true, name: true, email: true, createdAt: true, updatedAt: true } as const;

export const createAuthService = (db: DatabaseClient) => ({
    async register(input: RegisterInput): Promise<AuthPayload> {
        if (input == null) throw badUserInput("Register input is required.");
        const name = validateName(input.name);
        const email = validateEmail(input.email);
        const password = validatePassword(input.password);

        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        try {
            const user = await db.user.create({ data: { name, email, passwordHash }, select: publicUser });
            return { token: signToken(user.id), user };
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                throw badUserInput("An account with this email already exists.", "email");
            }
            throw toGraphQLError(error);
        }
    },

    async login(input: LoginInput): Promise<AuthPayload> {
        if (input == null) throw badUserInput("Login input is required.");
        const email = (input.email ?? "").trim().toLowerCase();
        const password = input.password ?? "";
        if (email === "" || password === "") throw badUserInput("Email and password are required.");

        let user;
        try {
            user = await db.user.findUnique({ where: { email } });
        } catch (error) {
            throw toGraphQLError(error);
        }

        const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
        if (!user || !valid) throw unauthenticated("Invalid email or password.");

        const { passwordHash: _hash, ...safeUser } = user;
        return { token: signToken(user.id), user: safeUser };
    },

    async getUserById(userId: number): Promise<PublicUser> {
        let user;
        try {
            user = await db.user.findUnique({ where: { id: userId }, select: publicUser });
        } catch (error) {
            throw toGraphQLError(error);
        }
        if (!user) throw unauthenticated("Your account no longer exists. Please register or log in again.");
        return user;
    },
});

export type AuthService = ReturnType<typeof createAuthService>;

export const authService: AuthService = createAuthService(prisma);
