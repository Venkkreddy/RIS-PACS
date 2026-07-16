import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler";
import { ensureAuthenticated } from "../middleware/auth";
import { StoreService } from "../services/store";
import { logger } from "../services/logger";

const searchQuerySchema = z.object({
  q: z.string().min(1).max(500).optional(),
  status: z.string().optional(),
  modality: z.string().optional(),
  from: z.string().optional(),   // YYYYMMDD
  to: z.string().optional(),     // YYYYMMDD
  assignedTo: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(30),
});

interface ParsedFilters {
  modality?: string;
  body_part?: string;
  status?: string;
  date_from?: string;
  date_to?: string;
  finding?: string;
  assignedTo?: string;
}

/** Keyword-only fallback parser for when AI server is unavailable */
function keywordParse(q: string): ParsedFilters {
  const upper = q.toUpperCase();
  const out: ParsedFilters = {};

  // Modality detection
  const modalities = ['CR', 'DX', 'CT', 'MR', 'MRI', 'US', 'MG', 'NM', 'PT', 'XA', 'RF', 'FL'];
  for (const m of modalities) {
    if (upper.includes(m) || upper.includes(m === 'MR' ? 'MRI' : m)) {
      out.modality = m === 'MRI' ? 'MR' : m;
      break;
    }
  }

  // Body part detection
  const bodyParts: [string, string][] = [
    ['CHEST', 'CHEST'], ['SPINE', 'SPINE'], ['CERVICAL', 'CERVICAL SPINE'],
    ['LUMBAR', 'LUMBAR SPINE'], ['THORACIC', 'THORACIC SPINE'],
    ['ABDOMEN', 'ABDOMEN'], ['PELVIS', 'PELVIS'], ['KNEE', 'KNEE'],
    ['FEMUR', 'FEMUR'], ['FOOT', 'FOOT'], ['ANKLE', 'ANKLE'],
    ['SHOULDER', 'SHOULDER'], ['WRIST', 'WRIST'], ['ELBOW', 'ELBOW'],
    ['HIP', 'HIP'], ['SKULL', 'SKULL'], ['BRAIN', 'BRAIN'],
  ];
  for (const [kw, val] of bodyParts) {
    if (upper.includes(kw)) { out.body_part = val; break; }
  }

  // Status detection
  if (upper.includes('PENDING') || upper.includes('NOT REPORTED')) out.status = 'assigned';
  else if (upper.includes('REPORTED') || upper.includes('COMPLETED') || upper.includes('DONE')) out.status = 'reported';
  else if (upper.includes('SCHEDULED')) out.status = 'scheduled';
  else if (upper.includes('QC') || upper.includes('QUALITY')) out.status = 'ready-for-reporting';

  // Date range
  const lastWeek = upper.includes('LAST WEEK') || upper.includes('PAST WEEK');
  const lastMonth = upper.includes('LAST MONTH') || upper.includes('PAST MONTH');
  const today = upper.includes('TODAY');
  if (lastWeek || today || lastMonth) {
    const now = new Date();
    const toDate = now.toISOString().slice(0, 10).replace(/-/g, '');
    const from = new Date(now);
    if (lastWeek) from.setDate(from.getDate() - 7);
    else if (lastMonth) from.setMonth(from.getMonth() - 1);
    out.date_from = from.toISOString().slice(0, 10).replace(/-/g, '');
    out.date_to = toDate;
  }

  // Free-text finding
  const stopWords = new Set(['XRAY', 'X-RAY', 'SCAN', 'IMAGE', 'STUDY', 'REPORT', 'FIND', 'SHOW', 'GET', 'LIST', 'ALL', 'PATIENT', 'DR', 'DOCTOR', 'WITH', 'AND', 'THE', 'FOR', 'FROM', 'LAST', 'THIS', 'WEEK', 'MONTH', 'TODAY', 'PENDING', 'REPORTED', 'SCHEDULED']);
  const words = q.split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w.toUpperCase()));
  if (words.length > 0 && !out.modality && !out.body_part) {
    out.finding = words.join(' ');
  }

  return out;
}

