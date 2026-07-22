import { z } from "zod";

export const cardCopySchema = z.object({
  insightId: z.string(),
  title: z.string().max(60),
  body: z.string().max(280),
});

export const wrappedCopySchema = z.object({
  cards: z.array(cardCopySchema),
  archetype: z.object({
    title: z.string().max(60),
    body: z.string().max(280),
  }),
});

export type CardCopy = z.infer<typeof cardCopySchema>;
export type WrappedCopy = z.infer<typeof wrappedCopySchema>;
