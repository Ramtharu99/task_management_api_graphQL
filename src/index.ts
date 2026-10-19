import http from "node:http";
import { ApolloServerPluginDrainHttpServer } from "@apollo/server/plugin/drainHttpServer";
import { env } from "./config/env.js";
import { prisma } from "./config/prisma.js";
import { createContext } from "./graphql/context.js";
import { createApolloServer } from "./graphql/server.js";
import { GRAPHQL_PATH, createGraphQLRequestHandler } from "./httpServer.js";

const main = async () => {
    await prisma.$connect();
    console.log("[startup] Connected to the database.");

    const httpServer = http.createServer();
    const apollo = createApolloServer([ApolloServerPluginDrainHttpServer({ httpServer })]);
    await apollo.start();

    httpServer.on("request", createGraphQLRequestHandler(apollo, createContext, { corsOrigin: env.corsOrigin }));
    await new Promise<void>((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(env.port, resolve);
    });

    console.log(`🚀 GraphQL API ready at http://localhost:${env.port}${GRAPHQL_PATH} (${env.nodeEnv})`);
    if (!env.isProduction) console.log("   Open that URL in a browser to use Apollo Sandbox.");

    let shuttingDown = false;
    const shutdown = async (signal: string) => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`[shutdown] Received ${signal}, closing gracefully...`);
        try {
            await apollo.stop();
            await prisma.$disconnect();
            console.log("[shutdown] Done.");
            process.exit(0);
        } catch (error) {
            console.error("[shutdown] Error during shutdown:", error instanceof Error ? error.message : error);
            process.exit(1);
        }
    };

    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
};

main().catch(async (error: unknown) => {
    console.error("[startup] Failed to start the server:", error instanceof Error ? error.message : error);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(1);
});