/** Call MedASR server to parse the query */
async function aiParse(query: string, medasrUrl: string): Promise<ParsedFilters | null> {
  try {
    const resp = await fetch(`${medasrUrl}/v1/search/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;
    return await resp.json() as ParsedFilters;
  } catch {
    return null;
  }
}

/** Generate match reasons for a study given the parsed filters */
function buildMatchReasons(study: any, parsed: ParsedFilters, rawQuery: string): string[] {
  const reasons: string[] = [];
  const q = rawQuery.toLowerCase();

  if (parsed.modality && (study.modality ?? '').toUpperCase() === parsed.modality.toUpperCase()) {
    reasons.push(`Modality: ${parsed.modality}`);
  }
  if (parsed.body_part) {
    const bp = (study.bodyPart ?? study.metadata?.bodyPart ?? '').toLowerCase();
    if (bp.includes(parsed.body_part.toLowerCase())) reasons.push(`Body Part: ${parsed.body_part}`);
  }
  if (parsed.status && study.status === parsed.status) {
    reasons.push(`Status: ${study.status}`);
  }
  if (parsed.finding) {
    const haystack = [study.patientName, study.metadata?.findings, study.metadata?.aiSummary, study.description].join(' ').toLowerCase();
    const findingWords = parsed.finding.toLowerCase().split(/\s+/);
    const matchedWords = findingWords.filter(w => haystack.includes(w));
    if (matchedWords.length > 0) reasons.push(`Finding: ${matchedWords.join(', ')}`);
  }
  if (parsed.date_from || parsed.date_to) {
    const date = study.studyDate ?? '';
    if ((!parsed.date_from || date >= parsed.date_from) && (!parsed.date_to || date <= parsed.date_to)) {
      reasons.push(`Date: ${date}`);
    }
  }
  // Patient name match
  if (q) {
    const firstWord = q.split(/\s+/)[0];
    if (firstWord && (study.patientName ?? '').toLowerCase().includes(firstWord)) {
      reasons.push(`Patient: ${study.patientName}`);
    }
  }
  return reasons;
}

export function searchRouter(store: StoreService): Router {
  const router = Router();
  const medasrUrl = process.env.MEDASR_SERVER_URL ?? 'http://localhost:5001';

  router.get(
    '/search',
    ensureAuthenticated,
    asyncHandler(async (req, res) => {
      const { q, status, modality, from, to, assignedTo, limit } = searchQuerySchema.parse(req.query);
      const user = req.session?.user;
      if (!user) { res.status(401).json({ error: 'Unauthenticated' }); return; }

      // Parse the natural language query
      let parsed: ParsedFilters = {};
      if (q) {
        const aiResult = await aiParse(q, medasrUrl);
        parsed = aiResult ?? keywordParse(q);
        logger.info({ message: 'AI Search parse', q, parsed, aiUsed: !!aiResult });
      }

      // Manual filter overrides from URL params
      if (status) parsed.status = status;
      if (modality) parsed.modality = modality;
      if (from) parsed.date_from = from;
      if (to) parsed.date_to = to;
      if (assignedTo) parsed.assignedTo = assignedTo;

      // Fetch all studies with status filter if available
      const storeFilters: any = {};
      if (parsed.status) storeFilters.status = parsed.status;
      // Role-based scope: radiologists see only their assigned studies
      if (user.role === 'radiologist') storeFilters.assignedTo = parsed.assignedTo ?? user.id;

      const allStudies = await store.listStudyRecords(storeFilters);

      // Apply additional filters and score results
      const scored: Array<{ study: any; matchReasons: string[]; score: number }> = [];

      for (const study of allStudies) {
        const reasons = buildMatchReasons(study, parsed, q ?? '');

        // Modality hard-filter
        if (parsed.modality && (study.modality ?? '').toUpperCase() !== parsed.modality.toUpperCase()) continue;

        // Date range hard-filter
        if (parsed.date_from && (study.studyDate ?? '') < parsed.date_from) continue;
        if (parsed.date_to && (study.studyDate ?? '') > parsed.date_to) continue;

        // Include if any reason matched OR if no specific filters were set
        if (!q || reasons.length > 0 || (!parsed.modality && !parsed.body_part && !parsed.finding)) {
          scored.push({ study, matchReasons: reasons, score: reasons.length });
        }
      }

      // Sort by score desc then date desc
      scored.sort((a, b) => b.score - a.score || (b.study.studyDate ?? '').localeCompare(a.study.studyDate ?? ''));

      const results = scored.slice(0, limit).map(({ study, matchReasons }) => ({
        studyId: study.studyId,
        patientName: study.patientName ?? 'Unknown',
        patientId: study.patientId ?? '',
        modality: study.modality ?? '',
        bodyPart: study.bodyPart ?? study.metadata?.bodyPart ?? '',
        studyDate: study.studyDate ?? '',
        status: study.status ?? '',
        assignedTo: study.assignedTo ?? null,
        location: study.location ?? '',
        description: study.description ?? '',
        aiSummary: study.metadata?.aiSummary ?? null,
        matchReasons,
      }));

      res.json({
        query: q ?? '',
        parsedFilters: parsed,
        total: scored.length,
        results,
      });
    }),
  );

  return router;
}
