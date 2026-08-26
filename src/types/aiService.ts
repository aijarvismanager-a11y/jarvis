import { z } from "zod";

export const AiService = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().nullable(),
});
export type AiService = z.infer<typeof AiService>;

export const AiServiceList = z.array(AiService);
export type AiServiceList = z.infer<typeof AiServiceList>;
