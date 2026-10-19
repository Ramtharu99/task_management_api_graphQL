import { config } from "dotenv";

// Load .env, then let TEST_DATABASE_URL (if set) point tests at a dedicated
// database. This must run before the Prisma client is imported.
config({ quiet: true });
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.NODE_ENV ??= "test";

const { prisma } = await import("../src/config/prisma.js");
const { createApolloServer } = await import("../src/graphql/server.js");
const { createTaskService } = await import("../src/services/task.service.js");
const { createAuthService } = await import("../src/services/auth.service.js");
const { verifyToken } = await import("../src/utils/jwt.js");

export { prisma };

export const apollo = createApolloServer();

class Rollback extends Error {}

export type GraphQLErrors = readonly { message: string; extensions?: Record<string, unknown> }[] | undefined;

/** Executes an operation, optionally as the user identified by `token`. */
export type Execute = <TData = Record<string, unknown>>(
    query: string,
    variables?: Record<string, unknown>,
    token?: string,
) => Promise<{ data: TData | null | undefined; errors: GraphQLErrors }>;

/**
 * Runs `fn` inside a database transaction that is ALWAYS rolled back, so
 * tests never leave data behind or modify existing rows. GraphQL operations
 * executed through `execute` use services bound to that transaction.
 */
export const withRollback = async (fn: (execute: Execute) => Promise<void>): Promise<void> => {
    try {
        await prisma.$transaction(
            async (tx) => {
                const services = { taskService: createTaskService(tx), authService: createAuthService(tx) };
                const execute: Execute = async (query, variables, token) => {
                    const auth = token ? verifyToken(token) : null;
                    const contextValue = {
                        ...services,
                        userId: auth && "userId" in auth ? auth.userId : null,
                        ...(auth && "error" in auth ? { authError: auth.error } : {}),
                    };
                    const response = await apollo.executeOperation(
                        { query, ...(variables ? { variables } : {}) },
                        { contextValue },
                    );
                    if (response.body.kind !== "single") throw new Error("Expected a single GraphQL result.");
                    const { data, errors } = response.body.singleResult;
                    return { data: data as never, errors: errors as never };
                };
                await fn(execute);
                throw new Rollback();
            },
            { maxWait: 20_000, timeout: 60_000 },
        );
    } catch (error) {
        if (!(error instanceof Rollback)) throw error;
    }
};

const REGISTER = `mutation ($input: RegisterInput!) { register(input: $input) { token user { id name email } } }`;

/** Registers a throwaway user inside the transaction and returns its token. */
export const registerUser = async (execute: Execute, overrides: Record<string, string> = {}) => {
    const input = { name: "Test User", email: `${uniqueTag()}@example.com`, password: "correct-horse-1", ...overrides };
    const { data, errors } = await execute<{ register: { token: string; user: { id: string; email: string } } }>(
        REGISTER,
        { input },
    );
    if (errors) throw new Error(`register failed: ${JSON.stringify(errors)}`);
    return { ...data!.register, password: input.password };
};

/** Like withRollback, but every operation is sent as a freshly registered user. */
export const withUser = (fn: (execute: Execute) => Promise<void>): Promise<void> =>
    withRollback(async (execute) => {
        const { token } = await registerUser(execute);
        await fn((query, variables, overrideToken) => execute(query, variables, overrideToken ?? token));
    });

export const TASK_FIELDS = "id title description completed priority dueDate createdAt updatedAt";

/** A string unlikely to collide with real data. */
export const uniqueTag = () => `zz-test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
