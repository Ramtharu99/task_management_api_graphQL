import type { CreateTaskInput, Task, TaskFilterInput, UpdateTaskInput } from "../models/task.model.js";
import type { LoginInput, RegisterInput } from "../models/user.model.js";
import { requireUser, type GraphQLContext } from "./context.js";

type IdArgs = { id: string };

const toIso = (date: Date): string => date.toISOString();

export const resolvers = {
    Query: {
        me: (_: unknown, __: unknown, ctx: GraphQLContext) => ctx.authService.getUserById(requireUser(ctx)),

        tasks: (_: unknown, { filter }: { filter?: TaskFilterInput | null }, ctx: GraphQLContext) =>
            ctx.taskService.getAllTasks(requireUser(ctx), filter),

        task: (_: unknown, { id }: IdArgs, ctx: GraphQLContext) => ctx.taskService.getTaskById(requireUser(ctx), id),

        searchTasks: (_: unknown, { search }: { search: string }, ctx: GraphQLContext) =>
            ctx.taskService.searchTasks(requireUser(ctx), search),

        taskStatistics: (_: unknown, __: unknown, ctx: GraphQLContext) =>
            ctx.taskService.getTaskStatistics(requireUser(ctx)),
    },

    Mutation: {
        register: (_: unknown, { input }: { input: RegisterInput }, ctx: GraphQLContext) =>
            ctx.authService.register(input),

        login: (_: unknown, { input }: { input: LoginInput }, ctx: GraphQLContext) => ctx.authService.login(input),

        createTask: (_: unknown, { input }: { input: CreateTaskInput }, ctx: GraphQLContext) =>
            ctx.taskService.createTask(requireUser(ctx), input),

        updateTask: (_: unknown, { id, input }: IdArgs & { input: UpdateTaskInput }, ctx: GraphQLContext) =>
            ctx.taskService.updateTask(requireUser(ctx), id, input),

        deleteTask: (_: unknown, { id }: IdArgs, ctx: GraphQLContext) =>
            ctx.taskService.deleteTask(requireUser(ctx), id),

        completeTask: (_: unknown, { id }: IdArgs, ctx: GraphQLContext) =>
            ctx.taskService.completeTask(requireUser(ctx), id),
    },

    Task: {
        dueDate: (task: Task) => (task.dueDate ? toIso(task.dueDate) : null),
        createdAt: (task: Task) => toIso(task.createdAt),
        updatedAt: (task: Task) => toIso(task.updatedAt),
    },

    User: {
        createdAt: (user: { createdAt: Date }) => toIso(user.createdAt),
    },
};
