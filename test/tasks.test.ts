import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { TASK_FIELDS, apollo, prisma, uniqueTag, withUser, type Execute } from "./helpers.js";

type TaskResult = {
    id: string;
    title: string;
    description: string | null;
    completed: boolean;
    priority: "LOW" | "MEDIUM" | "HIGH";
    dueDate: string | null;
    createdAt: string;
    updatedAt: string;
};

const CREATE = `mutation ($input: CreateTaskInput!) { createTask(input: $input) { ${TASK_FIELDS} } }`;

const createTask = async (execute: Execute, input: Record<string, unknown>): Promise<TaskResult> => {
    const { data, errors } = await execute<{ createTask: TaskResult }>(CREATE, { input });
    assert.equal(errors, undefined, JSON.stringify(errors));
    return data!.createTask;
};

const errorCode = (errors: readonly { extensions?: Record<string, unknown> }[] | undefined) =>
    errors?.[0]?.extensions?.code;

before(async () => {
    await apollo.start();
});

after(async () => {
    await apollo.stop();
    await prisma.$disconnect();
});

describe("createTask", () => {
    it("creates a task with valid input and applies defaults", async () => {
        await withUser(async (execute) => {
            const task = await createTask(execute, {
                title: "  Learn GraphQL  ",
                description: "Build a task management API",
                priority: "HIGH",
                dueDate: "2026-11-01T12:00:00.000Z",
            });
            assert.match(task.id, /^\d+$/);
            assert.equal(task.title, "Learn GraphQL", "title is trimmed");
            assert.equal(task.description, "Build a task management API");
            assert.equal(task.priority, "HIGH");
            assert.equal(task.completed, false);
            assert.equal(task.dueDate, "2026-11-01T12:00:00.000Z");
            assert.ok(!Number.isNaN(Date.parse(task.createdAt)));

            const minimal = await createTask(execute, { title: "Minimal" });
            assert.equal(minimal.priority, "MEDIUM");
            assert.equal(minimal.completed, false);
            assert.equal(minimal.description, null);
            assert.equal(minimal.dueDate, null);
        });
    });

    it("rejects an empty or whitespace-only title", async () => {
        await withUser(async (execute) => {
            for (const title of ["", "    "]) {
                const { data, errors } = await execute(CREATE, { input: { title } });
                assert.equal(data, null);
                assert.equal(errorCode(errors), "BAD_USER_INPUT");
                assert.match(errors![0]!.message, /title/i);
            }
        });
    });

    it("rejects an invalid due date", async () => {
        await withUser(async (execute) => {
            for (const dueDate of ["not-a-date", "2026-02-31", "2026-13-01"]) {
                const { errors } = await execute(CREATE, { input: { title: "Bad date", dueDate } });
                assert.equal(errorCode(errors), "BAD_USER_INPUT", dueDate);
                assert.match(errors![0]!.message, /dueDate/);
            }
        });
    });

    it("rejects an invalid priority", async () => {
        await withUser(async (execute) => {
            const { errors } = await execute(CREATE, { input: { title: "Bad priority", priority: "URGENT" } });
            assert.equal(errorCode(errors), "BAD_USER_INPUT");
        });
    });
});

describe("tasks query", () => {
    it("retrieves all tasks, newest first", async () => {
        await withUser(async (execute) => {
            const tag = uniqueTag();
            const first = await createTask(execute, { title: `${tag} first` });
            const second = await createTask(execute, { title: `${tag} second` });

            const { data, errors } = await execute<{ tasks: TaskResult[] }>(`{ tasks { ${TASK_FIELDS} } }`);
            assert.equal(errors, undefined);
            const ids = data!.tasks.map((t) => t.id);
            assert.ok(ids.includes(first.id) && ids.includes(second.id));
            assert.ok(ids.indexOf(second.id) < ids.indexOf(first.id), "newer task comes first");

            const dates = data!.tasks.map((t) => Date.parse(t.createdAt));
            assert.deepEqual(dates, [...dates].sort((a, b) => b - a), "sorted by createdAt desc");
        });
    });

    it("filters by completion status, priority and both combined", async () => {
        await withUser(async (execute) => {
            const tag = uniqueTag();
            const highOpen = await createTask(execute, { title: `${tag} high open`, priority: "HIGH" });
            const highDone = await createTask(execute, { title: `${tag} high done`, priority: "HIGH", completed: true });
            const lowOpen = await createTask(execute, { title: `${tag} low open`, priority: "LOW" });

            const query = `query ($filter: TaskFilterInput) { tasks(filter: $filter) { id completed priority } }`;
            const run = async (filter: Record<string, unknown>) => {
                const { data, errors } = await execute<{ tasks: TaskResult[] }>(query, { filter });
                assert.equal(errors, undefined);
                return data!.tasks;
            };

            const completed = await run({ completed: true });
            assert.ok(completed.every((t) => t.completed));
            assert.ok(completed.some((t) => t.id === highDone.id));
            assert.ok(!completed.some((t) => t.id === highOpen.id));

            const high = await run({ priority: "HIGH" });
            assert.ok(high.every((t) => t.priority === "HIGH"));
            assert.ok(high.some((t) => t.id === highOpen.id) && high.some((t) => t.id === highDone.id));
            assert.ok(!high.some((t) => t.id === lowOpen.id));

            const highPending = await run({ completed: false, priority: "HIGH" });
            assert.ok(highPending.every((t) => t.priority === "HIGH" && !t.completed));
            assert.ok(highPending.some((t) => t.id === highOpen.id));
            assert.ok(!highPending.some((t) => t.id === highDone.id || t.id === lowOpen.id));
        });
    });
});

