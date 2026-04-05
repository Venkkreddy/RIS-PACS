export interface ReportVersion {
  id: string;
  type: 'initial' | 'addendum' | 'voice-transcript' | 'attachment' | 'share';
  content: string;
  authorId: string;
  createdAt: string;
}

export interface ReportVoice {
  audioUrl: string;
  transcript: string;
}

export interface Report {
  id: string;
  studyId: string;
  templateId?: string;
  content: string;
  ownerId: string;
  metadata?: Record<string, unknown>;
  attachments: string[];
  voice?: ReportVoice;
  versions: ReportVersion[];
  createdAt: string;
  updatedAt: string;
}
