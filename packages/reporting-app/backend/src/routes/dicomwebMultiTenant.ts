import { Router, Request, Response } from "express";
import axios from "axios";
import fs from "fs";
import path from "path";
import { createHash } from "node:crypto";
import dicomParser from "dicom-parser";
import { Decoder as JpegLosslessDecoder } from "jpeg-lossless-decoder-js";
import { env } from "../config/env";
import { JwtService } from "../services/jwtService";
import { TenantScopedStore } from "../services/tenantScopedStore";
import { tenantContextMiddleware, TenantRequest } from "../middleware/tenantContext";
import { validateStudyAccess } from "../middleware/tenantGuard";
import { asyncHandler } from "../middleware/asyncHandler";
import { logger } from "../services/logger";
import type { DicomwebStudyValidationResult } from "./dicomweb";

const DICOOGLE_STORAGE_DIR =
  env.DICOOGLE_STORAGE_DIR || path.resolve(__dirname, "..", "..", "..", "..", "..", "storage");
const TENANT_STORAGE_ROOT = env.TENANT_STORAGE_ROOT || DICOOGLE_STORAGE_DIR;

const useOrthanc = !!env.ORTHANC_BASE_URL;
const orthancBase = env.ORTHANC_BASE_URL || "http://orthanc:8042";
const orthancAuth = env.ORTHANC_AUTH
  ? { Authorization: `Basic ${Buffer.from(env.ORTHANC_AUTH).toString("base64")}` }
  : {};

interface DIMPatient {
  id: string;
  name: string;
  studies: DIMStudy[];
}

interface DIMStudy {
  studyInstanceUID: string;
  studyDate: string;
  studyDescription: string;
  modalities: string;
  series: DIMSeries[];
}

interface DIMSeries {
  serieNumber: number;
  serieInstanceUID: string;
  serieDescription: string;
  serieModality: string;
  images: DIMImage[];
}

interface DIMImage {
  sopInstanceUID: string;
  rawPath: string;
  uri: string;
  filename: string;
}

const tenantDimCaches = new Map<string, { data: DIMPatient[]; ts: number }>();
const tenantSopMaps = new Map<string, Map<string, string>>();
const DIM_CACHE_TTL = 120_000;
const MAX_SCAN_HEADER_BYTES = 4 * 1024 * 1024;
const MAX_DICOM_SCAN_DEPTH = 16;
const dicomTagCache = new Map<string, Record<string, unknown>>();

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function shouldInspectAsDicomFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return lower.endsWith(".dcm") || lower.endsWith(".dicom") || lower.endsWith(".ima") || lower.endsWith(".img") || !path.extname(lower);
}

function findDicomFilesRecursive(dir: string, maxDepth = MAX_DICOM_SCAN_DEPTH, depth = 0): string[] {
  const results: string[] = [];
  if (depth > maxDepth || !fs.existsSync(dir)) return results;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) results.push(...findDicomFilesRecursive(fullPath, maxDepth, depth + 1));
      else if (entry.isFile() && shouldInspectAsDicomFile(entry.name)) results.push(fullPath);
    }
  } catch { /* skip unreadable */ }
  return results;
}

function buildSyntheticSopInstanceUid(seed: string): string {
  const digest = createHash("sha1").update(seed).digest("hex");
  return `2.25.${BigInt(`0x${digest}`).toString()}`;
}

function normalizeDicomUid(rawValue: string | undefined | null): string | null {
  if (typeof rawValue !== "string") return null;
  const normalized = rawValue.replace(/\0/g, "").trim();
  return normalized.length > 0 ? normalized : null;
}

const JPEG_LOSSLESS_TRANSFER_SYNTAX_UIDS = new Set([
  "1.2.840.10008.1.2.4.57",
  "1.2.840.10008.1.2.4.70",
]);
const EXPLICIT_VR_LITTLE_ENDIAN_TRANSFER_SYNTAX_UID = "1.2.840.10008.1.2.1";

function getEffectiveFrameTransferSyntaxUID(transferSyntaxUID?: string): string {
  const normalized = normalizeDicomUid(transferSyntaxUID);
  if (normalized && JPEG_LOSSLESS_TRANSFER_SYNTAX_UIDS.has(normalized)) {
    return EXPLICIT_VR_LITTLE_ENDIAN_TRANSFER_SYNTAX_UID;
  }
  return normalized || EXPLICIT_VR_LITTLE_ENDIAN_TRANSFER_SYNTAX_UID;
}

function decodeJpegLosslessFrame(
  frameData: Buffer,
  dataSet: dicomParser.DataSet,
): Buffer | null {
  try {
    const decoder = new JpegLosslessDecoder();
    const decoded = decoder.decode(
      frameData.buffer as ArrayBufferLike,
      frameData.byteOffset,
      frameData.byteLength,
    );
    const valueCount = (decoded as { length?: number }).length ?? 0;
    if (valueCount <= 0) {
      return null;
    }

    const values = decoded as ArrayLike<number>;
    const bitsAllocated = dataSet.uint16("x00280100") ?? 16;
    if (bitsAllocated <= 8) {
      const out = Buffer.allocUnsafe(valueCount);
      for (let i = 0; i < valueCount; i += 1) {
        const value = values[i] ?? 0;
        out[i] = value & 0xff;
      }
      return out;
    }

    const out = Buffer.allocUnsafe(valueCount * 2);
    for (let i = 0; i < valueCount; i += 1) {
      const value = values[i] ?? 0;
      out.writeUInt16LE(value & 0xffff, i * 2);
    }
    return out;
  } catch {
    return null;
  }
}

