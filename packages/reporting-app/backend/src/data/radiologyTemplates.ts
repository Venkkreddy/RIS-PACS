import type { ReportSection } from "@medical-report-system/shared";

export interface SystemTemplate {
  name: string;
  category: string;
  modality: string;
  bodyPart: string;
  sections: ReportSection[];
}

const STANDARD_SECTIONS = {
  clinicalHistory: { key: "clinical_history", title: "Clinical History" },
  comparison: { key: "comparison", title: "Comparison" },
  technique: { key: "technique", title: "Technique" },
  findings: { key: "findings", title: "Findings" },
  impression: { key: "impression", title: "Impression" },
  recommendation: { key: "recommendation", title: "Recommendation" },
} as const;

export const RADIOLOGY_TEMPLATES: SystemTemplate[] = [
  // ── Chest X-Ray ─────────────────────────────────────────
  {
    name: "Chest X-Ray (PA/Lateral)",
    category: "Chest",
    modality: "CR",
    bodyPart: "Chest",
    sections: [
      { ...STANDARD_SECTIONS.clinicalHistory, content: "" },
      { ...STANDARD_SECTIONS.comparison, content: "No prior studies available for comparison." },
      { ...STANDARD_SECTIONS.technique, content: "PA and lateral views of the chest were obtained." },
      {
        ...STANDARD_SECTIONS.findings,
        content: `<p><strong>Lungs:</strong> The lungs are clear bilaterally. No focal consolidation, pleural effusion, or pneumothorax.</p>
<p><strong>Heart:</strong> The cardiac silhouette is normal in size. The mediastinal contours are unremarkable.</p>
<p><strong>Vasculature:</strong> The pulmonary vasculature is normal.</p>
<p><strong>Bones:</strong> No acute osseous abnormality.</p>
<p><strong>Soft Tissues:</strong> Unremarkable.</p>`,
      },
      { ...STANDARD_SECTIONS.impression, content: "<p>No acute cardiopulmonary abnormality.</p>" },
      { ...STANDARD_SECTIONS.recommendation, content: "" },
    ],
  },

  // ── Chest X-Ray Critical ────────────────────────────────
  {
    name: "Chest X-Ray — Pneumonia",
    category: "Chest",
    modality: "CR",
    bodyPart: "Chest",
    sections: [
      { ...STANDARD_SECTIONS.clinicalHistory, content: "Fever, cough, shortness of breath." },
      { ...STANDARD_SECTIONS.comparison, content: "" },
      { ...STANDARD_SECTIONS.technique, content: "PA and lateral views of the chest were obtained." },
      {
        ...STANDARD_SECTIONS.findings,
        content: `<p><strong>Lungs:</strong> There is patchy airspace opacity in the [right/left] [upper/middle/lower] lobe, consistent with consolidation. No pleural effusion. No pneumothorax.</p>
<p><strong>Heart:</strong> The cardiac silhouette is [normal/mildly enlarged].</p>
<p><strong>Vasculature:</strong> The pulmonary vasculature is [normal/mildly congested].</p>
<p><strong>Bones:</strong> No acute osseous abnormality.</p>`,
      },
      { ...STANDARD_SECTIONS.impression, content: "<p>Findings consistent with [lobar/broncho]pneumonia in the [location]. Clinical correlation and follow-up recommended.</p>" },
      { ...STANDARD_SECTIONS.recommendation, content: "<p>Suggest follow-up chest radiograph in 4–6 weeks to document resolution.</p>" },
    ],
  },

  // ── CT Abdomen & Pelvis ─────────────────────────────────
  {
    name: "CT Abdomen & Pelvis (with contrast)",
    category: "Abdomen",
    modality: "CT",
    bodyPart: "Abdomen",
    sections: [
      { ...STANDARD_SECTIONS.clinicalHistory, content: "" },
      { ...STANDARD_SECTIONS.comparison, content: "No prior studies available for comparison." },
      {
        ...STANDARD_SECTIONS.technique,
        content: "Axial CT images of the abdomen and pelvis were obtained following administration of IV and oral contrast material.",
      },
      {
        ...STANDARD_SECTIONS.findings,
        content: `<p><strong>Liver:</strong> Normal in size and attenuation. No focal hepatic lesion.</p>
<p><strong>Gallbladder and Bile Ducts:</strong> The gallbladder is unremarkable. No biliary dilatation.</p>
<p><strong>Pancreas:</strong> Normal in size and morphology.</p>
<p><strong>Spleen:</strong> Normal in size.</p>
<p><strong>Adrenal Glands:</strong> Unremarkable bilaterally.</p>
<p><strong>Kidneys and Ureters:</strong> The kidneys enhance symmetrically without hydronephrosis or suspicious mass.</p>
<p><strong>Bladder:</strong> Unremarkable.</p>
<p><strong>Bowel:</strong> No bowel obstruction or wall thickening.</p>
<p><strong>Lymph Nodes:</strong> No pathologically enlarged mesenteric or retroperitoneal lymph nodes.</p>
<p><strong>Vascular:</strong> The aorta and IVC are normal in caliber.</p>
<p><strong>Bones:</strong> No aggressive osseous lesion.</p>
<p><strong>Pelvis:</strong> Unremarkable.</p>`,
      },
      { ...STANDARD_SECTIONS.impression, content: "<p>No acute intra-abdominal or pelvic abnormality.</p>" },
      { ...STANDARD_SECTIONS.recommendation, content: "" },
    ],
  },

  // ── CT Head without contrast ────────────────────────────
  {
    name: "CT Head (without contrast)",
    category: "Neuro",
    modality: "CT",
    bodyPart: "Head",
    sections: [
      { ...STANDARD_SECTIONS.clinicalHistory, content: "" },
      { ...STANDARD_SECTIONS.comparison, content: "No prior studies available for comparison." },
      {
        ...STANDARD_SECTIONS.technique,
        content: "Non-contrast axial CT images of the head were obtained.",
      },
      {
        ...STANDARD_SECTIONS.findings,
        content: `<p><strong>Brain Parenchyma:</strong> No acute intracranial hemorrhage, mass, or midline shift. Gray-white matter differentiation is preserved.</p>
<p><strong>Ventricles:</strong> The ventricles and sulci are normal in size and configuration for age.</p>
<p><strong>Extra-axial Spaces:</strong> No extra-axial fluid collection.</p>
<p><strong>Calvarium:</strong> No fracture.</p>
<p><strong>Paranasal Sinuses and Mastoids:</strong> Clear.</p>
<p><strong>Orbits:</strong> Unremarkable.</p>`,
      },
      { ...STANDARD_SECTIONS.impression, content: "<p>No acute intracranial abnormality.</p>" },
      { ...STANDARD_SECTIONS.recommendation, content: "" },
    ],
  },

  // ── MRI Brain ───────────────────────────────────────────
  {
    name: "MRI Brain (with & without contrast)",
    category: "Neuro",
    modality: "MR",
    bodyPart: "Brain",
    sections: [
      { ...STANDARD_SECTIONS.clinicalHistory, content: "" },
      { ...STANDARD_SECTIONS.comparison, content: "No prior studies available for comparison." },
      {
        ...STANDARD_SECTIONS.technique,
        content: "Multiplanar, multisequence MRI of the brain was performed before and after administration of gadolinium-based IV contrast. Sequences include T1, T2, FLAIR, DWI, and post-contrast T1.",
      },
      {
        ...STANDARD_SECTIONS.findings,
        content: `<p><strong>Brain Parenchyma:</strong> No abnormal signal intensity. No restricted diffusion to suggest acute infarct. No abnormal enhancement.</p>
<p><strong>Ventricles:</strong> Normal in size and morphology.</p>
<p><strong>Extra-axial Spaces:</strong> No extra-axial collection.</p>
<p><strong>Midline Structures:</strong> Pituitary gland and sella are unremarkable. No midline shift.</p>
<p><strong>Posterior Fossa:</strong> Cerebellum and brainstem are unremarkable.</p>
<p><strong>Intracranial Vessels:</strong> Major intracranial vessels demonstrate normal flow voids.</p>
<p><strong>Calvarium:</strong> No suspicious marrow signal.</p>`,
      },
      { ...STANDARD_SECTIONS.impression, content: "<p>No acute intracranial abnormality. No abnormal enhancement to suggest neoplasm or infection.</p>" },
      { ...STANDARD_SECTIONS.recommendation, content: "" },
    ],
  },

  // ── MRI Spine (Lumbar) ──────────────────────────────────
  {
    name: "MRI Lumbar Spine",
    category: "MSK",
    modality: "MR",
    bodyPart: "Spine",
    sections: [
      { ...STANDARD_SECTIONS.clinicalHistory, content: "Low back pain." },
      { ...STANDARD_SECTIONS.comparison, content: "" },
      {
        ...STANDARD_SECTIONS.technique,
        content: "Multiplanar MRI of the lumbar spine was performed without contrast. Sequences include T1, T2, and STIR.",
      },
      {
        ...STANDARD_SECTIONS.findings,
        content: `<p><strong>Alignment:</strong> Normal lumbar lordosis. No listhesis.</p>
<p><strong>Vertebral Bodies:</strong> Normal height and signal. No compression fracture.</p>
<p><strong>Intervertebral Discs:</strong></p>
<ul>
  <li><strong>L1-L2:</strong> No significant disc abnormality.</li>
  <li><strong>L2-L3:</strong> No significant disc abnormality.</li>
  <li><strong>L3-L4:</strong> Mild disc bulge. No significant canal stenosis.</li>
  <li><strong>L4-L5:</strong> [Describe disc herniation/bulge/stenosis].</li>
  <li><strong>L5-S1:</strong> [Describe disc herniation/bulge/stenosis].</li>
</ul>
<p><strong>Spinal Canal:</strong> No central canal stenosis.</p>
<p><strong>Neural Foramina:</strong> Patent bilaterally at all levels.</p>
<p><strong>Conus Medullaris:</strong> Normal position and signal.</p>
<p><strong>Paraspinal Soft Tissues:</strong> Unremarkable.</p>`,
      },
      { ...STANDARD_SECTIONS.impression, content: "" },
      { ...STANDARD_SECTIONS.recommendation, content: "" },
    ],
  },

  // ── Ultrasound Abdomen ──────────────────────────────────
  {
    name: "Ultrasound Abdomen (Complete)",
    category: "Abdomen",
    modality: "US",
    bodyPart: "Abdomen",
    sections: [
      { ...STANDARD_SECTIONS.clinicalHistory, content: "" },
      { ...STANDARD_SECTIONS.comparison, content: "" },
      {
        ...STANDARD_SECTIONS.technique,
        content: "Real-time gray-scale and color Doppler sonographic evaluation of the abdomen was performed.",
      },
      {
        ...STANDARD_SECTIONS.findings,
        content: `<p><strong>Liver:</strong> Normal in size and echotexture. No focal hepatic lesion. The hepatic vasculature is patent.</p>
<p><strong>Gallbladder:</strong> Thin-walled and nondistended. No gallstones or pericholecystic fluid. Common bile duct measures ___ mm (normal &lt;7 mm).</p>
<p><strong>Pancreas:</strong> Visualized portions are unremarkable.</p>
<p><strong>Spleen:</strong> Normal in size, measuring ___ cm.</p>
<p><strong>Right Kidney:</strong> Measures ___ cm. Normal echotexture. No hydronephrosis or stones.</p>
<p><strong>Left Kidney:</strong> Measures ___ cm. Normal echotexture. No hydronephrosis or stones.</p>
<p><strong>Aorta:</strong> Normal caliber. No aneurysm.</p>
<p><strong>Ascites:</strong> None.</p>`,
      },
      { ...STANDARD_SECTIONS.impression, content: "<p>Normal abdominal ultrasound.</p>" },
      { ...STANDARD_SECTIONS.recommendation, content: "" },
    ],
  },

  // ── Ultrasound Pelvis ───────────────────────────────────
  {
    name: "Ultrasound Pelvis (Transabdominal)",
    category: "OB-GYN",
    modality: "US",
    bodyPart: "Pelvis",
    sections: [
      { ...STANDARD_SECTIONS.clinicalHistory, content: "" },
      { ...STANDARD_SECTIONS.comparison, content: "" },
      { ...STANDARD_SECTIONS.technique, content: "Transabdominal pelvic ultrasound was performed." },
      {
        ...STANDARD_SECTIONS.findings,
        content: `<p><strong>Uterus:</strong> Measures ___ × ___ × ___ cm. [Anteverted/Retroverted]. The myometrium is homogeneous. The endometrial stripe measures ___ mm.</p>
<p><strong>Right Ovary:</strong> Measures ___ × ___ × ___ cm. Normal in appearance.</p>
<p><strong>Left Ovary:</strong> Measures ___ × ___ × ___ cm. Normal in appearance.</p>
<p><strong>Cul-de-sac:</strong> No free fluid.</p>`,
      },
      { ...STANDARD_SECTIONS.impression, content: "<p>Normal pelvic ultrasound.</p>" },
      { ...STANDARD_SECTIONS.recommendation, content: "" },
    ],
  },

  // ── Mammography ─────────────────────────────────────────
  {
    name: "Screening Mammography",
    category: "Breast",
    modality: "MG",
    bodyPart: "Breast",
    sections: [
      { ...STANDARD_SECTIONS.clinicalHistory, content: "Screening mammography. No current breast complaints." },
      { ...STANDARD_SECTIONS.comparison, content: "" },
      {
        ...STANDARD_SECTIONS.technique,
        content: "Standard CC and MLO views of both breasts were obtained. Tomosynthesis was performed.",
      },
      {
        ...STANDARD_SECTIONS.findings,
        content: `<p><strong>Breast Composition:</strong> The breasts are [almost entirely fatty / scattered areas of fibroglandular density / heterogeneously dense / extremely dense] (ACR density [A/B/C/D]).</p>
<p><strong>Right Breast:</strong> No suspicious mass, architectural distortion, or suspicious calcifications.</p>
<p><strong>Left Breast:</strong> No suspicious mass, architectural distortion, or suspicious calcifications.</p>
<p><strong>Axillae:</strong> No suspicious axillary lymph nodes.</p>
<p><strong>Skin:</strong> Unremarkable.</p>`,
      },
      {
        ...STANDARD_SECTIONS.impression,
        content: `<p><strong>BI-RADS Assessment:</strong> Category 1 — Negative.</p>
<p>Recommend routine annual screening mammography.</p>`,
      },
      { ...STANDARD_SECTIONS.recommendation, content: "<p>Routine annual screening mammography recommended.</p>" },
    ],
  },

  // ── CT Chest (PE Protocol) ──────────────────────────────
  {
    name: "CT Chest — PE Protocol",
    category: "Chest",
    modality: "CT",
    bodyPart: "Chest",
    sections: [
      { ...STANDARD_SECTIONS.clinicalHistory, content: "Dyspnea, chest pain. Rule out pulmonary embolism." },
      { ...STANDARD_SECTIONS.comparison, content: "" },
      {
        ...STANDARD_SECTIONS.technique,
        content: "CT pulmonary angiography was performed with IV contrast material. Axial images with coronal and sagittal reformats were reviewed.",
      },
      {
        ...STANDARD_SECTIONS.findings,
        content: `<p><strong>Pulmonary Arteries:</strong> No filling defect within the main, lobar, segmental, or subsegmental pulmonary arteries to suggest pulmonary embolism.</p>
<p><strong>Heart:</strong> The heart is normal in size. No pericardial effusion. The RV/LV ratio is [normal / elevated (>1.0)].</p>
<p><strong>Lungs:</strong> [Clear / Describe findings]. No pleural effusion. No pneumothorax.</p>
<p><strong>Mediastinum:</strong> No pathologically enlarged mediastinal lymph nodes.</p>
<p><strong>Chest Wall:</strong> Unremarkable.</p>
<p><strong>Upper Abdomen:</strong> Limited evaluation; visualized portions unremarkable.</p>
<p><strong>Bones:</strong> No acute osseous abnormality.</p>`,
      },
      { ...STANDARD_SECTIONS.impression, content: "<p>No evidence of pulmonary embolism.</p>" },
      { ...STANDARD_SECTIONS.recommendation, content: "" },
    ],
  },

  // ── X-Ray Extremity ─────────────────────────────────────
  {
    name: "X-Ray Extremity (Fracture Assessment)",
    category: "MSK",
    modality: "DX",
    bodyPart: "Extremity",
    sections: [
      { ...STANDARD_SECTIONS.clinicalHistory, content: "Trauma. Rule out fracture." },
      { ...STANDARD_SECTIONS.comparison, content: "" },
      { ...STANDARD_SECTIONS.technique, content: "AP and lateral views of the [right/left] [extremity] were obtained." },
      {
        ...STANDARD_SECTIONS.findings,
        content: `<p><strong>Bones:</strong> No acute fracture or dislocation. Osseous alignment is maintained. No aggressive osseous lesion.</p>
<p><strong>Joints:</strong> Joint spaces are preserved. No joint effusion.</p>
<p><strong>Soft Tissues:</strong> No significant soft tissue swelling.</p>`,
      },
      { ...STANDARD_SECTIONS.impression, content: "<p>No acute fracture or dislocation.</p>" },
      { ...STANDARD_SECTIONS.recommendation, content: "" },
    ],
  },

  // ── Blank / General ─────────────────────────────────────
  {
    name: "General Radiology Report",
    category: "General",
    modality: "OT",
    bodyPart: "Other",
    sections: [
      { ...STANDARD_SECTIONS.clinicalHistory, content: "" },
      { ...STANDARD_SECTIONS.comparison, content: "" },
      { ...STANDARD_SECTIONS.technique, content: "" },
      { ...STANDARD_SECTIONS.findings, content: "" },
      { ...STANDARD_SECTIONS.impression, content: "" },
      { ...STANDARD_SECTIONS.recommendation, content: "" },
    ],
  },
];

export function sectionsToHtml(sections: ReportSection[]): string {
  return sections
    .filter((s) => s.content.trim())
    .map((s) => `<h3>${s.title}</h3>\n${s.content}`)
    .join("\n");
}
