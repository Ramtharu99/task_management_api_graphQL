import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import jwt from "jsonwebtoken";
import { apollo, prisma, registerUser, uniqueTag, withRollback, type GraphQLErrors } from "./helpers.js";

const REGISTER = `mutation ($input: RegisterInput!) { register(input: $input) { token user { id name email createdAt } } }`;
const LOGIN = `mutation ($input: LoginInput!) { login(input: $input) { token user { id email } } }`;
const ME = `{ me { id name email } }`;

const errorCode = (errors: GraphQLErrors) => errors?.[0]?.extensions?.code;

before(async () => {
    await apollo.start();
});

after(async () => {
    await apollo.stop();
    await prisma.$disconnect();
});

describe("register", () => {
    it("creates a user, normalises the email and returns a usable token", async () => {
        await withRollback(async (execute) => {
            const email = `${uniqueTag()}@Example.COM`;
            const { data, errors } = await execute<{
                register: { token: string; user: { id: string; name: string; email: string; createdAt: string } };
            }>(REGISTER, { input: { name: "  Ram  ", email: `  ${email} `, password: "supersecret1" } });
            assert.equal(errors, undefined, JSON.stringify(errors));
            assert.equal(data!.register.user.name, "Ram");
            assert.equal(data!.register.user.email, email.toLowerCase());
            assert.ok(data!.register.token.split(".").length === 3, "token is a JWT");

            const me = await execute<{ me: { id: string } }>(ME, undefined, data!.register.token);
            assert.equal(me.errors, undefined);
            assert.equal(me.data!.me.id, data!.register.user.id);
        });
    });

    it("never stores the plain password", async () => {
        await withRollback(async (execute) => {
            const { user, password } = await registerUser(execute);
            const { data } = await execute<{ __type: { fields: { name: string }[] } }>(
                `{ __type(name: "User") { fields { name } } }`,
            );
            assert.ok(!data!.__type.fields.some((f) => /password/i.test(f.name)), "User type has no password field");
            assert.ok(user.id);
            assert.notEqual(password, "");
        });
    });

    it("rejects a duplicate email (case-insensitively)", async () => {
        await withRollback(async (execute) => {
            const { user } = await registerUser(execute);
            const { errors } = await execute(REGISTER, {
                input: { name: "Again", email: user.email.toUpperCase(), password: "anotherpass1" },
            });
            assert.equal(errorCode(errors), "BAD_USER_INPUT");
            assert.equal(errors![0]!.extensions!.field, "email");
        });
    });

    it("validates name, email and password", async () => {
        await withRollback(async (execute) => {
            const valid = { name: "Ok", email: `${uniqueTag()}@example.com`, password: "longenough1" };
            const cases: [Record<string, string>, string][] = [
                [{ ...valid, name: "   " }, "name"],
                [{ ...valid, email: "not-an-email" }, "email"],
                [{ ...valid, password: "short" }, "password"],
                [{ ...valid, password: "x".repeat(73) }, "password"],
            ];
            for (const [input, field] of cases) {
                const { errors } = await execute(REGISTER, { input });
                assert.equal(errorCode(errors), "BAD_USER_INPUT", field);
                assert.equal(errors![0]!.extensions!.field, field);
            }
        });
    });
});

describe("login", () => {
    it("returns a token for valid credentials", async () => {
        await withRollback(async (execute) => {
            const { user, password } = await registerUser(execute);
            const { data, errors } = await execute<{ login: { token: string; user: { id: string } } }>(LOGIN, {
                input: { email: user.email.toUpperCase(), password },
            });
            assert.equal(errors, undefined);
            assert.equal(data!.login.user.id, user.id);

            const me = await execute<{ me: { email: string } }>(ME, undefined, data!.login.token);
            assert.equal(me.data!.me.email, user.email);
        });
    });

    it("rejects a wrong password and an unknown email with the same message", async () => {
        await withRollback(async (execute) => {
            const { user } = await registerUser(execute);
            const wrong = await execute(LOGIN, { input: { email: user.email, password: "wrong-password" } });
            const unknown = await execute(LOGIN, {
                input: { email: `${uniqueTag()}@example.com`, password: "whatever123" },
            });
            assert.equal(errorCode(wrong.errors), "UNAUTHENTICATED");
            assert.equal(errorCode(unknown.errors), "UNAUTHENTICATED");
            assert.equal(wrong.errors![0]!.message, unknown.errors![0]!.message);
        });
    });
});

