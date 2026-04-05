import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler";
import { ensureAuthenticated, ensurePermission } from "../middleware/auth";
import { StoreService } from "../services/store";
import { RADIOLOGY_TEMPLATES, sectionsToHtml } from "../data/radiologyTemplates";

const createTemplateSchema = z.object({
  name: z.string().min(2),
  content: z.string().min(1),
  category: z.string().optional(),
  modality: z.string().optional(),
  bodyPart: z.string().optional(),
  sections: z
    .array(z.object({ key: z.string(), title: z.string(), content: z.string() }))
    .optional(),
});

export function templatesRouter(store: StoreService): Router {
  const router = Router();

  router.post("/", ensureAuthenticated, ensurePermission(store, "templates:create"), asyncHandler(async (req, res) => {
    const body = createTemplateSchema.parse(req.body);
    const ownerId = req.session.user!.id;
    const template = await store.createTemplate({
      name: body.name,
      content: body.content,
      category: body.category,
      modality: body.modality,
      bodyPart: body.bodyPart,
      sections: body.sections,
      ownerId,
    });
    res.status(201).json(template);
  }));

  router.get("/", ensureAuthenticated, ensurePermission(store, "templates:view"), asyncHandler(async (req, res) => {
    const userTemplates = await store.listTemplates(req.session.user!.id);

    const systemTemplates = RADIOLOGY_TEMPLATES.map((t, i) => ({
      id: `system-${i}`,
      name: t.name,
      content: sectionsToHtml(t.sections),
      category: t.category,
      modality: t.modality,
      bodyPart: t.bodyPart,
      sections: t.sections,
      isSystem: true,
      ownerId: "system",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    }));

    res.json([...systemTemplates, ...userTemplates]);
  }));

  return router;
}
