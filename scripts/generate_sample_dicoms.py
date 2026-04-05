"""
Generate realistic synthetic DICOM files for sample patients.
Each patient gets a multi-series study with anatomically plausible images.
Files are stored into the project's storage/ directory (shared with Dicoogle).

Study UIDs are pinned to match seedDevData.ts so OHIF can find them.
"""

import os
import math
import numpy as np
from pydicom.dataset import Dataset, FileDataset
from pydicom.uid import generate_uid, ExplicitVRLittleEndian

STORAGE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "storage")

SOP_CT = "1.2.840.10008.5.1.4.1.1.2"
SOP_MR = "1.2.840.10008.5.1.4.1.1.4"
SOP_CR = "1.2.840.10008.5.1.4.1.1.1"

SOP_MAP = {"CT": SOP_CT, "MR": SOP_MR, "CR": SOP_CR}

# ---------------------------------------------------------------------------
# Anatomy generators — each returns a uint16 numpy array (rows x cols)
# ---------------------------------------------------------------------------

def _ellipse(img, cy, cx, ry, rx, val, rows, cols):
    yy, xx = np.ogrid[:rows, :cols]
    mask = ((yy - cy) / max(ry, 1))**2 + ((xx - cx) / max(rx, 1))**2 <= 1.0
    img[mask] = np.clip(img[mask] + val, 0, 4095)

def _circle(img, cy, cx, r, val, rows, cols):
    _ellipse(img, cy, cx, r, r, val, rows, cols)

def _rect(img, y0, x0, y1, x1, val):
    img[y0:y1, x0:x1] = np.clip(img[y0:y1, x0:x1] + val, 0, 4095)

def _add_noise(img, rng, sigma=30):
    noise = rng.normal(0, sigma, img.shape)
    return np.clip(img.astype(np.float64) + noise, 0, 4095).astype(np.uint16)


def gen_ct_chest(rows, cols, slice_idx, total_slices, rng):
    """Axial CT chest slice: body outline, lungs, spine, heart, ribs."""
    img = np.zeros((rows, cols), dtype=np.float64)
    cy, cx = rows // 2, cols // 2

    body_ry, body_rx = int(rows * 0.42), int(cols * 0.38)
    _ellipse(img, cy, cx, body_ry, body_rx, 1000, rows, cols)

    mid_frac = slice_idx / max(total_slices - 1, 1)
    lung_size = 0.28 - 0.08 * abs(mid_frac - 0.5)
    lung_ry = int(rows * lung_size)
    lung_rx = int(cols * (lung_size * 0.7))
    lung_val = -800
    _ellipse(img, cy - int(rows * 0.02), cx - int(cols * 0.15), lung_ry, lung_rx, lung_val, rows, cols)
    _ellipse(img, cy - int(rows * 0.02), cx + int(cols * 0.15), lung_ry, lung_rx, lung_val, rows, cols)

    spine_r = int(rows * 0.06)
    _circle(img, cy + int(rows * 0.28), cx, spine_r, 1400, rows, cols)

    if 0.25 < mid_frac < 0.65:
        heart_ry = int(rows * 0.12 * (1 - abs(mid_frac - 0.45) * 3))
        heart_rx = int(cols * 0.10 * (1 - abs(mid_frac - 0.45) * 3))
        _ellipse(img, cy + int(rows * 0.05), cx - int(cols * 0.03), heart_ry, heart_rx, 400, rows, cols)

    n_ribs = 12
    for i in range(n_ribs):
        angle = math.pi * 0.15 + (math.pi * 0.7) * i / n_ribs
        rib_cy = cy + int(body_ry * 0.85 * math.cos(angle))
        rib_cx_l = cx - int(body_rx * 0.85 * math.sin(angle))
        rib_cx_r = cx + int(body_rx * 0.85 * math.sin(angle))
        _circle(img, rib_cy, rib_cx_l, 3, 1600, rows, cols)
        _circle(img, rib_cy, rib_cx_r, 3, 1600, rows, cols)

    aorta_r = int(rows * 0.025)
    _circle(img, cy + int(rows * 0.15), cx + int(cols * 0.02), aorta_r, 500, rows, cols)

    return _add_noise(np.clip(img, 0, 4095).astype(np.uint16), rng)