describe("task query", () => {
    it("retrieves an existing task by id", async () => {
        await withUser(async (execute) => {
            const created = await createTask(execute, { title: "Find me" });
            const { data, errors } = await execute<{ task: TaskResult }>(
                `query ($id: ID!) { task(id: $id) { ${TASK_FIELDS} } }`,
                { id: created.id },
            );
            assert.equal(errors, undefined);
            assert.deepEqual(data!.task, created);
        });
    });

    it("returns NOT_FOUND for a nonexistent task and BAD_USER_INPUT for a malformed id", async () => {
        await withUser(async (execute) => {
            const query = `query ($id: ID!) { task(id: $id) { id } }`;
            const missing = await execute(query, { id: "2147483647" });
            assert.equal(errorCode(missing.errors), "NOT_FOUND");

            for (const id of ["abc", "-1", "0", "1.5", "99999999999"]) {
                const bad = await execute(query, { id });
                assert.equal(errorCode(bad.errors), "BAD_USER_INPUT", id);
            }
        });
    });
});

describe("updateTask", () => {
    const UPDATE = `mutation ($id: ID!, $input: UpdateTaskInput!) { updateTask(id: $id, input: $input) { ${TASK_FIELDS} } }`;

    it("updates only the supplied fields and preserves the rest", async () => {
        await withUser(async (execute) => {
            const created = await createTask(execute, {
                title: "Original",
                description: "Keep me",
                priority: "LOW",
                dueDate: "2026-12-01T00:00:00.000Z",
            });

            const { data, errors } = await execute<{ updateTask: TaskResult }>(UPDATE, {
                id: created.id,
                input: { title: "Finish GraphQL project", priority: "MEDIUM" },
            });
            assert.equal(errors, undefined);
            const updated = data!.updateTask;
            assert.equal(updated.title, "Finish GraphQL project");
            assert.equal(updated.priority, "MEDIUM");
            assert.equal(updated.description, "Keep me");
            assert.equal(updated.dueDate, "2026-12-01T00:00:00.000Z");
            assert.equal(updated.completed, false);
        });
    });

    it("treats explicit null as 'clear' for optional fields", async () => {
        await withUser(async (execute) => {
            const created = await createTask(execute, {
                title: "Clear me",
                description: "Temporary",
                dueDate: "2026-12-01",
            });
            const { data, errors } = await execute<{ updateTask: TaskResult }>(UPDATE, {
                id: created.id,
                input: { description: null, dueDate: null },
            });
            assert.equal(errors, undefined);
            assert.equal(data!.updateTask.description, null);
            assert.equal(data!.updateTask.dueDate, null);
            assert.equal(data!.updateTask.title, "Clear me");
        });
    });

    it("rejects invalid values, null required fields and empty input", async () => {
        await withUser(async (execute) => {
            const created = await createTask(execute, { title: "Validate me" });
            const cases: Record<string, unknown>[] = [
                { title: "   " },
                { title: null },
                { priority: null },
                { completed: null },
                { dueDate: "yesterday" },
                {},
            ];
            for (const input of cases) {
                const { errors } = await execute(UPDATE, { id: created.id, input });
                assert.equal(errorCode(errors), "BAD_USER_INPUT", JSON.stringify(input));
            }
        });
    });

    it("returns NOT_FOUND when the task does not exist", async () => {
        await withUser(async (execute) => {
            const { errors } = await execute(UPDATE, { id: "2147483647", input: { title: "Nope" } });
            assert.equal(errorCode(errors), "NOT_FOUND");
        });
    });
});

