import { authService, type AuthService } from "../services/auth.service.js";
import { taskService, type TaskService } from "../services/task.service.js";
import { unauthenticated } from "../utils/errors.js";
import { verifyToken } from "../utils/jwt.js";

export interface GraphQLContext {
    /** Id of the logged-in user, or null for anonymous requests. */
    userId: number | null;
    /** Why a supplied token was rejected, if it was. */
    authError?: string;
    taskService: TaskService;
    authService: AuthService;
}

/** Builds the context from the request's `Authorization: Bearer <token>` header. */
export const createContext = async (authorization: string | undefined): Promise<GraphQLContext> => {
    const base = { taskService, authService };
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    if (!match) return { ...base, userId: null };

    const result = verifyToken(match[1]!.trim());
    return "userId" in result ? { ...base, userId: result.userId } : { ...base, userId: null, authError: result.error };
};

/** Returns the logged-in user's id or throws UNAUTHENTICATED. */
export const requireUser = (context: GraphQLContext): number => {
    if (context.userId === null) throw unauthenticated(context.authError);
    return context.userId;
};
