import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { HeaderMap, type ApolloServer } from "@apollo/server";
import type { GraphQLContext } from "./graphql/context.js";

export const GRAPHQL_PATH = "/graphql";
const MAX_BODY_BYTES = 1024 * 1024;

class HttpError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
    }
}

const readBody = (req: IncomingMessage): Promise<string> =>
    new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        req.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(new HttpError(413, "Request body too large."));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        req.on("error", reject);
    });

const parseBody = (raw: string, contentType: string | undefined): unknown => {
    if (raw === "") return undefined;
    if (!contentType?.toLowerCase().includes("application/json")) return raw;
    try {
        return JSON.parse(raw);
    } catch {
        throw new HttpError(400, "Request body is not valid JSON.");
    }
};

const sendJson = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
};

const applyCors = (req: IncomingMessage, res: ServerResponse, allowedOrigin: string | undefined) => {
    const origin = allowedOrigin ?? "*";
    res.setHeader("access-control-allow-origin", origin);
    if (origin !== "*") res.setHeader("vary", "origin");
    if (req.method === "OPTIONS") {
        res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
        res.setHeader(
            "access-control-allow-headers",
            req.headers["access-control-request-headers"] ?? "content-type, authorization, apollo-require-preflight",
        );
        res.setHeader("access-control-max-age", "86400");
    }
};


export const createGraphQLRequestHandler =
    (
        apollo: ApolloServer<GraphQLContext>,
        createContext: (authorization: string | undefined) => Promise<GraphQLContext>,
        options: { corsOrigin?: string | undefined } = {},
    ): RequestListener =>
        async (req, res) => {
            try {
                const url = new URL(req.url ?? "/", "http://localhost");

                if (url.pathname === "/health") {
                    sendJson(res, 200, { status: "ok" });
                    return;
                }
                if (url.pathname !== GRAPHQL_PATH && url.pathname !== `${GRAPHQL_PATH}/`) {
                    sendJson(res, 404, { error: `Not found. The GraphQL endpoint is ${GRAPHQL_PATH}.` });
                    return;
                }

                applyCors(req, res, options.corsOrigin);
                if (req.method === "OPTIONS") {
                    res.statusCode = 204;
                    res.end();
                    return;
                }

                const headers = new HeaderMap();
                for (const [key, value] of Object.entries(req.headers)) {
                    if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
                }

                const raw = req.method === "POST" ? await readBody(req) : "";
                const response = await apollo.executeHTTPGraphQLRequest({
                    httpGraphQLRequest: {
                        method: (req.method ?? "GET").toUpperCase(),
                        headers,
                        search: url.search,
                        body: parseBody(raw, req.headers["content-type"]),
                    },
                    context: () => createContext(req.headers.authorization),
                });

                for (const [key, value] of response.headers) res.setHeader(key, value);
                res.statusCode = response.status ?? 200;

                if (response.body.kind === "complete") {
                    res.end(response.body.string);
                    return;
                }
                for await (const chunk of response.body.asyncIterator) res.write(chunk);
                res.end();
            } catch (error) {
                if (error instanceof HttpError) {
                    sendJson(res, error.status, { error: error.message });
                    return;
                }
                console.error("[http] Unhandled request error:", error instanceof Error ? error.message : error);
                if (!res.headersSent) sendJson(res, 500, { error: "Internal server error." });
                else res.end();
            }
        };
