import { z } from "zod";

/** Request body for POST /api/entries */
export const createEntryBodySchema = z.object({
  content: z.string().trim().min(1).max(500),
});

/** Query param for GET /api/entries */
export const entryDateQuerySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

/** Path param for DELETE /api/entries/{id} */
export const entryIdPathSchema = z.object({ id: z.coerce.number().int().positive() });

/** DTO shape returned by the API */
export const entrySchema = z.object({
  id: z.number().int(),
  content: z.string(),
  entryDate: z.string().date(),
  createdAt: z.string().datetime(),
});

/** Response for GET /api/me */
export const meSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
  today: z.object({
    date: z.string().date(),
    count: z.number().int(),
    complete: z.boolean(),
  }),
});