describe("deleteTask", () => {
    const DELETE = `mutation ($id: ID!) { deleteTask(id: $id) { success message id } }`;

    it("deletes an existing task", async () => {
        await withUser(async (execute) => {
            const created = await createTask(execute, { title: "Delete me" });
            const { data, errors } = await execute<{ deleteTask: { success: boolean; message: string; id: string } }>(
                DELETE,
                { id: created.id },
            );
            assert.equal(errors, undefined);
            assert.equal(data!.deleteTask.success, true);
            assert.equal(data!.deleteTask.id, created.id);
            assert.match(data!.deleteTask.message, /deleted/);

            const lookup = await execute(`query ($id: ID!) { task(id: $id) { id } }`, { id: created.id });
            assert.equal(errorCode(lookup.errors), "NOT_FOUND");
        });
    });

    it("returns NOT_FOUND when the task does not exist", async () => {
        await withUser(async (execute) => {
            const { data, errors } = await execute(DELETE, { id: "2147483647" });
            assert.equal(data, null);
            assert.equal(errorCode(errors), "NOT_FOUND");
        });
    });
});

describe("completeTask", () => {
    it("marks a task as completed", async () => {
        await withUser(async (execute) => {
            const created = await createTask(execute, { title: "Complete me" });
            const { data, errors } = await execute<{ completeTask: TaskResult }>(
                `mutation ($id: ID!) { completeTask(id: $id) { ${TASK_FIELDS} } }`,
                { id: created.id },
            );
            assert.equal(errors, undefined);
            assert.equal(data!.completeTask.completed, true);
            assert.equal(data!.completeTask.title, "Complete me");
        });
    });

    it("returns NOT_FOUND when the task does not exist", async () => {
        await withUser(async (execute) => {
            const { errors } = await execute(`mutation { completeTask(id: "2147483647") { id } }`);
            assert.equal(errorCode(errors), "NOT_FOUND");
        });
    });
});

describe("searchTasks", () => {
    const SEARCH = `query ($search: String!) { searchTasks(search: $search) { id title } }`;

    it("matches partial titles case-insensitively", async () => {
        await withUser(async (execute) => {
            const tag = uniqueTag();
            const match = await createTask(execute, { title: `Learn ${tag} GraphQL` });
            const other = await createTask(execute, { title: "Unrelated task" });

            const { data, errors } = await execute<{ searchTasks: TaskResult[] }>(SEARCH, {
                search: tag.toUpperCase().slice(0, 14),
            });
            assert.equal(errors, undefined);
            const ids = data!.searchTasks.map((t) => t.id);
            assert.ok(ids.includes(match.id));
            assert.ok(!ids.includes(other.id));
        });
    });

    it("handles an empty search string safely", async () => {
        await withUser(async (execute) => {
            const created = await createTask(execute, { title: "Anything" });
            for (const search of ["", "   "]) {
                const { data, errors } = await execute<{ searchTasks: TaskResult[] }>(SEARCH, { search });
                assert.equal(errors, undefined);
                assert.ok(data!.searchTasks.some((t) => t.id === created.id));
            }
        });
    });

    it("treats SQL wildcard characters literally", async () => {
        await withUser(async (execute) => {
            const tag = uniqueTag();
            await createTask(execute, { title: `${tag} plain` });
            const { data } = await execute<{ searchTasks: TaskResult[] }>(SEARCH, { search: `${tag}%` });
            assert.equal(data!.searchTasks.length, 0);
        });
    });
});

describe("taskStatistics", () => {
    type Stats = {
        totalTasks: number;
        completedTasks: number;
        pendingTasks: number;
        tasksByPriority: { priority: string; count: number }[];
    };
    const STATS = `{ taskStatistics { totalTasks completedTasks pendingTasks tasksByPriority { priority count } } }`;
    const countFor = (stats: Stats, priority: string) =>
        stats.tasksByPriority.find((p) => p.priority === priority)?.count ?? -1;

    it("returns accurate statistics calculated from the database", async () => {
        await withUser(async (execute) => {
            const before = (await execute<{ taskStatistics: Stats }>(STATS)).data!.taskStatistics;
            assert.equal(before.pendingTasks, before.totalTasks - before.completedTasks);
            assert.deepEqual(
                before.tasksByPriority.map((p) => p.priority),
                ["LOW", "MEDIUM", "HIGH"],
            );

            await createTask(execute, { title: "s1", priority: "HIGH" });
            await createTask(execute, { title: "s2", priority: "HIGH", completed: true });
            await createTask(execute, { title: "s3", priority: "LOW" });
            await createTask(execute, { title: "s4" });

            const { data, errors } = await execute<{ taskStatistics: Stats }>(STATS);
            assert.equal(errors, undefined);
            const now = data!.taskStatistics;
            assert.equal(now.totalTasks, before.totalTasks + 4);
            assert.equal(now.completedTasks, before.completedTasks + 1);
            assert.equal(now.pendingTasks, before.pendingTasks + 3);
            assert.equal(countFor(now, "HIGH"), countFor(before, "HIGH") + 2);
            assert.equal(countFor(now, "LOW"), countFor(before, "LOW") + 1);
            assert.equal(countFor(now, "MEDIUM"), countFor(before, "MEDIUM") + 1);
            assert.equal(
                now.tasksByPriority.reduce((sum, p) => sum + p.count, 0),
                now.totalTasks,
            );
        });
    });
});
