import { badUserInput } from "./errors.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export const validateDate = (value: string | null | undefined, field = "dueDate"): Date | null | undefined => {
    if (value === undefined) return undefined;
    if (value === null) return null;

    const trimmed = value.trim();
    if (trimmed === "") return null;

    const parsed = new Date(trimmed);
    if (!ISO_DATE.test(trimmed) || Number.isNaN(parsed.getTime())) {
        throw badUserInput(
            `Invalid ${field} "${value}". Use an ISO 8601 date such as "2026-11-01" or "2026-11-01T12:00:00.000Z".`,
            field,
        );
    }

    const [year, month, day] = trimmed.slice(0, 10).split("-").map(Number);
    const calendarCheck = new Date(Date.UTC(year!, month! - 1, day!));
    if (calendarCheck.getUTCMonth() !== month! - 1 || calendarCheck.getUTCDate() !== day!) {
        throw badUserInput(`Invalid ${field} "${value}". The date does not exist.`, field);
    }

    return parsed;
};
