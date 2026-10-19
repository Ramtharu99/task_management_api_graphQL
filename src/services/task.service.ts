import { prisma } from "../config/prisma.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { Priority } from "../generated/prisma/enums.js";
import type {
    CreateTaskInput,
    DeleteTaskResponse,
    Task,
    TaskFilterInput,
    TaskStatistics,
    UpdateTaskInput,
} from "../models/task.model.js";
import { badUserInput, taskNotFound, toGraphQLError } from "../utils/errors.js";
import { validateDate } from "../utils/validateDate.js";
import {
    SEARCH_MAX_LENGTH,
    parseTaskId,
    validateBoolean,
    validateDescription,
    validatePriority,
    validateTitle,
} from "../utils/validation.js";

export type DatabaseClient = PrismaClient | Prisma.TransactionClient;

const DEFAULT_ORDER: Prisma.TaskOrderByWithRelationInput[] = [{ createdAt: "desc" }, { id: "desc" }];

const run = async <T>(operation: () => Promise<T>, context: { taskId?: number } = {}): Promise<T> => {
    try {
        return await operation();
    } catch (error) {
        throw toGraphQLError(error, context);
    }
};

const buildFilter = (userId: number, filter: TaskFilterInput | null | undefined): Prisma.TaskWhereInput => {
    const where: Prisma.TaskWhereInput = { userId };
    if (filter?.completed != null) where.completed = validateBoolean(filter.completed, "completed");
    if (filter?.priority != null) where.priority = validatePriority(filter.priority);
    return where;
};

const buildCreateData = (userId: number, input: CreateTaskInput): Prisma.TaskUncheckedCreateInput => {
    if (input == null) throw badUserInput("Task input is required.");

    const data: Prisma.TaskUncheckedCreateInput = { title: validateTitle(input.title), userId };

    const description = validateDescription(input.description);
    if (description !== undefined) data.description = description;

    if (input.priority != null) data.priority = validatePriority(input.priority);
    if (input.completed != null) data.completed = validateBoolean(input.completed, "completed");

    const dueDate = validateDate(input.dueDate);
    if (dueDate !== undefined) data.dueDate = dueDate;

    return data;
};

const buildUpdateData = (input: UpdateTaskInput): Prisma.TaskUpdateInput => {
    if (input == null) throw badUserInput("Update input is required.");

    const data: Prisma.TaskUpdateInput = {};

    if (input.title !== undefined) data.title = validateTitle(input.title);

    const description = validateDescription(input.description);
    if (description !== undefined) data.description = description;

    if (input.priority !== undefined) {
        if (input.priority === null) throw badUserInput("Priority cannot be null.", "priority");
        data.priority = validatePriority(input.priority);
    }

    if (input.completed !== undefined) {
        if (input.completed === null) throw badUserInput("Completed cannot be null.", "completed");
        data.completed = validateBoolean(input.completed, "completed");
    }

    const dueDate = validateDate(input.dueDate);
    if (dueDate !== undefined) data.dueDate = dueDate;

    if (Object.keys(data).length === 0) {
        throw badUserInput("Provide at least one field to update.");
    }
    return data;
};

export const createTaskService = (db: DatabaseClient) => ({
    async getAllTasks(userId: number, filter?: TaskFilterInput | null): Promise<Task[]> {
        const where = buildFilter(userId, filter);
        return run(() => db.task.findMany({ where, orderBy: DEFAULT_ORDER }));
    },

    async getTaskById(userId: number, id: string | number): Promise<Task> {
        const taskId = parseTaskId(id);
        const task = await run(() => db.task.findFirst({ where: { id: taskId, userId } }));
        if (!task) throw taskNotFound(taskId);
        return task;
    },

    async createTask(userId: number, input: CreateTaskInput): Promise<Task> {
        const data = buildCreateData(userId, input);
        return run(() => db.task.create({ data }));
    },

    async updateTask(userId: number, id: string | number, input: UpdateTaskInput): Promise<Task> {
        const taskId = parseTaskId(id);
        const data = buildUpdateData(input);
        return run(() => db.task.update({ where: { id: taskId, userId }, data }), { taskId });
    },

    async deleteTask(userId: number, id: string | number): Promise<DeleteTaskResponse> {
        const taskId = parseTaskId(id);
        const deleted = await run(() => db.task.delete({ where: { id: taskId, userId } }), { taskId });
        return {
            success: true,
            message: `Task "${deleted.title}" (id ${deleted.id}) was deleted successfully.`,
            id: deleted.id,
        };
    },

    async completeTask(userId: number, id: string | number): Promise<Task> {
        const taskId = parseTaskId(id);
        return run(() => db.task.update({ where: { id: taskId, userId }, data: { completed: true } }), { taskId });
    },

    async searchTasks(userId: number, search: string | null | undefined): Promise<Task[]> {
        const term = (search ?? "").trim();
        if (term.length > SEARCH_MAX_LENGTH) {
            throw badUserInput(`Search term must be at most ${SEARCH_MAX_LENGTH} characters.`, "search");
        }
        const pattern = term.replace(/[\\%_]/g, "\\$&");
        const where: Prisma.TaskWhereInput =
            term === "" ? { userId } : { userId, title: { contains: pattern, mode: "insensitive" } };
        return run(() => db.task.findMany({ where, orderBy: DEFAULT_ORDER }));
    },

    async getTaskStatistics(userId: number): Promise<TaskStatistics> {
        const [totalTasks, completedTasks, grouped] = await run(() =>
            Promise.all([
                db.task.count({ where: { userId } }),
                db.task.count({ where: { userId, completed: true } }),
                db.task.groupBy({ by: ["priority"], where: { userId }, _count: { _all: true } }),
            ]),
        );

        const tasksByPriority = Object.values(Priority).map((priority) => ({
            priority,
            count: grouped.find((group) => group.priority === priority)?._count._all ?? 0,
        }));

        return {
            totalTasks,
            completedTasks,
            pendingTasks: totalTasks - completedTasks,
            tasksByPriority,
        };
    },
});

export type TaskService = ReturnType<typeof createTaskService>;

export const taskService: TaskService = createTaskService(prisma);
