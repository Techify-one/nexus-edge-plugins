import { z } from "zod";

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z
    .string()
    .trim()
    .max(200)
    .transform((value) => value || undefined)
    .optional(),
});

export const leadCreateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.email().optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional(),
  company: z.string().trim().max(160).optional(),
  status: z.enum(["new", "qualified", "won", "lost"]).default("new"),
  notes: z.string().trim().max(5000).optional(),
});

export const leadUpdateSchema = leadCreateSchema.partial().extend({
  version: z.number().int().positive(),
});
