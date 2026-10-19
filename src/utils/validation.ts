import { Priority } from "../generated/prisma/enums.js";
import { badUserInput } from "./errors.js";

export const TITLE_MAX_LENGTH = 255;
export const DESCRIPTION_MAX_LENGTH = 5000;
export const SEARCH_MAX_LENGTH = 255;

const MAX_INT_ID = 2_147_483_647;

export const parseTaskId = (id: string | number): number => {
    const raw = String(id).trim();
    const parsed = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;

    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_INT_ID) {
        throw badUserInput(`Invalid task id "${String(id)}". Expected a positive integer.`, "id");
    }
    return parsed;
};

export const validateTitle = (title: string | null | undefined): string => {
    if (title === null || title === undefined) {
        throw badUserInput("Title is required.", "title");
    }
    const trimmed = title.trim();
    if (trimmed === "") {
        throw badUserInput("Title must not be empty.", "title");
    }
    if (trimmed.length > TITLE_MAX_LENGTH) {
        throw badUserInput(`Title must be at most ${TITLE_MAX_LENGTH} characters.`, "title");
    }
    return trimmed;
};

export const validateDescription = (description: string | null | undefined): string | null | undefined => {
    if (description === undefined) return undefined;
    if (description === null) return null;

    const trimmed = description.trim();
    if (trimmed.length > DESCRIPTION_MAX_LENGTH) {
        throw badUserInput(`Description must be at most ${DESCRIPTION_MAX_LENGTH} characters.`, "description");
    }
    return trimmed === "" ? null : trimmed;
};

const PRIORITIES = Object.values(Priority) as string[];

export const isPriority = (value: unknown): value is Priority =>
    typeof value === "string" && PRIORITIES.includes(value);

export const validatePriority = (priority: unknown): Priority => {
    if (!isPriority(priority)) {
        throw badUserInput(`Invalid priority "${String(priority)}". Expected one of: ${PRIORITIES.join(", ")}.`, "priority");
    }
    return priority;
};

export const validateBoolean = (value: unknown, field: string): boolean => {
    if (typeof value !== "boolean") {
        throw badUserInput(`${field} must be true or false.`, field);
    }
    return value;
};

export const NAME_MAX_LENGTH = 100;
export const EMAIL_MAX_LENGTH = 254;
export const PASSWORD_MIN_LENGTH = 8;
// bcrypt only uses the first 72 bytes of a password.
export const PASSWORD_MAX_BYTES = 72;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const validateName = (name: string | null | undefined): string => {
    const trimmed = (name ?? "").trim();
    if (trimmed === "") throw badUserInput("Name must not be empty.", "name");
    if (trimmed.length > NAME_MAX_LENGTH) {
        throw badUserInput(`Name must be at most ${NAME_MAX_LENGTH} characters.`, "name");
    }
    return trimmed;
};

/** Trims and lower-cases an email so lookups are case-insensitive. */
export const validateEmail = (email: string | null | undefined): string => {
    const normalised = (email ?? "").trim().toLowerCase();
    if (normalised.length > EMAIL_MAX_LENGTH || !EMAIL.test(normalised)) {
        throw badUserInput("Enter a valid email address.", "email");
    }
    return normalised;
};

export const validatePassword = (password: string | null | undefined): string => {
    const value = password ?? "";
    if (value.length < PASSWORD_MIN_LENGTH) {
        throw badUserInput(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`, "password");
    }
    if (Buffer.byteLength(value, "utf8") > PASSWORD_MAX_BYTES) {
        throw badUserInput(`Password must be at most ${PASSWORD_MAX_BYTES} bytes.`, "password");
    }
    return value;
};