def gen_ct_abdomen(rows, cols, slice_idx, total_slices, rng):
    """Axial CT abdomen: body, liver, kidneys, spine, aorta, bowel."""
    img = np.zeros((rows, cols), dtype=np.float64)
    cy, cx = rows // 2, cols // 2
    frac = slice_idx / max(total_slices - 1, 1)

    body_ry, body_rx = int(rows * 0.44), int(cols * 0.40)
    _ellipse(img, cy, cx, body_ry, body_rx, 950, rows, cols)

    spine_r = int(rows * 0.055)
    _circle(img, cy + int(rows * 0.30), cx, spine_r, 1500, rows, cols)
    _rect(img, cy + int(rows*0.22), cx - 4, cy + int(rows*0.30), cx + 4, 1300)

    if frac < 0.6:
        liver_ry = int(rows * 0.18 * (1 - frac * 0.8))
        liver_rx = int(cols * 0.22 * (1 - frac * 0.5))
        _ellipse(img, cy - int(rows * 0.05), cx + int(cols * 0.08), liver_ry, liver_rx, 200, rows, cols)

    if 0.3 < frac < 0.7:
        k_ry, k_rx = int(rows * 0.08), int(cols * 0.045)
        _ellipse(img, cy + int(rows * 0.10), cx - int(cols * 0.28), k_ry, k_rx, 250, rows, cols)
        _ellipse(img, cy + int(rows * 0.10), cx + int(cols * 0.28), k_ry, k_rx, 250, rows, cols)

    aorta_r = int(rows * 0.03)
    _circle(img, cy + int(rows * 0.20), cx - int(cols * 0.01), aorta_r, 550, rows, cols)

    for bx in range(-3, 4):
        for by in range(-2, 2):
            bcx = cx + int(cols * 0.08 * bx) + rng.randint(-5, 5)
            bcy = cy + int(rows * 0.05 * by) + rng.randint(-5, 5)
            br = rng.randint(6, 14)
            _circle(img, bcy, bcx, br, rng.randint(-100, 100), rows, cols)

    return _add_noise(np.clip(img, 0, 4095).astype(np.uint16), rng, sigma=35)


def gen_mr_brain(rows, cols, slice_idx, total_slices, rng):
    """Axial MRI brain: skull, gray/white matter, ventricles, falx."""
    img = np.zeros((rows, cols), dtype=np.float64)
    cy, cx = rows // 2, cols // 2
    frac = slice_idx / max(total_slices - 1, 1)

    size_scale = 1.0 - 2.0 * abs(frac - 0.45)**1.5
    if size_scale < 0.2:
        size_scale = 0.2

    skull_ry = int(rows * 0.42 * size_scale)
    skull_rx = int(cols * 0.38 * size_scale)
    _ellipse(img, cy, cx, skull_ry, skull_rx, 800, rows, cols)

    brain_ry = int(skull_ry * 0.88)
    brain_rx = int(skull_rx * 0.88)
    _ellipse(img, cy, cx, brain_ry, brain_rx, 600, rows, cols)

    wm_ry = int(brain_ry * 0.65)
    wm_rx = int(brain_rx * 0.65)
    _ellipse(img, cy, cx, wm_ry, wm_rx, 300, rows, cols)

    if 0.3 < frac < 0.6:
        v_scale = 1.0 - 3.0 * abs(frac - 0.45)
        v_ry = int(rows * 0.04 * v_scale)
        v_rx = int(cols * 0.06 * v_scale)
        _ellipse(img, cy, cx - int(cols * 0.05), v_ry, v_rx, -400, rows, cols)
        _ellipse(img, cy, cx + int(cols * 0.05), v_ry, v_rx, -400, rows, cols)

    _rect(img, cy - brain_ry, cx - 1, cy + brain_ry, cx + 1, 200)

    n_gyri = 18
    for i in range(n_gyri):
        angle = 2 * math.pi * i / n_gyri
        gy = cy + int(brain_ry * 0.82 * math.sin(angle))
        gx = cx + int(brain_rx * 0.82 * math.cos(angle))
        _circle(img, gy, gx, rng.randint(3, 7), rng.randint(50, 200), rows, cols)

    return _add_noise(np.clip(img, 0, 4095).astype(np.uint16), rng, sigma=25)