function getRequestedFrameIndex(frameNumbers: string): number {
  const firstFrame = frameNumbers.split(",")[0]?.trim() ?? "1";
  const parsed = Number.parseInt(firstFrame, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return parsed - 1;
}

function extractNativeFrame(
  dataSet: dicomParser.DataSet,
  pixelDataElement: dicomParser.Element,
  frameIndex: number,
  byteArray: Uint8Array,
): Buffer | null {
  if (frameIndex < 0) return null;

  const numberOfFramesRaw = dataSet.intString("x00280008");
  const numberOfFrames = numberOfFramesRaw && numberOfFramesRaw > 0 ? numberOfFramesRaw : 1;
  if (frameIndex >= numberOfFrames) return null;

  const rows = dataSet.uint16("x00280010") ?? 0;
  const columns = dataSet.uint16("x00280011") ?? 0;
  const samplesPerPixel = dataSet.uint16("x00280002") ?? 1;
  const bitsAllocated = dataSet.uint16("x00280100") ?? 16;

  if (rows <= 0 || columns <= 0 || samplesPerPixel <= 0 || bitsAllocated <= 0) {
    if (frameIndex === 0) {
      return Buffer.from(
        byteArray.buffer,
        byteArray.byteOffset + pixelDataElement.dataOffset,
        pixelDataElement.length,
      );
    }
    return null;
  }

  const bitsPerFrame = rows * columns * samplesPerPixel * bitsAllocated;
  const bytesPerFrame = Math.ceil(bitsPerFrame / 8);
  if (!Number.isFinite(bytesPerFrame) || bytesPerFrame <= 0) {
    return null;
  }

  const pixelDataStart = byteArray.byteOffset + pixelDataElement.dataOffset;
  const pixelDataEnd = pixelDataStart + pixelDataElement.length;
  const frameStart = pixelDataStart + frameIndex * bytesPerFrame;
  if (frameStart >= pixelDataEnd) {
    return null;
  }

  const frameLength = Math.min(bytesPerFrame, pixelDataEnd - frameStart);
  return Buffer.from(byteArray.buffer, frameStart, frameLength);
}


function isNonEmptyDicomFile(filePath: string): boolean {
  try {
    const stats = fs.statSync(filePath);
    return stats.isFile() && stats.size > 0;
  } catch {
    return false;
  }
}

function parseDicomHeader(filePath: string): dicomParser.DataSet | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, "r");
    const stats = fs.fstatSync(fd);
    const readSize = Math.min(stats.size, MAX_SCAN_HEADER_BYTES);
    const buffer = Buffer.alloc(readSize);
    const bytesRead = fs.readSync(fd, buffer, 0, readSize, 0);
    if (bytesRead < 132) return null;
    const byteArray = new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead);
    return dicomParser.parseDicom(byteArray, { untilTag: "x7FE00010" });
  } catch { return null; }
  finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ } }
}

function scanTenantStorage(tenantSlug: string): DIMPatient[] {
  const tenantDir = path.join(TENANT_STORAGE_ROOT, tenantSlug);
  if (!fs.existsSync(tenantDir)) return [];

  const patientMap = new Map<string, DIMPatient>();
  const files = findDicomFilesRecursive(tenantDir);

  for (const filePath of files) {
    const ds = parseDicomHeader(filePath);
    if (!ds) continue;

    const studyUID = normalizeDicomUid(ds.string("x0020000d"));
    const seriesUID = normalizeDicomUid(ds.string("x0020000e"));
    const sopUID = normalizeDicomUid(ds.string("x00080018")) ?? "";
    if (!studyUID || !seriesUID) continue;

    const patientId = ds.string("x00100020") || "UNKNOWN";
    const patientName = ds.string("x00100010") || "Unknown";

    let patient = patientMap.get(patientId);
    if (!patient) {
      patient = { id: patientId, name: patientName, studies: [] };
      patientMap.set(patientId, patient);
    }

    let study = patient.studies.find((s) => s.studyInstanceUID === studyUID);
    if (!study) {
      study = {
        studyInstanceUID: studyUID,
        studyDate: ds.string("x00080020") || "",
        studyDescription: ds.string("x00081030") || "",
        modalities: ds.string("x00080060") || "OT",
        series: [],
      };
      patient.studies.push(study);
    }

    const modality = ds.string("x00080060") || "OT";
    let series = study.series.find((s) => s.serieInstanceUID === seriesUID);
    if (!series) {
      series = {
        serieNumber: ds.intString("x00200011") ?? 1,
        serieInstanceUID: seriesUID,
        serieDescription: ds.string("x0008103e") || "",
        serieModality: modality,
        images: [],
      };
      study.series.push(series);
    }

    if (!series.images.some((img) => img.rawPath === filePath)) {
      series.images.push({
        sopInstanceUID: sopUID,
        rawPath: filePath,
        uri: `file:///${filePath.replace(/\\/g, "/")}`,
        filename: path.basename(filePath),
      });
    }
  }

  return Array.from(patientMap.values());
}

function queryTenantDIM(tenantSlug: string): DIMPatient[] {
  const cached = tenantDimCaches.get(tenantSlug);
  if (cached && Date.now() - cached.ts < DIM_CACHE_TTL) return cached.data;

  const data = scanTenantStorage(tenantSlug);
  const sopMap = new Map<string, string>();
  const usedSopUids = new Set<string>();

  for (const patient of data) {
    for (const study of patient.studies) {
      for (const series of study.series) {
        for (let index = 0; index < series.images.length; index += 1) {
          const image = series.images[index];
          const original = (image.sopInstanceUID ?? "").trim();
          let effective = original;

          if (!effective || usedSopUids.has(effective)) {
            let salt = 0;
            do {
              const seed =
                `${original}|${image.uri}|${image.filename}|${study.studyInstanceUID}|${series.serieInstanceUID}|${index}|${salt}`;
              effective = buildSyntheticSopInstanceUid(seed);
              salt += 1;
            } while (usedSopUids.has(effective));
            image.sopInstanceUID = effective;
          }

          usedSopUids.add(effective);

          if (image.rawPath && fs.existsSync(image.rawPath)) {
            sopMap.set(effective, image.rawPath);
          }
        }
      }
    }
  }

  tenantSopMaps.set(tenantSlug, sopMap);
  tenantDimCaches.set(tenantSlug, { data, ts: Date.now() });

  logger.info({
    message: "Multi-tenant DIM scan completed",
    tenantSlug,
    patientCount: data.length,
    studyCount: data.reduce((sum, p) => sum + p.studies.length, 0),
    instanceCount: sopMap.size,
  });

  return data;
}

function clearTenantDimCache(tenantSlug?: string): void {
  if (tenantSlug) {
    tenantDimCaches.delete(tenantSlug);
    tenantSopMaps.delete(tenantSlug);
  } else {
    tenantDimCaches.clear();
    tenantSopMaps.clear();
  }
  dicomTagCache.clear();
}

function resolveTenantFilePath(tenantSlug: string, sopUID: string): string | null {
  return tenantSopMaps.get(tenantSlug)?.get(sopUID) ?? null;
}

