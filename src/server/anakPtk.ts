import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware, requireContext } from "./auth";
import { createAdminClient } from "./supabase";
import { loadAnakPtkData } from "./anakPtkData";

const selectionSchema = z.object({
  tahunAjaranId: z.string().uuid().optional(),
  tahunBukuId: z.string().uuid().optional(),
  jenisId: z.string().uuid().optional(),
});

export const getAnakPtkData = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => selectionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = requireContext(context);
    return loadAnakPtkData(createAdminClient(), userId, data);
  });
