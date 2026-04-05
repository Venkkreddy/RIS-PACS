"""
Split a source DICOM series across multiple seeded patients.

This intentionally breaks the original clinical grouping by redistributing
individual instances to different patients, as requested by the user.
To avoid mixed-patient collisions in viewers/indexers, each target patient
receives a new StudyInstanceUID / SeriesInstanceUID and fresh SOPInstanceUIDs.
"""

from __future__ import annotations

import json
from pathlib import Path

import pydicom
from pydicom.uid import generate_uid


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE_DIR = Path(r"c:\Users\Guna\Downloads\Anonymized_20260315 (1)\series-00005")
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "storage" / "manual-assigned" / "series-00005-split"

TARGET_PATIENTS = [
    {
        "patient_id": "MRN-IND-10001",
        "dicom_name": "Singh^Amit",
        "display_name": "Amit Singh",
        "dob": "19850314",
        "sex": "M",
    },
    {
        "patient_id": "MRN-IND-10002",
        "dicom_name": "Patel^Neha",
        "display_name": "Neha Patel",
        "dob": "19720822",
        "sex": "F",
    },
    {
        "patient_id": "MRN-IND-10003",
        "dicom_name": "Kumar^Ravi",
        "display_name": "Ravi Kumar",
        "dob": "19901105",
        "sex": "M",
    },
    {
        "patient_id": "MRN-IND-10004",
        "dicom_name": "Sharma^Pooja",
        "display_name": "Pooja Sharma",
        "dob": "19680130",
        "sex": "F",
    },
    {
        "patient_id": "MRN-IND-10005",
        "dicom_name": "Reddy^Suresh",
        "display_name": "Suresh Reddy",
        "dob": "19950618",
        "sex": "M",
    },
    {
        "patient_id": "MRN-IND-10006",
        "dicom_name": "Mehta^Anjali",
        "display_name": "Anjali Mehta",
        "dob": "20011201",
        "sex": "F",
    },
    {
        "patient_id": "MRN-IND-10007",
        "dicom_name": "Desai^Vikram",
        "display_name": "Vikram Desai",
        "dob": "19580410",
        "sex": "M",
    },
    {
        "patient_id": "MRN-IND-10008",
        "dicom_name": "Nair^Meena",
        "display_name": "Meena Nair",
        "dob": "19830927",
        "sex": "F",
    },
]


def main() -> None:
    source_dir = DEFAULT_SOURCE_DIR
    output_dir = DEFAULT_OUTPUT_DIR
    output_dir.mkdir(parents=True, exist_ok=True)

    source_files = sorted(source_dir.glob("image-*.dcm"))
    if not source_files:
        raise FileNotFoundError(f"No DICOM files found in {source_dir}")

    patient_studies = {}
    manifest = []

    for index, source_path in enumerate(source_files):
        patient = TARGET_PATIENTS[index % len(TARGET_PATIENTS)]
        patient_key = patient["patient_id"]
        patient_dir = output_dir / patient_key
        patient_dir.mkdir(parents=True, exist_ok=True)

        if patient_key not in patient_studies:
            patient_studies[patient_key] = {
                "study_uid": generate_uid(),
                "series_uid": generate_uid(),
            }

        reassigned_ids = patient_studies[patient_key]
        ds = pydicom.dcmread(source_path)

        ds.PatientName = patient["dicom_name"]
        ds.PatientID = patient["patient_id"]
        ds.PatientBirthDate = patient["dob"]
        ds.PatientSex = patient["sex"]
        ds.StudyInstanceUID = reassigned_ids["study_uid"]
        ds.SeriesInstanceUID = reassigned_ids["series_uid"]
        ds.SOPInstanceUID = generate_uid()
        ds.StudyID = f"SPLIT-{patient['patient_id'][-5:]}"
        ds.AccessionNumber = f"SPLIT-{index + 1:04d}"
        ds.StudyDescription = "Split assignment from Anonymized MRI series"
        ds.SeriesDescription = "series-00005 split subset"
        ds.InstanceNumber = index // len(TARGET_PATIENTS) + 1
        ds.file_meta.MediaStorageSOPInstanceUID = ds.SOPInstanceUID

        dest_name = f"{patient['patient_id']}-{source_path.name}"
        dest_path = patient_dir / dest_name
        ds.save_as(dest_path)

        manifest.append(
            {
                "source_file": str(source_path),
                "assigned_patient_id": patient["patient_id"],
                "assigned_patient_name": patient["display_name"],
                "output_file": str(dest_path),
                "study_uid": ds.StudyInstanceUID,
                "series_uid": ds.SeriesInstanceUID,
                "sop_instance_uid": ds.SOPInstanceUID,
                "instance_number": ds.InstanceNumber,
            }
        )

    manifest_path = output_dir / "assignment-map.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    summary = {}
    for item in manifest:
        patient_id = item["assigned_patient_id"]
        summary[patient_id] = summary.get(patient_id, 0) + 1

    print(f"Source files: {len(source_files)}")
    print(f"Output directory: {output_dir}")
    print(f"Manifest: {manifest_path}")
    print("Assignments:")
    for patient in TARGET_PATIENTS:
        patient_id = patient["patient_id"]
        count = summary.get(patient_id, 0)
        print(f"  {patient_id} - {patient['display_name']}: {count} file(s)")


if __name__ == "__main__":
    main()