function parseDicomTags(filePath: string): Record<string, unknown> {
  const cached = dicomTagCache.get(filePath);
  if (cached) return cached;
  try {
    const buffer = fs.readFileSync(filePath);
    const byteArray = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const dataSet = dicomParser.parseDicom(byteArray, { untilTag: "x7FE00010" });
    const getString = (tag: string) => dataSet.string(tag) || undefined;
    const getUint16 = (tag: string) => { const el = dataSet.elements[tag]; return el ? dataSet.uint16(tag) : undefined; };
    const tags: Record<string, unknown> = {
      sopClassUID: getString("x00080016"), transferSyntaxUID: getString("x00020010"),
      rows: getUint16("x00280010"), columns: getUint16("x00280011"),
      bitsAllocated: getUint16("x00280100"), bitsStored: getUint16("x00280101"),
      highBit: getUint16("x00280102"), pixelRepresentation: getUint16("x00280103"),
      samplesPerPixel: getUint16("x00280002"), photometricInterpretation: getString("x00280004"),
      windowCenter: getString("x00281050"), windowWidth: getString("x00281051"),
      numberOfFrames: getString("x00280008"), instanceNumber: getString("x00200013"),
      seriesDescription: getString("x0008103e"),
    };
    dicomTagCache.set(filePath, tags);
    return tags;
  } catch { return {}; }
}

const STRING_VRS = new Set([
  "AE", "AS", "CS", "DA", "DT", "LO", "LT", "SH", "ST", "TM", "UC", "UI", "UR", "UT",
]);
const BINARY_VRS = new Set(["OB", "OD", "OF", "OL", "OW", "UN"]);

function parserTagToDicomTag(tag: string): string {
  return tag.replace(/^x/i, "").toUpperCase();
}

function splitDicomValues(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split("\\")
    .map((part) => part.replace(/\0/g, "").trim())
    .filter((part) => part.length > 0);
}

function readElementValues(
  dataSet: dicomParser.DataSet,
  parserTag: string,
  vr: string,
): unknown[] | undefined {
  if (BINARY_VRS.has(vr)) return undefined;
  const element = dataSet.elements[parserTag];
  if (!element || element.length <= 0) {
    return undefined;
  }

  if (vr === "PN") {
    const values = splitDicomValues(dataSet.string(parserTag));
    if (values.length === 0) return undefined;
    return values.map((v) => ({ Alphabetic: v }));
  }
  if (vr === "US") {
    const count = Math.floor(element.length / 2);
    const values: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const value = dataSet.uint16(parserTag, i);
      if (value !== undefined) values.push(value);
    }
    return values.length > 0 ? values : undefined;
  }
  if (vr === "SS") {
    const count = Math.floor(element.length / 2);
    const values: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const value = dataSet.int16(parserTag, i);
      if (value !== undefined) values.push(value);
    }
    return values.length > 0 ? values : undefined;
  }
  if (vr === "UL") {
    const count = Math.floor(element.length / 4);
    const values: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const value = dataSet.uint32(parserTag, i);
      if (value !== undefined) values.push(value);
    }
    return values.length > 0 ? values : undefined;
  }
  if (vr === "SL") {
    const count = Math.floor(element.length / 4);
    const values: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const value = dataSet.int32(parserTag, i);
      if (value !== undefined) values.push(value);
    }
    return values.length > 0 ? values : undefined;
  }
  if (vr === "FL") {
    const count = Math.floor(element.length / 4);
    const values: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const value = dataSet.float(parserTag, i);
      if (value !== undefined && Number.isFinite(value)) values.push(value);
    }
    return values.length > 0 ? values : undefined;
  }
  if (vr === "FD") {
    const count = Math.floor(element.length / 8);
    const values: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const value = dataSet.double(parserTag, i);
      if (value !== undefined && Number.isFinite(value)) values.push(value);
    }
    return values.length > 0 ? values : undefined;
  }
  if (vr === "IS") {
    const values = splitDicomValues(dataSet.string(parserTag));
    if (values.length === 0) return undefined;
    return values.map((v) => {
      const parsed = Number.parseInt(v, 10);
      return Number.isFinite(parsed) ? parsed : v;
    });
  }
  if (vr === "DS") {
    const values = splitDicomValues(dataSet.string(parserTag));
    if (values.length === 0) return undefined;
    return values.map((v) => {
      const parsed = Number.parseFloat(v);
      return Number.isFinite(parsed) ? parsed : v;
    });
  }
  if (STRING_VRS.has(vr) || vr === "AT") {
    const values = splitDicomValues(dataSet.string(parserTag));
    if (values.length === 0) return undefined;
    return values;
  }
  return undefined;
}

function convertDataSetToDicomJson(
  dataSet: dicomParser.DataSet,
  bulkDataURI?: string,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  const elements = dataSet.elements as Record<string, dicomParser.Element>;

  for (const parserTag of Object.keys(elements).sort()) {
    const element = elements[parserTag];
    if (!element) continue;

    const tag = parserTagToDicomTag(parserTag);
    const vr = String(element.vr || "").toUpperCase();
    if (!vr) continue;

    if (vr === "SQ") {
      const items: Record<string, unknown>[] = [];
      for (const item of element.items ?? []) {
        const itemDataSet = (item as unknown as { dataSet?: dicomParser.DataSet }).dataSet;
        if (!itemDataSet) continue;
        const converted = convertDataSetToDicomJson(itemDataSet);
        if (Object.keys(converted).length > 0) {
          items.push(converted);
        }
      }
      metadata[tag] = { vr, Value: items };
      continue;
    }

    if (tag === "7FE00010" && bulkDataURI) {
      metadata[tag] = { vr, BulkDataURI: bulkDataURI };
      continue;
    }

    const values = readElementValues(dataSet, parserTag, vr);
    if (values && values.length > 0) {
      metadata[tag] = { vr, Value: values };
    } else {
      metadata[tag] = { vr };
    }
  }

  return metadata;
}

function parseRichDicomMetadata(
  filePath: string,
  bulkDataURI: string,
): Record<string, unknown> | null {
  try {
    const buffer = fs.readFileSync(filePath);
    const byteArray = new Uint8Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength,
    );
    const dataSet = dicomParser.parseDicom(byteArray, { untilTag: "x7FE00010" });
    const metadata = convertDataSetToDicomJson(dataSet, bulkDataURI);
    return Object.keys(metadata).length > 0 ? metadata : null;
  } catch {
    return null;
  }
}

