export type StudyStatus = "unassigned" | "assigned" | "reported";
export type StudyPriority = "emergency" | "urgent" | "stat" | "normal";

export interface MonaiFinding {
  label: string;
  confidence: number;
  description: string;
  location?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

export interface MedgemmaCondition {
  label: string;
  confidence: number;
  description: string;
}

export interface MonaiInferenceResult {
  studyId: string;
  model: string;
  status: "completed" | "failed" | "pending";
  findings: MonaiFinding[];
  summary: string;
  processedAt: string;
  processingTimeMs: number;
  heatmapPngBase64?: string;
  heatmapUrl?: string;
  gspsUrl?: string;
  medgemmaNarrative?: string;
  medgemmaFindings?: string;
  medgemmaImpression?: string;
  medgemmaConditions?: MedgemmaCondition[];
  dicomSrGenerated?: boolean;
  dicomScGenerated?: boolean;
  dicomGspsGenerated?: boolean;
}

export interface MonaiModelInfo {
  name: string;
  description: string;
  type: string;
  bodyParts: string[];
  modalities: string[];
  version: string;
}

export interface DicomViewerValidation {
  state?: "valid" | "invalid";
  reason?: string | null;
  message?: string;
  validatedAt?: string;
}

export interface WorklistStudy {
  studyId: string;
  patientName?: string;
  studyDate?: string;
  modality?: string;
  description?: string;
  bodyPart?: string;
  location?: string;
  metadata?: Record<string, unknown>;
  status: StudyStatus;
  priority?: StudyPriority;
  assignedTo?: string;
  assignedAt?: string;
  reportedAt?: string;
  tatHours?: number;
  viewerUrl: string | null;
  weasisUrl: string | null;
  reportUrl: string;
  viewerValidation?: DicomViewerValidation | null;
}

export interface WorklistUser {
  id: string;
  email: string;
  role: "admin" | "super_admin" | "developer" | "radiographer" | "radiologist" | "referring" | "billing" | "receptionist" | "viewer";
  approved?: boolean;
  requestStatus?: "pending" | "approved" | "rejected";
  displayName?: string;
}
