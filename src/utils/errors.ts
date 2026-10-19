import { GraphQLError } from "graphql";
import { Prisma } from "../generated/prisma/client.js";

export const ErrorCode = {
    BAD_USER_INPUT: "BAD_USER_INPUT",
    NOT_FOUND: "NOT_FOUND",
    UNAUTHENTICATED: "UNAUTHENTICATED",
    INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const badUserInput = (message: string, field?: string): GraphQLError =>
    new GraphQLError(message, {
        extensions: { code: ErrorCode.BAD_USER_INPUT, ...(field ? { field } : {}) },
    });

export const notFound = (message: string): GraphQLError =>
    new GraphQLError(message, { extensions: { code: ErrorCode.NOT_FOUND } });

export const unauthenticated = (message = "You must be logged in. Send an Authorization: Bearer <token> header."): GraphQLError =>
    new GraphQLError(message, { extensions: { code: ErrorCode.UNAUTHENTICATED } });

export const internalError = (message = "An unexpected error occurred."): GraphQLError =>
    new GraphQLError(message, { extensions: { code: ErrorCode.INTERNAL_SERVER_ERROR } });

export const taskNotFound = (id: number): GraphQLError => notFound(`Task with id ${id} was not found.`);


export const toGraphQLError = (error: unknown, context: { taskId?: number } = {}): GraphQLError => {
    if (error instanceof GraphQLError) return error;

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        switch (error.code) {
            case "P2025":
                return context.taskId !== undefined ? taskNotFound(context.taskId) : notFound("Record not found.");
            case "P2000":
                return badUserInput("One of the provided values is too long.");
            case "P2007":
                return badUserInput("One of the provided values is invalid.");
            case "P2003": // Foreign key violation: the task's owner no longer exists
                return unauthenticated("Your account no longer exists. Please register or log in again.");
        }
    }

    console.error("[database] Unexpected error:", error instanceof Error ? `${error.name}: ${error.message}` : error);
    return internalError();
};