describe("authorization", () => {
    it("requires a token for every task operation", async () => {
        await withRollback(async (execute) => {
            const operations = [
                ME,
                `{ tasks { id } }`,
                `{ task(id: "1") { id } }`,
                `{ searchTasks(search: "x") { id } }`,
                `{ taskStatistics { totalTasks } }`,
                `mutation { createTask(input: { title: "x" }) { id } }`,
                `mutation { updateTask(id: "1", input: { title: "x" }) { id } }`,
                `mutation { deleteTask(id: "1") { success } }`,
                `mutation { completeTask(id: "1") { id } }`,
            ];
            for (const query of operations) {
                const { errors } = await execute(query);
                assert.equal(errorCode(errors), "UNAUTHENTICATED", query);
            }
        });
    });

    it("rejects invalid, tampered and expired tokens", async () => {
        await withRollback(async (execute) => {
            const { token, user } = await registerUser(execute);

            const garbage = await execute(ME, undefined, "not-a-jwt");
            assert.equal(errorCode(garbage.errors), "UNAUTHENTICATED");

            const forged = jwt.sign({}, "some-other-secret-that-is-long-enough!", { subject: user.id });
            assert.equal(errorCode((await execute(ME, undefined, forged)).errors), "UNAUTHENTICATED");

            const tampered = token.slice(0, -2) + (token.endsWith("aa") ? "bb" : "aa");
            assert.equal(errorCode((await execute(ME, undefined, tampered)).errors), "UNAUTHENTICATED");

            const expired = jwt.sign({}, process.env.JWT_SECRET!, { subject: user.id, expiresIn: -10 });
            const res = await execute(ME, undefined, expired);
            assert.equal(errorCode(res.errors), "UNAUTHENTICATED");
            assert.match(res.errors![0]!.message, /expired/i);
        });
    });

    it("isolates tasks between users", async () => {
        await withRollback(async (execute) => {
            const alice = await registerUser(execute, { name: "Alice" });
            const bob = await registerUser(execute, { name: "Bob" });

            const created = await execute<{ createTask: { id: string } }>(
                `mutation { createTask(input: { title: "Alice's secret task", priority: HIGH }) { id } }`,
                undefined,
                alice.token,
            );
            const taskId = created.data!.createTask.id;

            const bobList = await execute<{ tasks: { id: string }[] }>(`{ tasks { id } }`, undefined, bob.token);
            assert.ok(!bobList.data!.tasks.some((t) => t.id === taskId), "Bob can't list Alice's task");

            const bobSearch = await execute<{ searchTasks: { id: string }[] }>(
                `{ searchTasks(search: "secret") { id } }`,
                undefined,
                bob.token,
            );
            assert.equal(bobSearch.data!.searchTasks.length, 0);

            const bobStats = await execute<{ taskStatistics: { totalTasks: number } }>(
                `{ taskStatistics { totalTasks } }`,
                undefined,
                bob.token,
            );
            assert.equal(bobStats.data!.taskStatistics.totalTasks, 0);

            for (const query of [
                `query ($id: ID!) { task(id: $id) { id } }`,
                `mutation ($id: ID!) { updateTask(id: $id, input: { title: "hacked" }) { id } }`,
                `mutation ($id: ID!) { completeTask(id: $id) { id } }`,
                `mutation ($id: ID!) { deleteTask(id: $id) { success } }`,
            ]) {
                const { errors } = await execute(query, { id: taskId }, bob.token);
                assert.equal(errorCode(errors), "NOT_FOUND", query);
            }

            const aliceView = await execute<{ task: { title: string; completed: boolean } }>(
                `query ($id: ID!) { task(id: $id) { title completed } }`,
                { id: taskId },
                alice.token,
            );
            assert.deepEqual(aliceView.data!.task, { title: "Alice's secret task", completed: false });
        });
    });
});