function applyMetadataOverrides(
  metadata: Record<string, unknown>,
  patient: DIMPatient,
  studyUID: string,
  seriesUID: string,
  sopUID: string,
  modality: string,
  bulkDataURI: string,
): Record<string, unknown> {
  const result = { ...metadata };

  result["00080018"] = { vr: "UI", Value: [sopUID] };
  result["0020000D"] = { vr: "UI", Value: [studyUID] };
  result["0020000E"] = { vr: "UI", Value: [seriesUID] };
  result["00080060"] = { vr: "CS", Value: [modality || "OT"] };
  result["00100010"] = { vr: "PN", Value: [{ Alphabetic: patient.name || "" }] };
  result["00100020"] = { vr: "LO", Value: [patient.id || ""] };
  const transferSyntaxTag = result["00020010"] as { Value?: unknown[] } | undefined;
  const transferSyntaxValue =
    transferSyntaxTag && Array.isArray(transferSyntaxTag.Value)
      ? normalizeDicomUid(String(transferSyntaxTag.Value[0] ?? ""))
      : null;
  result["00020010"] = {
    vr: "UI",
    Value: [getEffectiveFrameTransferSyntaxUID(transferSyntaxValue ?? undefined)],
  };

  const pixelDataAttr = result["7FE00010"] as Record<string, unknown> | undefined;
  if (pixelDataAttr) {
    result["7FE00010"] = {
      vr: String(pixelDataAttr.vr || "OW"),
      BulkDataURI: bulkDataURI,
    };
  } else {
    result["7FE00010"] = { vr: "OW", BulkDataURI: bulkDataURI };
  }

  return result;
}

const OHIF_REQUIRED_IMAGE_METADATA_TAGS = [
  "00080016",
  "00280002",
  "00280004",
  "00280008",
  "00280010",
  "00280011",
  "00280100",
  "00280101",
  "00280102",
  "00280103",
  "7FE00010",
] as const;

function getMissingImageMetadataTags(metadata: Record<string, unknown>): string[] {
  const missing: string[] = [];
  for (const tag of OHIF_REQUIRED_IMAGE_METADATA_TAGS) {
    if (!(tag in metadata)) {
      missing.push(tag);
    }
  }
  return missing;
}

function fillMissingMetadataTags(
  primary: Record<string, unknown>,
  fallback: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...primary };
  for (const [tag, value] of Object.entries(fallback)) {
    if (!(tag in merged)) {
      merged[tag] = value;
    }
  }
  return merged;
}

function streamMultipartDicomFiles(
  res: Response,
  filePaths: string[],
  cacheControl = "private, max-age=3600",
): void {
  const boundary = "tenant-boundary";
  const headerPrefix = `--${boundary}\r\nContent-Type: application/dicom\r\n\r\n`;

  res.setHeader(
    "Content-Type",
    `multipart/related; type="application/dicom"; boundary=${boundary}`,
  );
  res.setHeader("Cache-Control", cacheControl);

  for (const filePath of filePaths) {
    const dicomBuffer = fs.readFileSync(filePath);
    res.write(Buffer.from(headerPrefix));
    res.write(dicomBuffer);
    res.write(Buffer.from("\r\n"));
  }
  res.end(Buffer.from(`--${boundary}--\r\n`));
}

function getRequestOrigin(req: Request): string | null {
  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || req.get("host");
  if (!host) return null;
  return `${forwardedProto || req.protocol}://${host}`;
}

function getDicomwebBaseUrl(req: Request): string {
  return `${getRequestOrigin(req) ?? env.BACKEND_URL.replace(/\/+$/, "")}${req.baseUrl}`;
}

function buildFallbackInstanceMetadata(
  patient: DIMPatient, studyUID: string, seriesUID: string, sopUID: string,
  modality: string, bulkDataURI: string, filePath?: string,
): Record<string, unknown> {
  const tags = filePath ? parseDicomTags(filePath) : {};
  return {
    "00080016": { vr: "UI", Value: [tags.sopClassUID || "1.2.840.10008.5.1.4.1.1.4"] },
    "00080018": { vr: "UI", Value: [sopUID] },
    "00080060": { vr: "CS", Value: [modality || "OT"] },
    "00200013": { vr: "IS", Value: [tags.instanceNumber || "1"] },
    "0008103E": { vr: "LO", Value: [tags.seriesDescription || ""] },
    "0020000D": { vr: "UI", Value: [studyUID] },
    "0020000E": { vr: "UI", Value: [seriesUID] },
    "00100010": { vr: "PN", Value: [{ Alphabetic: patient.name || "" }] },
    "00100020": { vr: "LO", Value: [patient.id || ""] },
    "00020010": {
      vr: "UI",
      Value: [getEffectiveFrameTransferSyntaxUID(tags.transferSyntaxUID as string | undefined)],
    },
    "00280002": { vr: "US", Value: [tags.samplesPerPixel ?? 1] },
    "00280004": { vr: "CS", Value: [tags.photometricInterpretation || "MONOCHROME2"] },
    "00280008": { vr: "IS", Value: [tags.numberOfFrames || "1"] },
    "00280010": { vr: "US", Value: [tags.rows ?? 256] },
    "00280011": { vr: "US", Value: [tags.columns ?? 256] },
    "00280100": { vr: "US", Value: [tags.bitsAllocated ?? 16] },
    "00280101": { vr: "US", Value: [tags.bitsStored ?? 16] },
    "00280102": { vr: "US", Value: [tags.highBit ?? 15] },
    "00280103": { vr: "US", Value: [tags.pixelRepresentation ?? 0] },
    "00281050": { vr: "DS", Value: [tags.windowCenter || "2048"] },
    "00281051": { vr: "DS", Value: [tags.windowWidth || "4096"] },
    "7FE00010": { vr: "OW", BulkDataURI: bulkDataURI },
  };
}

function buildInstanceMetadata(
  patient: DIMPatient, studyUID: string, seriesUID: string, sopUID: string,
  modality: string, bulkDataURI: string, filePath?: string,
): Record<string, unknown> {
  if (filePath) {
    const richMetadata = parseRichDicomMetadata(filePath, bulkDataURI);
    if (richMetadata) {
      const metadataWithOverrides = applyMetadataOverrides(
        richMetadata,
        patient,
        studyUID,
        seriesUID,
        sopUID,
        modality,
        bulkDataURI,
      );
      const missingTags = getMissingImageMetadataTags(metadataWithOverrides);
      if (missingTags.length === 0) {
        return metadataWithOverrides;
      }
      const fallbackMetadata = buildFallbackInstanceMetadata(
        patient,
        studyUID,
        seriesUID,
        sopUID,
        modality,
        bulkDataURI,
        filePath,
      );
      logger.debug({
        message: "Tenant rich DICOM metadata missing required image tags — filling from fallback parser",
        sopUID,
        missingTags,
      });
      return fillMissingMetadataTags(metadataWithOverrides, fallbackMetadata);
    }
  }

  return buildFallbackInstanceMetadata(
    patient,
    studyUID,
    seriesUID,
    sopUID,
    modality,
    bulkDataURI,
    filePath,
  );
}