def gen_mr_spine(rows, cols, slice_idx, total_slices, rng):
    """Sagittal MRI lumbar spine: vertebral bodies, discs, spinal canal, CSF."""
    img = np.zeros((rows, cols), dtype=np.float64)
    cy, cx = rows // 2, cols // 2
    frac = slice_idx / max(total_slices - 1, 1)

    body_ry, body_rx = int(rows * 0.45), int(cols * 0.30)
    _ellipse(img, cy, cx, body_ry, body_rx, 500, rows, cols)

    n_vert = 5
    vert_h = int(rows * 0.12)
    vert_w = int(cols * 0.16)
    gap = int(rows * 0.025)
    start_y = cy - int(rows * 0.35)

    for v in range(n_vert):
        vy = start_y + v * (vert_h + gap)
        _rect(img, vy, cx - vert_w // 2, vy + vert_h, cx + vert_w // 2, 800)
        if v < n_vert - 1:
            disc_y = vy + vert_h
            _rect(img, disc_y, cx - vert_w // 2 + 4, disc_y + gap, cx + vert_w // 2 - 4, 1200)

    canal_x = cx + vert_w // 2 + 4
    canal_w = int(cols * 0.03)
    _rect(img, start_y, canal_x, start_y + n_vert * (vert_h + gap), canal_x + canal_w, 1400)

    for v in range(n_vert):
        vy_center = start_y + v * (vert_h + gap) + vert_h // 2
        sp_len = int(cols * 0.10)
        _rect(img, vy_center - 3, canal_x + canal_w, vy_center + 3, canal_x + canal_w + sp_len, 600)

    if 0.3 < frac < 0.7:
        psoas_ry = int(rows * 0.15)
        psoas_rx = int(cols * 0.06)
        _ellipse(img, cy + int(rows * 0.1), cx - int(cols * 0.20), psoas_ry, psoas_rx, 400, rows, cols)
        _ellipse(img, cy + int(rows * 0.1), cx + int(cols * 0.25), psoas_ry, psoas_rx, 400, rows, cols)

    return _add_noise(np.clip(img, 0, 4095).astype(np.uint16), rng, sigma=20)


def gen_xr_chest(rows, cols, view_idx, rng):
    """PA or Lateral chest X-ray: lungs, heart, ribs, diaphragm, spine."""
    img = np.full((rows, cols), 200, dtype=np.float64)
    cy, cx = rows // 2, cols // 2
    is_lateral = (view_idx == 1)

    if not is_lateral:
        lung_ry = int(rows * 0.30)
        lung_rx = int(cols * 0.18)
        _ellipse(img, cy - int(rows*0.05), cx - int(cols*0.20), lung_ry, lung_rx, 2200, rows, cols)
        _ellipse(img, cy - int(rows*0.05), cx + int(cols*0.20), lung_ry, lung_rx, 2200, rows, cols)

        heart_ry = int(rows * 0.16)
        heart_rx = int(cols * 0.14)
        _ellipse(img, cy + int(rows*0.08), cx - int(cols*0.04), heart_ry, heart_rx, -800, rows, cols)

        for i in range(10):
            rib_y = cy - int(rows*0.28) + int(rows*0.06*i)
            for side in [-1, 1]:
                for rx_off in range(0, int(cols*0.30), 4):
                    ry_off = int(rows*0.01 * math.sin(rx_off * 0.05 + i * 0.5))
                    py = rib_y + ry_off
                    px = cx + side * rx_off
                    if 0 <= py < rows and 0 <= px < cols:
                        img[max(0,py-1):min(rows,py+2), px] = np.clip(
                            img[max(0,py-1):min(rows,py+2), px] - 400, 0, 4095)

        diaphragm_y = cy + int(rows * 0.28)
        for x in range(cols):
            curve = int(rows * 0.04 * math.sin(math.pi * x / cols))
            y_start = diaphragm_y + curve
            if y_start < rows:
                img[y_start:, x] = np.clip(img[y_start:, x] * 0.3, 0, 4095)

        _rect(img, cy - int(rows*0.35), cx - 3, cy + int(rows*0.35), cx + 3, -300)
    else:
        lung_ry = int(rows * 0.30)
        lung_rx = int(cols * 0.28)
        _ellipse(img, cy - int(rows*0.05), cx, lung_ry, lung_rx, 2000, rows, cols)
        heart_ry = int(rows * 0.15)
        heart_rx = int(cols * 0.12)
        _ellipse(img, cy + int(rows*0.05), cx - int(cols*0.10), heart_ry, heart_rx, -600, rows, cols)
        spine_w = int(cols * 0.08)
        _rect(img, 0, cx + int(cols*0.15), rows, cx + int(cols*0.15) + spine_w, -500)

    return _add_noise(np.clip(img, 0, 4095).astype(np.uint16), rng, sigma=40)


def gen_xr_knee(rows, cols, view_idx, rng):
    """AP, Lateral, or Skyline knee X-ray: femur, tibia, patella, joint space."""
    img = np.full((rows, cols), 300, dtype=np.float64)
    cy, cx = rows // 2, cols // 2

    if view_idx == 0:
        femur_w = int(cols * 0.14)
        _rect(img, 0, cx - femur_w, cy - int(rows*0.05), cx + femur_w, 2500)
        cond_ry = int(rows * 0.10)
        cond_rx = int(cols * 0.08)
        _ellipse(img, cy, cx - int(cols*0.07), cond_ry, cond_rx, 2800, rows, cols)
        _ellipse(img, cy, cx + int(cols*0.07), cond_ry, cond_rx, 2800, rows, cols)
        _rect(img, cy + int(rows*0.02), cx - int(cols*0.16), cy + int(rows*0.04), cx + int(cols*0.16), 500)
        tibia_w = int(cols * 0.13)
        _rect(img, cy + int(rows*0.04), cx - tibia_w, rows, cx + tibia_w, 2400)
        _circle(img, cy - int(rows*0.02), cx, int(rows*0.06), 1800, rows, cols)
        fib_w = int(cols * 0.04)
        _rect(img, cy + int(rows*0.08), cx + int(cols*0.20), rows, cx + int(cols*0.20) + fib_w, 2200)
    elif view_idx == 1:
        femur_w = int(cols * 0.16)
        _rect(img, 0, cx - femur_w//2, cy, cx + femur_w//2, 2600)
        _ellipse(img, cy, cx, int(rows*0.10), int(cols*0.12), 2800, rows, cols)
        _rect(img, cy + int(rows*0.03), cx - femur_w//2, rows, cx + femur_w//2, 2400)
        _ellipse(img, cy - int(rows*0.05), cx - int(cols*0.15), int(rows*0.06), int(cols*0.04), 2500, rows, cols)
    else:
        _ellipse(img, cy, cx, int(rows*0.25), int(cols*0.30), 2600, rows, cols)
        _ellipse(img, cy, cx, int(rows*0.12), int(cols*0.15), 1200, rows, cols)

    return _add_noise(np.clip(img, 0, 4095).astype(np.uint16), rng, sigma=45)


# ---------------------------------------------------------------------------
# Generator dispatch
# ---------------------------------------------------------------------------

GENERATORS = {
    ("CT", "CHEST"):   gen_ct_chest,
    ("CT", "ABDOMEN"): gen_ct_abdomen,
    ("MR", "BRAIN"):   gen_mr_brain,
    ("MR", "LSPINE"):  gen_mr_spine,
    ("CR", "CHEST"):   gen_xr_chest,
    ("CR", "KNEE"):    gen_xr_knee,
}

# ---------------------------------------------------------------------------
# Patient definitions with multi-series studies
# ---------------------------------------------------------------------------

PATIENTS = [
    {
        "name": "Singh^Amit", "id": "MRN-IND-10001",
        "dob": "19850314", "sex": "M", "modality": "CT",
        "body_part": "CHEST", "description": "CT Chest w/ contrast",
        "institution": "Apollo Hospitals, Delhi", "study_date": "20260314",
        "study_uid": "1.2.826.0.1.3680043.8.498.25078228286114488662691612626295400838",
        "series": [
            {"desc": "Axial Soft Tissue", "num": 25, "wc": 40, "ww": 400},
            {"desc": "Axial Lung", "num": 25, "wc": -600, "ww": 1500},
            {"desc": "Axial Bone", "num": 25, "wc": 400, "ww": 1800},
        ],
    },
    {
        "name": "Patel^Neha", "id": "MRN-IND-10002",
        "dob": "19720822", "sex": "F", "modality": "MR",
        "body_part": "LSPINE", "description": "MRI Lumbar Spine w/o contrast",
        "institution": "Fortis Hospital, Ahmedabad", "study_date": "20260313",
        "study_uid": "1.2.826.0.1.3680043.8.498.33671051009637181933407679879111779118",
        "series": [
            {"desc": "Sag T1", "num": 15, "wc": 800, "ww": 1600},
            {"desc": "Sag T2", "num": 15, "wc": 1000, "ww": 2000},
            {"desc": "Axial T2", "num": 20, "wc": 1000, "ww": 2000},
        ],
    },
    {
        "name": "Kumar^Ravi", "id": "MRN-IND-10003",
        "dob": "19901105", "sex": "M", "modality": "MR",
        "body_part": "BRAIN", "description": "MRI Brain w/ & w/o contrast",
        "institution": "Manipal Hospital, Bangalore", "study_date": "20260315",
        "study_uid": "1.2.826.0.1.3680043.8.498.7650919683101803526004408509422926761",
        "series": [
            {"desc": "Axial T1", "num": 20, "wc": 700, "ww": 1400},
            {"desc": "Axial T2 FLAIR", "num": 20, "wc": 900, "ww": 1800},
            {"desc": "Axial DWI", "num": 20, "wc": 600, "ww": 1200},
            {"desc": "Axial T1 Post-Gad", "num": 20, "wc": 750, "ww": 1500},
        ],
    },
    {
        "name": "Sharma^Pooja", "id": "MRN-IND-10004",
        "dob": "19680130", "sex": "F", "modality": "CT",
        "body_part": "ABDOMEN", "description": "CT Abdomen / Pelvis",
        "institution": "Tata Memorial Hospital, Mumbai", "study_date": "20260312",
        "study_uid": "1.2.826.0.1.3680043.8.498.12452783231387736129149000279779292065",
        "series": [
            {"desc": "Axial Soft Tissue", "num": 30, "wc": 40, "ww": 400},
            {"desc": "Axial Bone", "num": 30, "wc": 400, "ww": 1800},
            {"desc": "Coronal Reformat", "num": 20, "wc": 40, "ww": 400},
        ],
    },
    {
        "name": "Reddy^Suresh", "id": "MRN-IND-10005",
        "dob": "19950618", "sex": "M", "modality": "CR",
        "body_part": "KNEE", "description": "X-Ray Right Knee (3 views)",
        "institution": "Apollo Diagnostics, Chennai", "study_date": "20260314",
        "study_uid": "1.2.826.0.1.3680043.8.498.38295520635455189473067266483083688997",
        "series": [
            {"desc": "AP View", "num": 1, "wc": 2048, "ww": 4096},
            {"desc": "Lateral View", "num": 1, "wc": 2048, "ww": 4096},
            {"desc": "Skyline View", "num": 1, "wc": 2048, "ww": 4096},
        ],
    },
    {
        "name": "Mehta^Anjali", "id": "MRN-IND-10006",
        "dob": "20011201", "sex": "F", "modality": "CR",
        "body_part": "CHEST", "description": "Chest X-Ray PA & Lateral",
        "institution": "Medanta, Kolkata", "study_date": "20260311",
        "study_uid": "1.2.826.0.1.3680043.8.498.30846453286534628577940689408376587200",
        "series": [
            {"desc": "PA View", "num": 1, "wc": 2048, "ww": 4096},
            {"desc": "Lateral View", "num": 1, "wc": 2048, "ww": 4096},
        ],
    },
]


def create_dicom(filepath, patient, study_uid, series_uid, sop_uid,
                 series_num, series_desc, instance_num, total_in_series,
                 pixel_data, rows, cols, wc, ww):
    """Write a single DICOM file with complete metadata."""
    mod = patient["modality"]
    sop_class = SOP_MAP[mod]

    file_meta = Dataset()
    file_meta.MediaStorageSOPClassUID = sop_class
    file_meta.MediaStorageSOPInstanceUID = sop_uid
    file_meta.TransferSyntaxUID = ExplicitVRLittleEndian

    ds = FileDataset(filepath, {}, file_meta=file_meta, preamble=b"\x00" * 128)

    ds.PatientName = patient["name"]
    ds.PatientID = patient["id"]
    ds.PatientBirthDate = patient["dob"]
    ds.PatientSex = patient["sex"]

    ds.StudyInstanceUID = study_uid
    ds.StudyDate = patient["study_date"]
    ds.StudyTime = "090000"
    ds.StudyDescription = patient["description"]
    ds.StudyID = f"STUDY-{patient['id']}"
    ds.AccessionNumber = f"ACC-{patient['id'][-5:]}"
    ds.ReferringPhysicianName = "Dr. Priya Menon"
    ds.InstitutionName = patient["institution"]

    ds.SeriesInstanceUID = series_uid
    ds.SeriesNumber = series_num
    ds.SeriesDescription = series_desc
    ds.Modality = mod
    ds.BodyPartExamined = patient["body_part"]

    ds.SOPClassUID = sop_class
    ds.SOPInstanceUID = sop_uid
    ds.InstanceNumber = instance_num

    ds.Rows = rows
    ds.Columns = cols
    ds.BitsAllocated = 16
    ds.BitsStored = 12
    ds.HighBit = 11
    ds.PixelRepresentation = 0
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.PixelData = pixel_data

    ds.WindowCenter = str(wc)
    ds.WindowWidth = str(ww)

    if mod == "CT":
        ds.RescaleIntercept = "-1024"
        ds.RescaleSlope = "1"
        ds.KVP = "120"
        ds.SliceThickness = "2.5"
        ds.ImagePositionPatient = [0, 0, float(instance_num) * 2.5]
        ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
        ds.PixelSpacing = [0.75, 0.75]
    elif mod == "MR":
        ds.SliceThickness = "4.0"
        ds.ImagePositionPatient = [0, 0, float(instance_num) * 4.0]
        ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
        ds.PixelSpacing = [0.5, 0.5]
        ds.MagneticFieldStrength = "1.5"
        ds.RepetitionTime = "500" if "T1" in series_desc else "4000"
        ds.EchoTime = "15" if "T1" in series_desc else "100"
    elif mod == "CR":
        ds.PixelSpacing = [0.15, 0.15]
        ds.ImagerPixelSpacing = [0.15, 0.15]

    ds.ImageType = ["ORIGINAL", "PRIMARY", "AXIAL"]
    ds.SpecificCharacterSet = "ISO_IR 100"
    ds.ContentDate = patient["study_date"]
    ds.ContentTime = f"09{series_num:02d}{instance_num:02d}"

    ds.save_as(filepath)


def main():
    os.makedirs(STORAGE_DIR, exist_ok=True)

    total_files = 0

    for patient in PATIENTS:
        study_uid = patient["study_uid"]
        mod = patient["modality"]
        bp = patient["body_part"]
        gen_fn = GENERATORS.get((mod, bp))

        print(f"\n{'='*60}")
        print(f"Patient: {patient['name']} ({patient['id']})")
        print(f"  Study:    {patient['description']}")
        print(f"  UID:      {study_uid}")
        print(f"  Series:   {len(patient['series'])}")

        img_size = 512 if mod in ("CT", "MR") else 1024

        for s_idx, series in enumerate(patient["series"]):
            series_uid = generate_uid()
            series_num = s_idx + 1
            n = series["num"]

            print(f"  Series {series_num}: {series['desc']} ({n} images, {img_size}x{img_size})")

            for i in range(1, n + 1):
                sop_uid = generate_uid()
                fname = f"{patient['id']}-S{series_num}-{i:03d}.dcm"
                fpath = os.path.join(STORAGE_DIR, fname)

                rng = np.random.RandomState(hash((patient["id"], s_idx, i)) % 2**31)

                if gen_fn:
                    if mod == "CR":
                        pixels = gen_fn(img_size, img_size, s_idx, rng)
                    else:
                        pixels = gen_fn(img_size, img_size, i - 1, n, rng)
                else:
                    pixels = np.random.RandomState(i).randint(0, 2000, (img_size, img_size), dtype=np.uint16)

                create_dicom(
                    filepath=fpath, patient=patient,
                    study_uid=study_uid, series_uid=series_uid,
                    sop_uid=sop_uid, series_num=series_num,
                    series_desc=series["desc"],
                    instance_num=i, total_in_series=n,
                    pixel_data=pixels.tobytes(),
                    rows=img_size, cols=img_size,
                    wc=series["wc"], ww=series["ww"],
                )
                total_files += 1

    print(f"\n{'='*60}")
    print(f"Generated {total_files} DICOM files in {STORAGE_DIR}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
