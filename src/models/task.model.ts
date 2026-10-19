import type { Priority } from "../generated/prisma/enums.js";

export type { Task } from "../generated/prisma/client.js";
export type { Priority };


export interface CreateTaskInput {
    title: string;
    description?: string | null;
    priority?: Priority | null;
    dueDate?: string | null;
    completed?: boolean | null;
}

export interface UpdateTaskInput {
    title?: string | null;
    description?: string | null;
    completed?: boolean | null;
    priority?: Priority | null;
    dueDate?: string | null;
}

export interface TaskFilterInput {
    completed?: boolean | null;
    priority?: Priority | null;
}

export interface PriorityCount {
    priority: Priority;
    count: number;
}

export interface TaskStatistics {
    totalTasks: number;
    completedTasks: number;
    pendingTasks: number;
    tasksByPriority: PriorityCount[];
}

export interface DeleteTaskResponse {
    success: boolean;
    message: string;
    id: number;
}