/**
 * Multi-tenant DICOMweb proxy: supports Dicoogle (filesystem-based) as primary
 * and Orthanc as optional backend. Tenant isolation via JWT + filesystem scoping.
 */
export function dicomwebMultiTenantRouter(
  jwtService: JwtService,
  store: TenantScopedStore,
): Router {
  const router = Router({ mergeParams: true });

  router.use(tenantContextMiddleware(jwtService));

  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // QIDO-RS: Search studies — tenant-scoped
  router.get("/studies", asyncHandler(async (req: Request, res: Response) => {
    const tenantReq = req as TenantRequest;
    const tenantId = tenantReq.tenant.id;
    const tenantSlug = tenantReq.tenant.slug;

    if (useOrthanc) {
      const studies = await store.listStudies(tenantId, { name: req.query.PatientName as string, status: undefined });
      const studyUIDs = studies.map((s) => s.study_instance_uid).filter(Boolean);
      if (studyUIDs.length === 0) { res.json([]); return; }
      try {
        const allResults: unknown[] = [];
        for (let i = 0; i < studyUIDs.length; i += 50) {
          const batch = studyUIDs.slice(i, i + 50);
          const promises = batch.map((uid) =>
            axios.get(`${orthancBase}/dicom-web/studies`, {
              params: { StudyInstanceUID: uid },
              headers: { ...orthancAuth, Accept: "application/dicom+json" },
              timeout: 10_000,
            }).then((r) => r.data).catch(() => []),
          );
          const results = await Promise.all(promises);
          for (const r of results) { if (Array.isArray(r)) allResults.push(...r); }
        }
        res.json(allResults);
      } catch (err) {
        logger.error({ message: "QIDO-RS studies error (Orthanc)", error: String(err) });
        res.json([]);
      }
      return;
    }

    // Dicoogle / filesystem path
    const patients = queryTenantDIM(tenantSlug);
    const filterPatientID = req.query.PatientID as string | undefined;
    const filterPatientName = req.query.PatientName as string | undefined;
    const filterStudyUID = req.query.StudyInstanceUID as string | undefined;
    const studies: Record<string, unknown>[] = [];

    for (const patient of patients) {
      if (filterPatientID && patient.id !== filterPatientID) continue;
      if (filterPatientName) {
        const pattern = filterPatientName.replace(/\*/g, "");
        if (pattern && !patient.name.toLowerCase().includes(pattern.toLowerCase())) continue;
      }
      for (const study of patient.studies) {
        if (filterStudyUID && study.studyInstanceUID !== filterStudyUID) continue;
        const modalities = study.series.map((s) => s.serieModality).filter(Boolean);
        const instanceCount = study.series.reduce((sum, s) => sum + s.images.length, 0);
        studies.push({
          "00080005": { vr: "CS", Value: ["ISO_IR 100"] },
          "00080020": { vr: "DA", Value: [study.studyDate || ""] },
          "00080030": { vr: "TM", Value: [""] },
          "00080050": { vr: "SH", Value: [""] },
          "00080061": { vr: "CS", Value: modalities },
          "00080090": { vr: "PN", Value: [{ Alphabetic: "" }] },
          "00081030": { vr: "LO", Value: [study.studyDescription || ""] },
          "00100010": { vr: "PN", Value: [{ Alphabetic: patient.name || "" }] },
          "00100020": { vr: "LO", Value: [patient.id || ""] },
          "0020000D": { vr: "UI", Value: [study.studyInstanceUID] },
          "00200010": { vr: "SH", Value: [""] },
          "00201206": { vr: "IS", Value: [study.series.length] },
          "00201208": { vr: "IS", Value: [instanceCount] },
        });
      }
    }
    res.json(studies);
  }));

  // Validation endpoint
  router.get("/studies/:studyUID/validate",
    validateStudyAccess(),
    asyncHandler(async (req: Request, res: Response) => {
      const tenantReq = req as TenantRequest;
      const tenantSlug = tenantReq.tenant.slug;
      const studyUID = String(req.params.studyUID ?? "");
      const maxAttempts = 3;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (attempt > 1) clearTenantDimCache(tenantSlug);

        const patients = queryTenantDIM(tenantSlug);
        let matchedStudy: DIMStudy | undefined;
        for (const p of patients) {
          matchedStudy = p.studies.find((s) => s.studyInstanceUID === studyUID);
          if (matchedStudy) break;
        }

        if (!matchedStudy) {
          if (attempt < maxAttempts) { await delay(2000); continue; }
          res.status(404).json({
            studyInstanceUID: studyUID, isValid: false, reason: "STUDY_NOT_FOUND",
            message: "Study not found in tenant storage", attempts: attempt,
            endpointUrls: { qidoStudies: "", qidoSeries: "" }, responseStatus: { qidoStudies: 404 },
          } satisfies DicomwebStudyValidationResult);
          return;
        }

        const seriesWithInstances = matchedStudy.series.find((s) => s.images.length > 0);
        if (!seriesWithInstances) {
          if (attempt < maxAttempts) { await delay(2000); continue; }
          res.status(409).json({
            studyInstanceUID: studyUID, isValid: false, reason: "NO_INSTANCES",
            message: "Study exists but no images found", attempts: attempt,
            endpointUrls: { qidoStudies: "", qidoSeries: "" }, responseStatus: { qidoStudies: 200 },
          } satisfies DicomwebStudyValidationResult);
          return;
        }

        const firstImage = seriesWithInstances.images[0];
        const filePath = resolveTenantFilePath(tenantSlug, firstImage.sopInstanceUID) ?? firstImage.rawPath;
        if (!filePath || !fs.existsSync(filePath)) {
          if (attempt < maxAttempts) { await delay(2000); continue; }
          res.status(409).json({
            studyInstanceUID: studyUID, isValid: false, reason: "WADO_FRAME_UNAVAILABLE",
            message: "Study exists but file not accessible", attempts: attempt,
            endpointUrls: { qidoStudies: "", qidoSeries: "" }, responseStatus: { qidoStudies: 200 },
            seriesInstanceUID: seriesWithInstances.serieInstanceUID,
            sopInstanceUID: firstImage.sopInstanceUID,
          } satisfies DicomwebStudyValidationResult);
          return;
        }

        res.json({
          studyInstanceUID: studyUID, isValid: true,
          message: "Study, series, instances validated in tenant storage", attempts: attempt,
          endpointUrls: { qidoStudies: getDicomwebBaseUrl(req) + "/studies", qidoSeries: getDicomwebBaseUrl(req) + `/studies/${studyUID}/series` },
          responseStatus: { qidoStudies: 200, qidoSeries: 200, qidoInstances: 200 },
          seriesInstanceUID: seriesWithInstances.serieInstanceUID,
          sopInstanceUID: firstImage.sopInstanceUID,
        } satisfies DicomwebStudyValidationResult);
        return;
      }
    }),
  );

  // QIDO-RS: List series
  router.get("/studies/:studyUID/series",
    validateStudyAccess(),
    asyncHandler(async (req: Request, res: Response) => {
      const tenantReq = req as TenantRequest;
      const tenantSlug = tenantReq.tenant.slug;
      const { studyUID } = req.params;

      if (useOrthanc) {
        try {
          const response = await axios.get(`${orthancBase}/dicom-web/studies/${studyUID}/series`,
            { headers: { ...orthancAuth, Accept: "application/dicom+json" }, timeout: 10_000 });
          res.json(response.data);
        } catch { res.json([]); }
        return;
      }

      const patients = queryTenantDIM(tenantSlug);
      const seriesList: Record<string, unknown>[] = [];
      for (const patient of patients) {
        for (const study of patient.studies) {
          if (study.studyInstanceUID !== studyUID) continue;
          for (const series of study.series) {
            seriesList.push({
              "00080060": { vr: "CS", Value: [series.serieModality || ""] },
              "0008103E": { vr: "LO", Value: [series.serieDescription || ""] },
              "00200011": { vr: "IS", Value: [series.serieNumber] },
              "0020000D": { vr: "UI", Value: [studyUID] },
              "0020000E": { vr: "UI", Value: [series.serieInstanceUID] },
              "00201209": { vr: "IS", Value: [series.images.length] },
            });
          }
        }
      }
      logger.info({
        message: "Tenant QIDO /studies/{studyUID}/series response",
        tenantSlug,
        studyUID,
        seriesCount: seriesList.length,
      });
      res.json(seriesList);
    }),
  );

  // QIDO-RS: List instances
  router.get("/studies/:studyUID/series/:seriesUID/instances",
    validateStudyAccess(),
    asyncHandler(async (req: Request, res: Response) => {
      const tenantReq = req as TenantRequest;
      const tenantSlug = tenantReq.tenant.slug;
      const { studyUID, seriesUID } = req.params;

      if (useOrthanc) {
        try {
          const response = await axios.get(`${orthancBase}/dicom-web/studies/${studyUID}/series/${seriesUID}/instances`,
            { headers: { ...orthancAuth, Accept: "application/dicom+json" }, timeout: 10_000 });
          res.json(response.data);
        } catch { res.json([]); }
        return;
      }

      const patients = queryTenantDIM(tenantSlug);
      const instances: Record<string, unknown>[] = [];
      const seenInstanceKeys = new Set<string>();
      for (const patient of patients) {
        for (const study of patient.studies) {
          if (study.studyInstanceUID !== studyUID) continue;
          for (const series of study.series) {
            if (series.serieInstanceUID !== seriesUID) continue;
            for (const image of series.images) {
              const fp = resolveTenantFilePath(tenantSlug, image.sopInstanceUID) ?? image.rawPath;
              if (!fp || !isNonEmptyDicomFile(fp)) continue;
              const instanceKey = `${image.sopInstanceUID}|${fp}`;
              if (seenInstanceKeys.has(instanceKey)) continue;
              seenInstanceKeys.add(instanceKey);
              const bulkUri =
                `${getDicomwebBaseUrl(req)}/studies/${studyUID}/series/${seriesUID}` +
                `/instances/${image.sopInstanceUID}/frames/1`;
              instances.push(
                buildInstanceMetadata(
                  patient,
                  studyUID,
                  seriesUID,
                  image.sopInstanceUID,
                  series.serieModality,
                  bulkUri,
                  fp,
                ),
              );
            }
          }
        }
      }
      logger.info({
        message: "Tenant QIDO /studies/{studyUID}/series/{seriesUID}/instances response",
        tenantSlug,
        studyUID,
        seriesUID,
        instanceCount: instances.length,
      });
      res.json(instances);
    }),
  );

  // WADO-RS: Retrieve series (all instances in one series)
  router.get("/studies/:studyUID/series/:seriesUID",
    validateStudyAccess(),
    asyncHandler(async (req: Request, res: Response) => {
      const tenantReq = req as TenantRequest;
      const tenantSlug = tenantReq.tenant.slug;
      const { studyUID, seriesUID } = req.params;

      if (useOrthanc) {
        try {
          const response = await axios.get(
            `${orthancBase}/dicom-web/studies/${studyUID}/series/${seriesUID}`,
            {
              headers: { ...orthancAuth, Accept: "multipart/related; type=application/dicom" },
              responseType: "stream",
              timeout: 30_000,
            },
          );
          res.setHeader(
            "Content-Type",
            response.headers["content-type"] || "multipart/related; type=application/dicom",
          );
          res.setHeader("Cache-Control", "private, max-age=3600");
          response.data.pipe(res);
        } catch {
          res.status(404).json({ error: "No DICOM files found for this series" });
        }
        return;
      }

      const patients = queryTenantDIM(tenantSlug);
      const filePathSet = new Set<string>();

      for (const patient of patients) {
        for (const study of patient.studies) {
          if (study.studyInstanceUID !== studyUID) continue;
          for (const series of study.series) {
            if (series.serieInstanceUID !== seriesUID) continue;
            for (const image of series.images) {
              const filePath = resolveTenantFilePath(tenantSlug, image.sopInstanceUID) ?? image.rawPath;
              if (filePath && fs.existsSync(filePath)) {
                filePathSet.add(filePath);
              }
            }
          }
        }
      }

      const filePaths = Array.from(filePathSet).filter((filePath) => isNonEmptyDicomFile(filePath));
      if (filePaths.length === 0) {
        res.status(404).json({ error: "No DICOM files found for this series" });
        return;
      }

      logger.info({
        message: "Tenant WADO series retrieve response",
        tenantSlug,
        studyUID,
        seriesUID,
        instanceCount: filePaths.length,
      });
      streamMultipartDicomFiles(res, filePaths);
    }),
  );

  // WADO-RS: Retrieve study (all instances in all series)
  router.get("/studies/:studyUID",
    validateStudyAccess(),
    asyncHandler(async (req: Request, res: Response) => {
      const tenantReq = req as TenantRequest;
      const tenantSlug = tenantReq.tenant.slug;
      const { studyUID } = req.params;

      if (useOrthanc) {
        try {
          const response = await axios.get(
            `${orthancBase}/dicom-web/studies/${studyUID}`,
            {
              headers: { ...orthancAuth, Accept: "multipart/related; type=application/dicom" },
              responseType: "stream",
              timeout: 30_000,
            },
          );
          res.setHeader(
            "Content-Type",
            response.headers["content-type"] || "multipart/related; type=application/dicom",
          );
          res.setHeader("Cache-Control", "private, max-age=3600");
          response.data.pipe(res);
        } catch {
          res.status(404).json({ error: "No DICOM files found for this study" });
        }
        return;
      }

      const patients = queryTenantDIM(tenantSlug);
      const filePathSet = new Set<string>();

      for (const patient of patients) {
        for (const study of patient.studies) {
          if (study.studyInstanceUID !== studyUID) continue;
          for (const series of study.series) {
            for (const image of series.images) {
              const filePath = resolveTenantFilePath(tenantSlug, image.sopInstanceUID) ?? image.rawPath;
              if (filePath && fs.existsSync(filePath)) {
                filePathSet.add(filePath);
              }
            }
          }
        }
      }

      const filePaths = Array.from(filePathSet).filter((filePath) => isNonEmptyDicomFile(filePath));
      if (filePaths.length === 0) {
        res.status(404).json({ error: "No DICOM files found for this study" });
        return;
      }

      logger.info({
        message: "Tenant WADO study retrieve response",
        tenantSlug,
        studyUID,
        instanceCount: filePaths.length,
      });
      streamMultipartDicomFiles(res, filePaths);
    }),
  );

  // WADO-RS: Retrieve DICOM instance
  router.get("/studies/:studyUID/series/:seriesUID/instances/:sopUID",
    validateStudyAccess(),
    asyncHandler(async (req: Request, res: Response) => {
      const tenantReq = req as TenantRequest;
      const tenantSlug = tenantReq.tenant.slug;
      const sopUID = firstParam(req.params.sopUID);

      if (useOrthanc) {
        try {
          const { studyUID, seriesUID } = req.params;
          const response = await axios.get(
            `${orthancBase}/dicom-web/studies/${studyUID}/series/${seriesUID}/instances/${sopUID}`,
            { headers: { ...orthancAuth, Accept: "multipart/related; type=application/dicom" }, responseType: "stream", timeout: 30_000 });
          res.setHeader("Content-Type", response.headers["content-type"] || "application/dicom");
          res.setHeader("Cache-Control", "private, max-age=3600");
          response.data.pipe(res);
        } catch { res.status(404).json({ error: "DICOM instance not found" }); }
        return;
      }

      queryTenantDIM(tenantSlug);
      const filePath = resolveTenantFilePath(tenantSlug, sopUID);
      if (!filePath || !fs.existsSync(filePath)) {
        res.status(404).json({ error: "DICOM file not found" });
        return;
      }
      const dicomBuffer = fs.readFileSync(filePath);
      const boundary = "tenant-boundary";
      res.setHeader("Content-Type", `multipart/related; type="application/dicom"; boundary=${boundary}`);
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.write(Buffer.from(`--${boundary}\r\nContent-Type: application/dicom\r\n\r\n`));
      res.write(dicomBuffer);
      res.end(Buffer.from(`\r\n--${boundary}--\r\n`));
    }),
  );

  // WADO-RS: Retrieve frames
  router.get("/studies/:studyUID/series/:seriesUID/instances/:sopUID/frames/:frames",
    validateStudyAccess(),
    asyncHandler(async (req: Request, res: Response) => {
      const tenantReq = req as TenantRequest;
      const tenantSlug = tenantReq.tenant.slug;
      const sopUID = firstParam(req.params.sopUID);

      if (useOrthanc) {
        const { studyUID, seriesUID, frames } = req.params;
        try {
          const response = await axios.get(
            `${orthancBase}/dicom-web/studies/${studyUID}/series/${seriesUID}/instances/${sopUID}/frames/${frames}`,
            { headers: { ...orthancAuth, Accept: req.headers.accept || "multipart/related; type=application/octet-stream" }, responseType: "stream", timeout: 30_000 });
          res.setHeader("Content-Type", response.headers["content-type"] || "application/octet-stream");
          res.setHeader("Cache-Control", "private, max-age=3600");
          response.data.pipe(res);
        } catch { res.status(404).json({ error: "Frame data not found" }); }
        return;
      }

      queryTenantDIM(tenantSlug);
      const filePath = resolveTenantFilePath(tenantSlug, sopUID);
      if (!filePath || !fs.existsSync(filePath)) {
        res.status(404).json({ error: "DICOM file not found" });
        return;
      }

      const fileBuffer = fs.readFileSync(filePath);
      const byteArray = new Uint8Array(fileBuffer.buffer, fileBuffer.byteOffset, fileBuffer.byteLength);
      const dataSet = dicomParser.parseDicom(byteArray);
      const pixelDataElement = dataSet.elements["x7fe00010"];
      if (!pixelDataElement) { res.status(404).json({ error: "No pixel data" }); return; }

      const transferSyntaxUID = normalizeDicomUid(dataSet.string("x00020010"));
      let pixelData: Buffer;
      const frameIndex = getRequestedFrameIndex(firstParam(req.params.frames));
      if (pixelDataElement.encapsulatedPixelData) {
        const parserWithFrameReader = dicomParser as unknown as {
          readEncapsulatedImageFrame?: (
            dataSet: dicomParser.DataSet,
            pixelDataElement: dicomParser.Element,
            frameIndex: number,
          ) => Uint8Array;
        };

        let frameBuffer: Buffer | null = null;
        if (typeof parserWithFrameReader.readEncapsulatedImageFrame === "function") {
          try {
            const frameBytes = parserWithFrameReader.readEncapsulatedImageFrame(dataSet, pixelDataElement, frameIndex);
            if (frameBytes && frameBytes.byteLength > 0) {
              frameBuffer = Buffer.from(frameBytes.buffer, frameBytes.byteOffset, frameBytes.byteLength);
            }
          } catch {
            // fall through to fragment fallback
          }
        }

        if (!frameBuffer) {
          const fragments = pixelDataElement.fragments;
          if (!fragments || frameIndex >= fragments.length) {
            res.status(404).json({ error: `Frame ${frameIndex + 1} not found` });
            return;
          }
          const fragment = fragments[frameIndex];
          frameBuffer = Buffer.from(byteArray.buffer, byteArray.byteOffset + fragment.position, fragment.length);
        }

        if (transferSyntaxUID && JPEG_LOSSLESS_TRANSFER_SYNTAX_UIDS.has(transferSyntaxUID)) {
          const decodedFrame = decodeJpegLosslessFrame(frameBuffer, dataSet);
          if (decodedFrame) {
            pixelData = decodedFrame;
          } else {
            logger.warn({
              message: "Tenant JPEG Lossless frame decode failed — returning original encapsulated bytes",
              tenantSlug,
              sopUID,
              transferSyntaxUID,
              frameIndex,
            });
            pixelData = frameBuffer;
          }
        } else {
          pixelData = frameBuffer;
        }
      } else {
        const nativeFrame = extractNativeFrame(dataSet, pixelDataElement, frameIndex, byteArray);
        if (!nativeFrame) {
          res.status(404).json({ error: `Frame ${frameIndex + 1} not found` });
          return;
        }
        pixelData = nativeFrame;
      }

      const mediaType = "application/octet-stream";
      const acceptHeader = (req.headers.accept || "").toLowerCase();
      res.setHeader("Cache-Control", "private, max-age=3600");
      if (acceptHeader.includes("multipart")) {
        const boundary = "tenant-boundary";
        res.setHeader("Content-Type", `multipart/related; type=application/octet-stream; boundary=${boundary}`);
        res.write(Buffer.from(`--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`));
        res.write(pixelData);
        res.end(Buffer.from(`\r\n--${boundary}--\r\n`));
      } else {
        res.setHeader("Content-Type", "application/octet-stream");
        res.end(pixelData);
      }
    }),
  );

  // WADO-RS: Metadata endpoints
  router.get("/studies/:studyUID/metadata",
    validateStudyAccess(),
    asyncHandler(async (req: Request, res: Response) => {
      const tenantReq = req as TenantRequest;
      const tenantSlug = tenantReq.tenant.slug;
      const { studyUID } = req.params;

      if (useOrthanc) {
        try {
          const response = await axios.get(`${orthancBase}/dicom-web/studies/${studyUID}/metadata`,
            { headers: { ...orthancAuth, Accept: "application/dicom+json" }, timeout: 10_000 });
          res.json(response.data);
        } catch { res.json([]); }
        return;
      }

      const patients = queryTenantDIM(tenantSlug);
      const metadata: Record<string, unknown>[] = [];
      for (const patient of patients) {
        for (const study of patient.studies) {
          if (study.studyInstanceUID !== studyUID) continue;
          for (const series of study.series) {
            for (const image of series.images) {
              const fp = resolveTenantFilePath(tenantSlug, image.sopInstanceUID) ?? image.rawPath;
              const bulkUri = `${getDicomwebBaseUrl(req)}/studies/${studyUID}/series/${series.serieInstanceUID}/instances/${image.sopInstanceUID}/frames/1`;
              metadata.push(buildInstanceMetadata(patient, studyUID, series.serieInstanceUID, image.sopInstanceUID, series.serieModality, bulkUri, fp));
            }
          }
        }
      }
      res.json(metadata);
    }),
  );

  router.get("/studies/:studyUID/series/:seriesUID/metadata",
    validateStudyAccess(),
    asyncHandler(async (req: Request, res: Response) => {
      const tenantReq = req as TenantRequest;
      const tenantSlug = tenantReq.tenant.slug;
      const { studyUID, seriesUID } = req.params;

      if (useOrthanc) {
        try {
          const response = await axios.get(`${orthancBase}/dicom-web/studies/${studyUID}/series/${seriesUID}/metadata`,
            { headers: { ...orthancAuth, Accept: "application/dicom+json" }, timeout: 10_000 });
          res.json(response.data);
        } catch { res.json([]); }
        return;
      }

      const patients = queryTenantDIM(tenantSlug);
      const metadata: Record<string, unknown>[] = [];
      for (const patient of patients) {
        for (const study of patient.studies) {
          if (study.studyInstanceUID !== studyUID) continue;
          for (const series of study.series) {
            if (series.serieInstanceUID !== seriesUID) continue;
            for (const image of series.images) {
              const fp = resolveTenantFilePath(tenantSlug, image.sopInstanceUID) ?? image.rawPath;
              const bulkUri = `${getDicomwebBaseUrl(req)}/studies/${studyUID}/series/${seriesUID}/instances/${image.sopInstanceUID}/frames/1`;
              metadata.push(buildInstanceMetadata(patient, studyUID, seriesUID, image.sopInstanceUID, series.serieModality, bulkUri, fp));
            }
          }
        }
      }
      res.json(metadata);
    }),
  );

  router.get("/studies/:studyUID/series/:seriesUID/instances/:sopUID/metadata",
    validateStudyAccess(),
    asyncHandler(async (req: Request, res: Response) => {
      const tenantReq = req as TenantRequest;
      const tenantSlug = tenantReq.tenant.slug;
      const { studyUID, seriesUID, sopUID } = req.params;

      const patients = queryTenantDIM(tenantSlug);
      for (const patient of patients) {
        for (const study of patient.studies) {
          if (study.studyInstanceUID !== studyUID) continue;
          for (const series of study.series) {
            if (series.serieInstanceUID !== seriesUID) continue;
            for (const image of series.images) {
              if (image.sopInstanceUID !== sopUID) continue;
              const fp = resolveTenantFilePath(tenantSlug, image.sopInstanceUID) ?? image.rawPath;
              const bulkUri = `${getDicomwebBaseUrl(req)}/studies/${studyUID}/series/${seriesUID}/instances/${sopUID}/frames/1`;
              res.json([buildInstanceMetadata(patient, studyUID, seriesUID, sopUID, series.serieModality, bulkUri, fp)]);
              return;
            }
          }
        }
      }
      res.json([]);
    }),
  );

  // Cache warm endpoint
  router.post("/warm", asyncHandler(async (req: Request, res: Response) => {
    const tenantReq = req as TenantRequest;
    clearTenantDimCache(tenantReq.tenant.slug);
    queryTenantDIM(tenantReq.tenant.slug);
    res.json({ ok: true });
  }));

  // Internal endpoint: DICOM tenant mapping
  router.get("/internal/dicom-tenant-map", asyncHandler(async (_req: Request, res: Response) => {
    const { getFirestore } = await import("../services/firebaseAdmin");
    const db = getFirestore();
    const tenantsSnapshot = await db.collection("tenants_meta").get();
    const mappings = [];

    for (const tenantDoc of tenantsSnapshot.docs) {
      const configDoc = await db.collection("tenants").doc(tenantDoc.id).collection("dicom_config").doc("default").get();
      if (configDoc.exists) {
        const data = configDoc.data()!;
        mappings.push({
          ae_title: data.ae_title,
          tenant_id: tenantDoc.id,
          institution_name: data.institution_name,
        });
      }
    }

    res.json(mappings);
  }));

  return router;
}
