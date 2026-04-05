"""Read DICOM metadata from real anonymized files."""
import pydicom
import os
import json

base = r"c:\Users\Guna\Downloads\Anonymized_20260315 (1)"
all_info = []
study_uids = set()

for sd in sorted(os.listdir(base)):
    fp = os.path.join(base, sd)
    if not os.path.isdir(fp):
        continue
    files = sorted([f for f in os.listdir(fp) if f.endswith(".dcm")])
    if not files:
        continue
    ds = pydicom.dcmread(os.path.join(fp, files[0]), stop_before_pixels=True)

    study_uid = str(ds.StudyInstanceUID)
    series_uid = str(ds.SeriesInstanceUID)
    patient_name = str(getattr(ds, "PatientName", "Anonymous"))
    patient_id = str(getattr(ds, "PatientID", "UNKNOWN"))
    study_date = str(getattr(ds, "StudyDate", ""))
    modality = str(getattr(ds, "Modality", "OT"))
    study_desc = str(getattr(ds, "StudyDescription", ""))
    series_desc = str(getattr(ds, "SeriesDescription", ""))
    rows = int(getattr(ds, "Rows", 0))
    cols = int(getattr(ds, "Columns", 0))
    bits = int(getattr(ds, "BitsAllocated", 0))
    bits_stored = int(getattr(ds, "BitsStored", 0))
    high_bit = int(getattr(ds, "HighBit", 0))
    pixel_rep = int(getattr(ds, "PixelRepresentation", 0))
    samples = int(getattr(ds, "SamplesPerPixel", 1))
    photometric = str(getattr(ds, "PhotometricInterpretation", "MONOCHROME2"))

    ts = "unknown"
    if hasattr(ds, "file_meta") and hasattr(ds.file_meta, "TransferSyntaxUID"):
        ts = str(ds.file_meta.TransferSyntaxUID)

    # Collect SOP UIDs for all files in the series
    sop_uids = []
    for f in files:
        d = pydicom.dcmread(os.path.join(fp, f), stop_before_pixels=True)
        sop_uids.append(str(d.SOPInstanceUID))

    study_uids.add(study_uid)
    info = {
        "series_dir": sd,
        "file_count": len(files),
        "study_uid": study_uid,
        "series_uid": series_uid,
        "patient_name": patient_name,
        "patient_id": patient_id,
        "study_date": study_date,
        "modality": modality,
        "study_desc": study_desc,
        "series_desc": series_desc,
        "rows": rows,
        "cols": cols,
        "bits_allocated": bits,
        "bits_stored": bits_stored,
        "high_bit": high_bit,
        "pixel_rep": pixel_rep,
        "samples_per_pixel": samples,
        "photometric": photometric,
        "transfer_syntax": ts,
        "sop_uids": sop_uids,
        "filenames": files,
    }
    all_info.append(info)

    print(f"{sd} ({len(files)} files):")
    print(f"  StudyUID:  {study_uid}")
    print(f"  SeriesUID: {series_uid}")
    print(f"  Patient:   {patient_name} (ID: {patient_id})")
    print(f"  Modality:  {modality}  Date: {study_date}")
    print(f"  StudyDesc: {study_desc}")
    print(f"  SeriesDesc:{series_desc}")
    print(f"  Image:     {rows}x{cols}, {bits}bit ({bits_stored} stored)")
    print(f"  Photometric: {photometric}, Samples: {samples}")
    print(f"  TransferSyntax: {ts}")
    print()

print(f"\nTotal: {len(all_info)} series, {sum(i['file_count'] for i in all_info)} files")
print(f"Unique study UIDs: {len(study_uids)}")
for u in study_uids:
    print(f"  {u}")

# Save as JSON for later use
with open(os.path.join(os.path.dirname(__file__), "real_dicom_info.json"), "w") as f:
    json.dump(all_info, f, indent=2)
print("\nSaved to real_dicom_info.json")
