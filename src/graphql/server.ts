import { ApolloServer, type ApolloServerPlugin } from "@apollo/server";
import { unwrapResolverError } from "@apollo/server/errors";
import { GraphQLError, type GraphQLFormattedError } from "graphql";
import { ErrorCode } from "../utils/errors.js";
import type { GraphQLContext } from "./context.js";
import { resolvers } from "./resolvers.js";
import { typeDefs } from "./typeDefs.js";

const isProduction = process.env.NODE_ENV === "production";


export const formatError = (formatted: GraphQLFormattedError, error: unknown): GraphQLFormattedError => {
    const original = unwrapResolverError(error);
    const isExpected = original instanceof GraphQLError || formatted.extensions?.code !== ErrorCode.INTERNAL_SERVER_ERROR;

    if (!isExpected) {
        console.error("[graphql] Unexpected error:", original instanceof Error ? original.message : original);
        return {
            message: "An unexpected error occurred.",
            extensions: { code: ErrorCode.INTERNAL_SERVER_ERROR },
            ...(formatted.path ? { path: formatted.path } : {}),
            ...(formatted.locations ? { locations: formatted.locations } : {}),
        };
    }
    return formatted;
};

export const createApolloServer = (plugins: ApolloServerPlugin<GraphQLContext>[] = []) =>
    new ApolloServer<GraphQLContext>({
        typeDefs,
        resolvers,
        formatError,
        plugins,
        introspection: !isProduction,
        includeStacktraceInErrorResponses: !isProduction && process.env.NODE_ENV !== "test",
        stopOnTerminationSignals: false,
    });
