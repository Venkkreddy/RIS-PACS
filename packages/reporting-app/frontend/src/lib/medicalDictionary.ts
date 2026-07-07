/**
 * Rule-based correction for common radiology dictation mis-transcriptions.
 * Browser speech recognition frequently mangles multi-syllable medical terms
 * (splits them into homophone-sounding everyday words). This is a deterministic
 * find/replace pass over the dictionary below — no network call, works offline,
 * and runs before the text is inserted into the report editor.
 *
 * Keys are matched case-insensitively as whole words/phrases; values are the
 * corrected radiology term, with original capitalization of the first letter preserved.
 */
const CORRECTIONS: Record<string, string> = {
  // Pulmonary / chest
  "new monia": "pneumonia",
  "neumonia": "pneumonia",
  "new mothorax": "pneumothorax",
  "neumothorax": "pneumothorax",
  "atalectasis": "atelectasis",
  "ate lectasis": "atelectasis",
  "effusion": "effusion",
  "plural effusion": "pleural effusion",
  "ploral effusion": "pleural effusion",
  "consolidate ation": "consolidation",
  "bronky ectasis": "bronchiectasis",
  "bronchi ectasis": "bronchiectasis",
  "med iastinum": "mediastinum",
  "media steinum": "mediastinum",
  "cardiomegally": "cardiomegaly",
  "cardio megaly": "cardiomegaly",

  // Musculoskeletal
  "ostio arthritis": "osteoarthritis",
  "osteo arthritis": "osteoarthritis",
  "ostioporosis": "osteoporosis",
  "osteo porosis": "osteoporosis",
  "frack sure": "fracture",
  "frac ture": "fracture",
  "disloca shun": "dislocation",
  "sub luxation": "subluxation",
  "spondy losis": "spondylosis",
  "spondilosis": "spondylosis",
  "spondy lolisthesis": "spondylolisthesis",

  // Abdomen
  "hepato megaly": "hepatomegaly",
  "hepatomegally": "hepatomegaly",
  "splino megaly": "splenomegaly",
  "spleno megaly": "splenomegaly",
  "hydro nephrosis": "hydronephrosis",
  "nephro lithiasis": "nephrolithiasis",
  "chole lithiasis": "cholelithiasis",
  "panc reatitis": "pancreatitis",
  "diverticu losis": "diverticulosis",
  "diverticu litis": "diverticulitis",

  // Neuro
  "hemorage": "hemorrhage",
  "hemmorhage": "hemorrhage",
  "infart": "infarct",
  "infarction": "infarction",
  "ischemea": "ischemia",
  "ischaemia": "ischemia",
  "edema": "edema",
  "midline shift": "midline shift",
  "ventrico megaly": "ventriculomegaly",
  "hydro cephalus": "hydrocephalus",

  // General qualifiers commonly mis-heard
  "bi lateral": "bilateral",
  "uni lateral": "unilateral",
  "a cute": "acute",
  "kronic": "chronic",
  "be nine": "benign",
  "ma lignant": "malignant",
};

function sortedKeys(): string[] {
  return Object.keys(CORRECTIONS).sort((a, b) => b.length - a.length);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchCase(source: string, target: string): string {
  if (source[0] && source[0] === source[0].toUpperCase() && /[a-zA-Z]/.test(source[0])) {
    return target.charAt(0).toUpperCase() + target.slice(1);
  }
  return target;
}

/** Applies the dictionary corrections to a transcript. Pure function, safe to call repeatedly. */
export function correctMedicalTerms(text: string): string {
  let result = text;
  for (const key of sortedKeys()) {
    const pattern = new RegExp(`\\b${escapeRegExp(key)}\\b`, "gi");
    result = result.replace(pattern, (match) => matchCase(match, CORRECTIONS[key]));
  }
  return result;
}

/** Add or override a correction at runtime (e.g. from a user-maintained custom dictionary later). */
export function addMedicalCorrection(misheard: string, correct: string): void {
  CORRECTIONS[misheard.toLowerCase()] = correct;
}
