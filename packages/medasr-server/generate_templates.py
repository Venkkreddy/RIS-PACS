"""
Generate all radiology report templates for the RAG knowledge base.
Run this script ONCE to populate the report_templates/ directory.
Usage: python generate_templates.py
"""
import json
import os

TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), "report_templates")
os.makedirs(TEMPLATES_DIR, exist_ok=True)

SIGNATURE_SECTION = {
    "key": "signature",
    "title": "Signature",
    "is_signature": True,
    "default": ""
}

TEMPLATES = {

# ─────────────────────────────────────────────────────────────────────────────
# X-RAY TEMPLATES
# ─────────────────────────────────────────────────────────────────────────────

"chest_xray": {
    "id": "chest_xray", "name": "Chest X-Ray",
    "modality": ["CR", "DX", "XR"], "body_part": ["CHEST"],
    "sections": [
        {"key": "clinical_history", "title": "Clinical History", "default": ""},
        {"key": "technique", "title": "Technique", "default": "PA and lateral views of the chest were obtained."},
        {"key": "findings", "title": "Findings",
         "subsections": ["Lungs", "Pleura", "Heart", "Mediastinum", "Hilum", "Diaphragm", "Bones", "Soft Tissues"],
         "normal_text": "The lungs are clear bilaterally with no evidence of consolidation, collapse or pleural effusion. The heart size is within normal limits with cardiothoracic ratio less than 0.5. The mediastinum is central and not widened. Both hila appear normal in size and density. The hemidiaphragms are intact. No acute bony abnormality is identified. The visualized soft tissues are unremarkable.",
         "common_findings": ["Right-sided pleural effusion", "Left-sided pleural effusion", "Right lower lobe consolidation", "Left lower lobe consolidation", "Cardiomegaly", "Pneumothorax", "Increased interstitial markings", "Pulmonary edema", "Hilar lymphadenopathy", "Mediastinal widening"],
         "medical_terms": ["consolidation", "atelectasis", "pneumothorax", "pleural effusion", "cardiomegaly", "cardiothoracic ratio", "mediastinum", "hilum", "hemidiaphragm", "interstitial", "reticulonodular", "infiltrate", "opacity", "haziness"]},
        {"key": "impression", "title": "Impression", "normal_text": "Normal chest radiograph. No acute cardiopulmonary abnormality."},
        {"key": "recommendation", "title": "Recommendation", "default": ""},
        SIGNATURE_SECTION
    ],
    "few_shot_normal": {"input": "lungs clear, no effusion, heart normal, mediastinum normal", "output": {"technique": "PA and lateral views of the chest were obtained.", "findings": "The lungs are clear bilaterally with no evidence of consolidation, collapse or pleural effusion. The heart size is within normal limits with cardiothoracic ratio less than 0.5. The mediastinum is central and not widened. Both hila appear normal. The hemidiaphragms are intact. No acute bony abnormality is identified.", "impression": "Normal chest radiograph. No acute cardiopulmonary abnormality."}},
    "few_shot_abnormal": {"input": "right lower lobe consolidation, small right pleural effusion", "output": {"findings": "There is consolidation seen in the right lower lobe. A small right-sided pleural effusion is noted. The heart size is within normal limits. The mediastinum is not widened. The left lung is clear.", "impression": "1. Right lower lobe consolidation — likely infective/inflammatory in etiology.\n2. Small right-sided pleural effusion.\nClinical correlation recommended. Follow-up chest radiograph after treatment advised."}},
    "measurement_hints": ["cardiothoracic ratio", "CTR", "cm", "mm"]
},

"knee_xray": {
    "id": "knee_xray", "name": "Knee X-Ray",
    "modality": ["CR", "DX", "XR"], "body_part": ["KNEE"],
    "sections": [
        {"key": "clinical_history", "title": "Clinical History", "default": ""},
        {"key": "technique", "title": "Technique", "default": "AP and lateral views of the {laterality} knee were obtained. {skyline}"},
        {"key": "findings", "title": "Findings",
         "subsections": ["Joint Space", "Bony Structures", "Soft Tissues", "Alignment"],
         "normal_text": "The joint space is maintained bilaterally. No significant narrowing of the medial or lateral compartment. The bony margins are well-defined with no osteophytic lipping. No fracture or dislocation is identified. The alignment is normal. The visualized soft tissues are unremarkable.",
         "common_findings": ["Medial compartment joint space narrowing", "Lateral compartment narrowing", "Osteophytic lipping at tibial plateaus", "Osteophytes at femoral condyles", "Periarticular osteopenia", "Soft tissue swelling", "Effusion", "Chondrocalcinosis", "Patella alta/baja"],
         "medical_terms": ["joint space", "osteophyte", "subchondral", "chondrocalcinosis", "tibial plateau", "femoral condyle", "patella", "meniscal", "cruciate", "valgus", "varus", "effusion", "osteoarthritis"]},
        {"key": "impression", "title": "Impression", "normal_text": "No significant radiological abnormality of the {laterality} knee."},
        {"key": "recommendation", "title": "Recommendation", "default": ""},
        SIGNATURE_SECTION
    ],
    "few_shot_normal": {"input": "knee joint space normal, no osteophytes, alignment normal", "output": {"findings": "The joint space is maintained bilaterally. No significant narrowing of the medial or lateral compartment is seen. The bony margins are well-defined with no osteophytic lipping. No fracture or dislocation is identified. Alignment is normal. Visualized soft tissues are unremarkable.", "impression": "No significant radiological abnormality of the knee."}},
    "few_shot_abnormal": {"input": "medial joint space narrowing, osteophytes, soft tissue swelling", "output": {"findings": "There is narrowing of the medial compartment joint space. Osteophytic lipping is seen at the medial tibial plateau and medial femoral condyle. The lateral compartment is relatively preserved. There is periarticular soft tissue swelling. No acute fracture is identified.", "impression": "Medial compartment osteoarthritis of the knee. Clinical correlation advised."}},
    "measurement_hints": ["joint space", "mm", "cm"]
},

"ankle_xray": {
    "id": "ankle_xray", "name": "Ankle X-Ray",
    "modality": ["CR", "DX", "XR"], "body_part": ["ANKLE"],
    "sections": [
        {"key": "clinical_history", "title": "Clinical History", "default": ""},
        {"key": "technique", "title": "Technique", "default": "AP, lateral and mortise views of the {laterality} ankle were obtained."},
        {"key": "findings", "title": "Findings",
         "subsections": ["Bones", "Joints", "Soft Tissues", "Alignment"],
         "normal_text": "No fracture or dislocation is identified. The tibiotalar and subtalar joint spaces are maintained. The medial, lateral and posterior malleoli are intact. The mortise is symmetrical. No periarticular soft tissue swelling is identified. Alignment is normal.",
         "common_findings": ["Fibula fracture", "Medial malleolus fracture", "Posterior malleolus fracture", "Bimalleolar fracture", "Trimalleolar fracture", "Osteochondral defect", "Periarticular soft tissue swelling", "Joint effusion", "Ankle instability signs"],
         "medical_terms": ["tibiotalar", "subtalar", "malleolus", "mortise", "fibula", "tibia", "osteochondral", "ligament", "tendon", "effusion", "displaced", "comminuted"]},
        {"key": "impression", "title": "Impression", "normal_text": "No fracture or dislocation of the {laterality} ankle."},
        {"key": "recommendation", "title": "Recommendation", "default": ""},
        SIGNATURE_SECTION
    ],
    "few_shot_normal": {"input": "no fracture, joint space normal, mortise symmetric", "output": {"findings": "No fracture or dislocation is identified. The tibiotalar and subtalar joint spaces are maintained. The mortise is symmetrical. The medial, lateral and posterior malleoli are intact. No periarticular soft tissue swelling. Alignment is normal.", "impression": "No fracture or dislocation of the ankle."}},
    "few_shot_abnormal": {"input": "distal fibula fracture, soft tissue swelling, mortise widening", "output": {"findings": "There is a fracture of the distal fibula at the level of the ankle joint. The fracture appears undisplaced. Mortise widening is noted, raising concern for syndesmotic injury. Periarticular soft tissue swelling is present.", "impression": "Distal fibula fracture with possible syndesmotic injury. Orthopedic review and further assessment recommended."}},
    "measurement_hints": ["mm", "cm", "displaced", "angulated"]
},

"foot_xray": {
    "id": "foot_xray", "name": "Foot X-Ray",
    "modality": ["CR", "DX", "XR"], "body_part": ["FOOT"],
    "sections": [
        {"key": "clinical_history", "title": "Clinical History", "default": ""},
        {"key": "technique", "title": "Technique", "default": "AP, lateral and oblique views of the {laterality} foot were obtained."},
        {"key": "findings", "title": "Findings",
         "subsections": ["Bones", "Joints", "Soft Tissues"],
         "normal_text": "No fracture or dislocation is identified. The tarsal, metatarsal and phalangeal bones appear intact. The joint spaces are maintained. No periarticular soft tissue swelling is identified. The alignment of the foot is normal.",
         "common_findings": ["Metatarsal fracture", "Calcaneal fracture", "Navicular fracture", "Fifth metatarsal fracture", "Toe phalangeal fracture", "Plantar fasciitis calcification", "Hallux valgus", "Joint space narrowing"],
         "medical_terms": ["calcaneus", "talus", "navicular", "cuboid", "cuneiform", "metatarsal", "phalanx", "hallux valgus", "plantar fasciitis", "lisfranc", "jones fracture"]},
        {"key": "impression", "title": "Impression", "normal_text": "No fracture or significant bony abnormality of the {laterality} foot."},
        {"key": "recommendation", "title": "Recommendation", "default": ""},
        SIGNATURE_SECTION
    ],
    "few_shot_normal": {"input": "foot bones intact, no fracture, joints normal", "output": {"findings": "No fracture or dislocation is identified. The tarsal, metatarsal and phalangeal bones appear intact. The joint spaces are maintained. No periarticular soft tissue swelling. Alignment of the foot is normal.", "impression": "No fracture or significant bony abnormality of the foot."}},
    "measurement_hints": ["mm", "cm"]
},

"wrist_xray": {
    "id": "wrist_xray", "name": "Wrist X-Ray",
    "modality": ["CR", "DX", "XR"], "body_part": ["WRIST"],
    "sections": [
        {"key": "clinical_history", "title": "Clinical History", "default": ""},
        {"key": "technique", "title": "Technique", "default": "PA and lateral views of the {laterality} wrist were obtained."},
        {"key": "findings", "title": "Findings",
         "subsections": ["Distal Radius/Ulna", "Carpal Bones", "Joints", "Soft Tissues"],
         "normal_text": "No fracture or dislocation is identified. The distal radius and ulna are intact. The carpal bones appear normal in size, shape and alignment. The radiocarpal and intercarpal joint spaces are maintained. No periarticular soft tissue swelling is identified.",
         "common_findings": ["Colles fracture", "Smith fracture", "Scaphoid fracture", "Distal radial fracture", "Barton fracture", "Scapholunate dissociation", "Carpal bone fracture", "Periarticular osteopenia", "Soft tissue swelling"],
         "medical_terms": ["distal radius", "ulna", "scaphoid", "lunate", "triquetrum", "pisiform", "trapezium", "trapezoid", "capitate", "hamate", "radiocarpal", "scapholunate", "Colles", "Smith"]},
        {"key": "impression", "title": "Impression", "normal_text": "No fracture or significant radiological abnormality of the {laterality} wrist."},
        {"key": "recommendation", "title": "Recommendation", "default": ""},
        SIGNATURE_SECTION
    ],
    "few_shot_normal": {"input": "wrist bones intact, joints normal, no fracture", "output": {"findings": "No fracture or dislocation is identified. The distal radius and ulna are intact. The carpal bones appear normal in size, shape and alignment. The radiocarpal and intercarpal joint spaces are maintained. No periarticular soft tissue swelling.", "impression": "No fracture or significant radiological abnormality of the wrist."}},
    "measurement_hints": ["mm", "cm", "angulation", "displacement"]
},

"hand_xray": {
    "id": "hand_xray", "name": "Hand X-Ray",
    "modality": ["CR", "DX", "XR"], "body_part": ["HAND"],
    "sections": [
        {"key": "clinical_history", "title": "Clinical History", "default": ""},
        {"key": "technique", "title": "Technique", "default": "PA and oblique views of the {laterality} hand were obtained."},
        {"key": "findings", "title": "Findings",
         "subsections": ["Metacarpals", "Phalanges", "Joints", "Soft Tissues"],
         "normal_text": "The metacarpal and phalangeal bones appear intact. No fracture or dislocation is identified. The interphalangeal and metacarpophalangeal joint spaces are maintained. No periarticular soft tissue swelling or calcification is identified.",
         "common_findings": ["Metacarpal fracture", "Phalangeal fracture", "Bennett fracture", "Boxer fracture", "Mallet finger", "Interphalangeal dislocation", "Rheumatoid arthritis changes", "Osteoarthritis"],
         "medical_terms": ["metacarpal", "phalanx", "proximal", "middle", "distal", "PIP", "DIP", "MCP", "interphalangeal", "metacarpophalangeal", "Bennett", "boxer fracture"]},
        {"key": "impression", "title": "Impression", "normal_text": "No fracture or significant bony abnormality of the {laterality} hand."},
        {"key": "recommendation", "title": "Recommendation", "default": ""},
        SIGNATURE_SECTION
    ],
    "few_shot_normal": {"input": "hand bones intact, no fracture, joints normal", "output": {"findings": "The metacarpal and phalangeal bones appear intact. No fracture or dislocation is identified. The interphalangeal and metacarpophalangeal joint spaces are maintained. No periarticular soft tissue swelling.", "impression": "No fracture or significant bony abnormality of the hand."}},
    "measurement_hints": ["mm", "cm"]
},

"shoulder_xray": {
    "id": "shoulder_xray", "name": "Shoulder X-Ray",
    "modality": ["CR", "DX", "XR"], "body_part": ["SHOULDER"],
    "sections": [
        {"key": "clinical_history", "title": "Clinical History", "default": ""},
        {"key": "technique", "title": "Technique", "default": "AP and axial views of the {laterality} shoulder were obtained."},
        {"key": "findings", "title": "Findings",
         "subsections": ["Glenohumeral Joint", "Acromioclavicular Joint", "Bones", "Soft Tissues"],
         "normal_text": "The glenohumeral joint is normally located without dislocation. The joint space is maintained. The acromioclavicular joint is normal. The humeral head, glenoid, acromion, coracoid and clavicle are intact. No fracture is identified. No periarticular calcification is seen. The visualized soft tissues are normal.",
         "common_findings": ["Anterior shoulder dislocation", "Posterior dislocation", "Clavicle fracture", "Proximal humerus fracture", "Acromioclavicular separation", "Calcific tendinitis", "Hill-Sachs lesion", "Bankart lesion", "Subacromial spur"],
         "medical_terms": ["glenohumeral", "acromioclavicular", "acromion", "coracoid", "glenoid", "humeral head", "rotator cuff", "subacromial", "calcific tendinitis", "Hill-Sachs", "Bankart"]},
        {"key": "impression", "title": "Impression", "normal_text": "No fracture or dislocation of the {laterality} shoulder."},
        {"key": "recommendation", "title": "Recommendation", "default": ""},
        SIGNATURE_SECTION
    ],
    "few_shot_normal": {"input": "shoulder joint normal, no dislocation, clavicle intact", "output": {"findings": "The glenohumeral joint is normally located without dislocation. The joint space is maintained. The acromioclavicular joint is normal. The humeral head, glenoid, acromion and clavicle are intact. No fracture identified. No calcification.", "impression": "No fracture or dislocation of the shoulder."}},
    "measurement_hints": ["mm", "cm", "acromioclavicular distance"]
},

"elbow_xray": {
    "id": "elbow_xray", "name": "Elbow X-Ray",
    "modality": ["CR", "DX", "XR"], "body_part": ["ELBOW"],
    "sections": [
        {"key": "clinical_history", "title": "Clinical History", "default": ""},
        {"key": "technique", "title": "Technique", "default": "AP and lateral views of the {laterality} elbow were obtained."},
        {"key": "findings", "title": "Findings",
         "subsections": ["Bones", "Joint", "Soft Tissues"],
         "normal_text": "No fracture or dislocation is identified. The distal humerus, radial head and proximal ulna appear intact. The elbow joint space is maintained. The anterior fat pad is not displaced. No posterior fat pad sign is identified. No periarticular soft tissue swelling.",
         "common_findings": ["Radial head fracture", "Coronoid fracture", "Lateral condyle fracture", "Supracondylar fracture", "Posterior fat pad sign", "Elbow dislocation", "Olecranon fracture"],
         "medical_terms": ["radial head", "coronoid", "olecranon", "lateral condyle", "medial epicondyle", "supracondylar", "fat pad", "anterior fat pad", "posterior fat pad", "radiocapitellar", "ulnohumeral"]},
        {"key": "impression", "title": "Impression", "normal_text": "No fracture or dislocation of the {laterality} elbow."},
        {"key": "recommendation", "title": "Recommendation", "default": ""},
        SIGNATURE_SECTION
    ],
    "few_shot_normal": {"input": "elbow bones intact, no fracture, fat pad normal", "output": {"findings": "No fracture or dislocation is identified. The distal humerus, radial head and proximal ulna appear intact. The elbow joint space is maintained. The anterior fat pad is not displaced. No posterior fat pad sign. No periarticular soft tissue swelling.", "impression": "No fracture or dislocation of the elbow."}},
    "measurement_hints": ["mm", "cm"]
},

"hip_xray": {
    "id": "hip_xray", "name": "Hip X-Ray",
    "modality": ["CR", "DX", "XR"], "body_part": ["HIP"],
    "sections": [
        {"key": "clinical_history", "title": "Clinical History", "default": ""},
        {"key": "technique", "title": "Technique", "default": "AP and lateral views of the {laterality} hip were obtained."},
        {"key": "findings", "title": "Findings",
         "subsections": ["Femoral Head", "Acetabulum", "Joint Space", "Bones", "Soft Tissues"],
         "normal_text": "The femoral head is well-contained within the acetabulum. The joint space is maintained symmetrically. No fracture is identified. The femoral neck appears intact and of normal density. The greater and lesser trochanters are intact. No periarticular calcification or soft tissue swelling.",
         "common_findings": ["Neck of femur fracture", "Intertrochanteric fracture", "Subtrochanteric fracture", "Avascular necrosis femoral head", "Hip osteoarthritis", "Joint space narrowing", "Acetabular fracture", "Periarticular calcification"],
         "medical_terms": ["femoral head", "acetabulum", "femoral neck", "trochanter", "intertrochanteric", "avascular necrosis", "Garden classification", "joint space", "osteoarthritis", "coxa vara", "protrusio"]},
        {"key": "impression", "title": "Impression", "normal_text": "No fracture or significant radiological abnormality of the {laterality} hip."},
        {"key": "recommendation", "title": "Recommendation", "default": ""},
        SIGNATURE_SECTION
    ],
    "few_shot_normal": {"input": "hip joint normal, femoral head contained, no fracture", "output": {"findings": "The femoral head is well-contained within the acetabulum. The joint space is maintained symmetrically. No fracture is identified. The femoral neck appears intact and of normal density. The greater and lesser trochanters are intact. No periarticular calcification.", "impression": "No fracture or significant radiological abnormality of the hip."}},
    "measurement_hints": ["mm", "cm", "displacement", "Garden"]
},

"lspine_xray": {
    "id": "lspine_xray", "name": "Lumbar Spine X-Ray",
    "modality": ["CR", "DX", "XR"], "body_part": ["LSPINE", "SPINE"],
    "sections": [
        {"key": "clinical_history", "title": "Clinical History", "default": ""},
        {"key": "technique", "title": "Technique", "default": "AP and lateral views of the lumbar spine were obtained."},
        {"key": "findings", "title": "Findings",
         "subsections": ["Vertebral Bodies", "Disc Spaces", "Alignment", "Neural Foramina", "Soft Tissues"],
         "normal_text": "The vertebral bodies show normal height and alignment. No fracture or dislocation is identified. The intervertebral disc spaces are maintained at all levels. The pedicles are intact. No significant spondylolisthesis is identified. The paravertebral soft tissues are unremarkable.",
         "common_findings": ["L4-L5 disc space narrowing", "L5-S1 disc space narrowing", "Spondylolisthesis L4-L5", "Lumbar spondylosis", "Vertebral body compression fracture", "Osteophytic lipping", "Facet joint arthritis", "Sacralization L5", "Lumbarization S1"],
         "medical_terms": ["vertebral body", "intervertebral disc", "disc space", "pedicle", "facet joint", "spondylolisthesis", "spondylosis", "foraminal", "listhesis", "osteophyte", "Schmorl node", "end plate", "lordosis", "kyphosis"]},
        {"key": "impression", "title": "Impression", "normal_text": "No significant radiological abnormality of the lumbar spine."},
        {"key": "recommendation", "title": "Recommendation", "default": ""},
        SIGNATURE_SECTION
    ],
    "few_shot_normal": {"input": "lumbar spine vertebrae normal, disc spaces maintained, no fracture", "output": {"findings": "The vertebral bodies show normal height and alignment. No fracture or dislocation is identified. The intervertebral disc spaces are maintained at all levels. The pedicles are intact. No significant spondylolisthesis is identified. The paravertebral soft tissues are unremarkable.", "impression": "No significant radiological abnormality of the lumbar spine."}},
    "measurement_hints": ["mm", "cm", "grade", "listhesis percentage"]
},

"cspine_xray": {
    "id": "cspine_xray", "name": "Cervical Spine X-Ray",
    "modality": ["CR", "DX", "XR"], "body_part": ["CSPINE"],
    "sections": [
        {"key": "clinical_history", "title": "Clinical History", "default": ""},
        {"key": "technique", "title": "Technique", "default": "AP, lateral and open mouth odontoid views of the cervical spine were obtained."},
        {"key": "findings", "title": "Findings",
         "subsections": ["Vertebral Bodies C1-C7", "Disc Spaces", "Alignment", "Prevertebral Soft Tissues", "Odontoid"],
         "normal_text": "The cervical vertebrae C1 through C7 are well-aligned. No fracture or dislocation is identified. The intervertebral disc spaces are maintained at all levels. The prevertebral soft tissues are normal in thickness. The odontoid process appears intact. Normal cervical lordosis is maintained.",
         "common_findings": ["Cervical spondylosis", "Disc space narrowing", "Cervical lordosis straightening", "C5-C6 disc space narrowing", "C6-C7 disc space narrowing", "Osteophytic lipping", "Prevertebral soft tissue swelling", "Fracture (specify level)"],
         "medical_terms": ["vertebral body", "odontoid", "atlas", "axis", "cervical lordosis", "disc space", "prevertebral", "facet joint", "uncovertebral joint", "spondylosis", "subluxation", "cord compression"]},
        {"key": "impression", "title": "Impression", "normal_text": "No significant radiological abnormality of the cervical spine."},
        {"key": "recommendation", "title": "Recommendation", "default": ""},
        SIGNATURE_SECTION
    ],
    "few_shot_normal": {"input": "cervical spine alignment normal, disc spaces maintained, no fracture", "output": {"findings": "The cervical vertebrae C1 through C7 are well-aligned. No fracture or dislocation is identified. The intervertebral disc spaces are maintained at all levels. The prevertebral soft tissues are normal. The odontoid process is intact. Normal cervical lordosis is maintained.", "impression": "No significant radiological abnormality of the cervical spine."}},
    "measurement_hints": ["mm", "prevertebral thickness"]
},

"tspine_xray": {
    "id": "tspine_xray", "name": "Thoracic Spine X-Ray",
    "modality": ["CR", "DX", "XR"], "body_part": ["TSPINE"],
    "sections": [
        {"key": "clinical_history", "title": "Clinical History", "default": ""},
        {"key": "technique", "title": "Technique", "default": "AP and lateral views of the thoracic spine were obtained."},
        {"key": "findings", "title": "Findings",
         "subsections": ["Vertebral Bodies", "Disc Spaces", "Alignment", "Ribs", "Soft Tissues"],
         "normal_text": "The thoracic vertebral bodies show normal height and alignment. No fracture or dislocation is identified. The intervertebral disc spaces are maintained. The pedicles are intact. Normal thoracic kyphosis is maintained. The visualized ribs are intact. The paravertebral soft tissues are unremarkable.",
         "common_findings": ["Vertebral body compression fracture", "Thoracic spondylosis", "Disc space narrowing", "Wedge compression deformity", "Scheuermann disease", "Scoliosis", "Rib fracture"],
         "medical_terms": ["vertebral body", "kyphosis", "scoliosis", "compression fracture", "wedge deformity", "Scheuermann", "end plate", "disc space", "pedicle", "costovertebral"]},
        {"key": "impression", "title": "Impression", "normal_text": "No significant radiological abnormality of the thoracic spine."},
        {"key": "recommendation", "title": "Recommendation", "default": ""},
        SIGNATURE_SECTION
    ],
    "few_shot_normal": {"input": "thoracic spine normal, no fracture, kyphosis normal", "output": {"findings": "The thoracic vertebral bodies show normal height and alignment. No fracture or dislocation identified. The intervertebral disc spaces are maintained. Normal thoracic kyphosis is maintained. The pedicles are intact. Visualized ribs are intact.", "impression": "No significant radiological abnormality of the thoracic spine."}},
    "measurement_hints": ["mm", "cm", "Cobb angle", "degree"]
},

"pelvis_xray": {
    "id": "pelvis_xray", "name": "Pelvis X-Ray",
    "modality": ["CR", "DX", "XR"], "body_part": ["PELVIS"],
    "sections": [
        {"key": "clinical_history", "title": "Clinical History", "default": ""},
        {"key": "technique", "title": "Technique", "default": "AP view of the pelvis was obtained."},
        {"key": "findings", "title": "Findings",
         "subsections": ["Pelvis Ring", "Hip Joints", "Sacrum/Coccyx", "Sacroiliac Joints", "Soft Tissues"],
         "normal_text": "The pelvic ring is intact. No fracture or dislocation is identified. Both hip joints are normally located with maintained joint spaces. The sacrum, coccyx and sacroiliac joints appear normal. The visualized lumbar vertebrae are intact. No soft tissue abnormality is identified.",
         "common_findings": ["Pubic ramus fracture", "Iliac wing fracture", "Sacral fracture", "Acetabular fracture", "Hip dislocation", "Pubic symphysis disruption", "Sacroiliac joint disruption", "Osteoarthritis hip joints"],
         "medical_terms": ["pelvis", "ilium", "ischium", "pubis", "acetabulum", "sacrum", "coccyx", "sacroiliac", "pubic symphysis", "obturator ring", "femoral head", "pelvic ring"]},
        {"key": "impression", "title": "Impression", "normal_text": "No fracture or significant radiological abnormality of the pelvis."},
        {"key": "recommendation", "title": "Recommendation", "default": ""},
        SIGNATURE_SECTION
    ],
    "few_shot_normal": {"input": "pelvis intact, hip joints normal, sacrum normal", "output": {"findings": "The pelvic ring is intact. No fracture or dislocation is identified. Both hip joints are normally located with maintained joint spaces. The sacrum, coccyx and sacroiliac joints appear normal. No soft tissue abnormality is identified.", "impression": "No fracture or significant radiological abnormality of the pelvis."}},
    "measurement_hints": ["mm", "cm"]
},

"skull_xray": {
    "id": "skull_xray", "name": "Skull X-Ray",
    "modality": ["CR", "DX", "XR"], "body_part": ["SKULL"],
    "sections": [
        {"key": "clinical_history", "title": "Clinical History", "default": ""},
        {"key": "technique", "title": "Technique", "default": "PA and lateral views of the skull were obtained."},
        {"key": "findings", "title": "Findings",
         "subsections": ["Calvarium", "Sella Turcica", "Facial Bones", "Sinuses", "Soft Tissues"],
         "normal_text": "The bony calvarium is intact with no fracture identified. The sella turcica is of normal size and shape. The facial bones are intact. The paranasal sinuses appear clear. No calcifications are identified within the brain parenchyma. The soft tissues are unremarkable.",
         "common_findings": ["Vault fracture", "Depressed fracture", "Sinus opacification", "Pineal gland calcification", "Sella enlargement", "Facial bone fracture"],
         "medical_terms": ["calvarium", "sella turcica", "mastoid", "petrous", "paranasal sinus", "orbital", "nasal bone", "zygomatic arch", "mandible", "calcification", "density"]},
        {"key": "impression", "title": "Impression", "normal_text": "No fracture or significant radiological abnormality of the skull."},
        {"key": "recommendation", "title": "Recommendation", "default": ""},
        SIGNATURE_SECTION
    ],
    "few_shot_normal": {"input": "skull intact, no fracture, sinuses clear", "output": {"findings": "The bony calvarium is intact with no fracture identified. The sella turcica is of normal size and shape. The facial bones are intact. The paranasal sinuses appear clear. No abnormal calcifications. The soft tissues are unremarkable.", "impression": "No fracture or significant radiological abnormality of the skull."}},
    "measurement_hints": ["mm", "cm"]
},

"abdomen_xray": {
    "id": "abdomen_xray", "name": "Abdomen X-Ray",
    "modality": ["CR", "DX", "XR"], "body_part": ["ABDOMEN"],
    "sections": [
        {"key": "clinical_history", "title": "Clinical History", "default": ""},
        {"key": "technique", "title": "Technique", "default": "Erect and supine AP views of the abdomen were obtained."},
        {"key": "findings", "title": "Findings",
         "subsections": ["Bowel Gas Pattern", "Solid Organs", "Calcifications", "Bones", "Soft Tissues"],
         "normal_text": "The bowel gas pattern is normal. No dilated bowel loops are identified. No air-fluid levels are seen on erect view. No free air under the diaphragm. The liver, spleen and kidneys are normal in size. No abnormal calcifications are identified. The visualized bones are intact.",
         "common_findings": ["Dilated small bowel loops", "Air-fluid levels", "Free air under diaphragm", "Renal calculus", "Ureteric calculus", "Fecal loading", "Calcified gallstones", "Pancreatic calcification", "Aortic calcification"],
         "medical_terms": ["bowel gas", "air-fluid level", "pneumoperitoneum", "obstruction", "calculus", "calcification", "hepatomegaly", "splenomegaly", "psoas shadow", "pneumatosis", "volvulus", "intussusception"]},
        {"key": "impression", "title": "Impression", "normal_text": "No significant radiological abnormality on abdominal radiograph."},
        {"key": "recommendation", "title": "Recommendation", "default": ""},
        SIGNATURE_SECTION
    ],
    "few_shot_normal": {"input": "bowel gas normal, no air-fluid levels, no free air, organs normal", "output": {"findings": "The bowel gas pattern is normal. No dilated bowel loops are identified. No air-fluid levels are seen on erect view. No free air under the diaphragm. The liver, spleen and kidneys are normal in size. No abnormal calcifications. The visualized bones are intact.", "impression": "No significant radiological abnormality on abdominal radiograph."}},
    "measurement_hints": ["cm", "mm", "HU"]
},

"ribs_xray": {
    "id": "ribs_xray", "name": "Ribs X-Ray",
    "modality": ["CR", "DX", "XR"], "body_part": ["RIBS"],
    "sections": [
        {"key": "clinical_history", "title": "Clinical History", "default": ""},
        {"key": "technique", "title": "Technique", "default": "AP and oblique views of the {laterality} ribs were obtained."},
        {"key": "findings", "title": "Findings",
         "subsections": ["Ribs", "Lungs", "Pleura", "Soft Tissues"],
         "normal_text": "The visualized ribs are intact bilaterally. No fracture is identified. The lung fields appear clear. No pleural effusion is identified. The underlying soft tissues are unremarkable.",
         "common_findings": ["Rib fracture (specify rib and side)", "Multiple rib fractures", "Flail chest", "Callus formation", "Pleural effusion secondary to rib fracture", "Pneumothorax"],
         "medical_terms": ["rib", "costal", "intercostal", "callus", "displaced fracture", "non-displaced", "flail chest", "pneumothorax", "hemothorax", "pleural effusion"]},
        {"key": "impression", "title": "Impression", "normal_text": "No fracture of the visualized ribs."},
        {"key": "recommendation", "title": "Recommendation", "default": ""},
        SIGNATURE_SECTION
    ],
    "few_shot_normal": {"input": "ribs intact, no fracture, lungs clear", "output": {"findings": "The visualized ribs are intact bilaterally. No fracture is identified. The lung fields appear clear. No pleural effusion is identified. The soft tissues are unremarkable.", "impression": "No fracture of the visualized ribs."}},
    "measurement_hints": ["rib number", "displaced", "cm"]
},

# ─────────────────────────────────────────────────────────────────────────────
# CT TEMPLATES
# ─────────────────────────────────────────────────────────────────────────────

"ct_chest": {
    "id": "ct_chest", "name": "CT Chest",
    "modality": ["CT"], "body_part": ["CHEST"],
    "sections": [
        {"key": "clinical_history", "title": "Clinical History", "default": ""},
        {"key": "technique", "title": "Technique", "default": "CT examination of the chest was performed with/without intravenous contrast. Axial sections were obtained with coronal and sagittal reformats."},
        {"key": "comparison", "title": "Comparison", "default": ""},
        {"key": "findings", "title": "Findings",
         "subsections": ["Lung Parenchyma", "Pleura", "Mediastinum", "Heart/Pericardium", "Chest Wall/Bones", "Upper Abdomen"],
         "normal_text": "The lung parenchyma is clear bilaterally. No consolidation, mass or nodule is identified. No pleural effusion or pneumothorax. The mediastinum is normal in width. No mediastinal lymphadenopathy. The heart size is normal. No pericardial effusion. The aorta is normal in caliber. No chest wall abnormality. The visualized upper abdominal organs are unremarkable.",
         "common_findings": ["Ground glass opacity", "Consolidation", "Pleural effusion", "Pulmonary nodule", "Mass", "Lymphadenopathy", "Atelectasis", "Emphysema", "Interstitial thickening", "Pericardial effusion"],
         "medical_terms": ["ground glass opacity", "consolidation", "nodule", "mass", "atelectasis", "emphysema", "bronchiectasis", "interstitial", "reticular", "pleural effusion", "lymphadenopathy", "mediastinum", "pericardium", "HU", "Hounsfield"]},
        {"key": "impression", "title": "Impression", "normal_text": "Normal CT examination of the chest."},
        {"key": "recommendation", "title": "Recommendation", "default": ""},
        SIGNATURE_SECTION
    ],
    "few_shot_normal": {"input": "lungs clear, no nodule, no effusion, mediastinum normal", "output": {"findings": "The lung parenchyma is clear bilaterally with no consolidation, mass or nodule. No pleural effusion or pneumothorax. The mediastinum is normal in width. No mediastinal lymphadenopathy is identified. The heart size is normal with no pericardial effusion. The aorta is normal in caliber.", "impression": "Normal CT examination of the chest."}},
    "measurement_hints": ["mm", "cm", "HU", "Hounsfield unit", "short axis", "long axis"]
},

"ct_abdomen": {
    "id": "ct_abdomen", "name": "CT Abdomen & Pelvis",
    "modality": ["CT"], "body_part": ["ABDOMEN", "PELVIS"],
    "sections": [
        {"key": "clinical_history", "title": "Clinical History", "default": ""},
        {"key": "technique", "title": "Technique", "default": "CT examination of the abdomen and pelvis was performed with/without intravenous contrast. Axial sections were obtained with coronal and sagittal reformats."},
        {"key": "comparison", "title": "Comparison", "default": ""},
        {"key": "findings", "title": "Findings",
         "subsections": ["Liver", "Gallbladder/Bile Ducts", "Pancreas", "Spleen", "Kidneys/Ureters", "Adrenal Glands", "Bowel", "Mesentery/Lymph Nodes", "Vessels", "Pelvis", "Bones"],
         "normal_text": "The liver is normal in size and attenuation with no focal lesion. The gallbladder is normal. The common bile duct is not dilated. The pancreas is normal. The spleen is normal in size. Both kidneys are normal in size and enhancement with no hydronephrosis or calculus. The adrenal glands are normal. The bowel is not dilated. No free fluid or lymphadenopathy. The pelvic organs are normal. The visualized bones are intact.",
         "common_findings": ["Hepatic cyst", "Hepatic mass", "Cholelithiasis", "Cholecystitis", "Dilated common bile duct", "Pancreatic mass", "Splenic cyst", "Renal calculus", "Hydronephrosis", "Appendicitis", "Bowel obstruction", "Free fluid", "Lymphadenopathy"],
         "medical_terms": ["attenuation", "enhancement", "hypodense", "hyperdense", "isodense", "heterogeneous", "homogeneous", "hydronephrosis", "lithiasis", "cholecystitis", "pancreatitis", "hepatomegaly", "splenomegaly", "lymphadenopathy", "ascites"]},
        {"key": "impression", "title": "Impression", "normal_text": "Normal CT examination of the abdomen and pelvis."},
        {"key": "recommendation", "title": "Recommendation", "default": ""},
        SIGNATURE_SECTION
    ],
    "few_shot_normal": {"input": "liver normal, kidneys normal, no free fluid, bowel normal", "output": {"findings": "The liver is normal in size and attenuation with no focal lesion. The gallbladder is normal with no calculus. The common bile duct is not dilated. The pancreas appears normal. The spleen is normal in size. Both kidneys are normal with no hydronephrosis or calculus. The adrenal glands are normal. The bowel is not dilated. No free fluid or lymphadenopathy. The pelvic organs are normal.", "impression": "Normal CT examination of the abdomen and pelvis."}},
    "measurement_hints": ["mm", "cm", "HU", "Hounsfield", "caliber", "diameter"]
},

"ct_brain": {
    "id": "ct_brain", "name": "CT Brain",
    "modality": ["CT"], "body_part": ["SKULL", "BRAIN"],
    "sections": [
        {"key": "clinical_history", "title": "Clinical History", "default": ""},
        {"key": "technique", "title": "Technique", "default": "Non-contrast CT of the brain was performed. Axial sections were obtained from the skull base to the vertex."},
        {"key": "comparison", "title": "Comparison", "default": ""},
        {"key": "findings", "title": "Findings",
         "subsections": ["Brain Parenchyma", "Ventricles", "Sulci/Gyri", "Basal Ganglia", "Posterior Fossa", "Calvarium/Scalp", "Orbits"],
         "normal_text": "The brain parenchyma shows normal attenuation. No intracranial hemorrhage, infarct or mass lesion is identified. The ventricles are normal in size and configuration. The sulci and gyri are unremarkable. The basal ganglia, thalami and internal capsules are intact. The posterior fossa structures including cerebellum and brainstem are normal. The calvarium is intact. No scalp soft tissue swelling.",
         "common_findings": ["Intracranial hemorrhage", "Subarachnoid hemorrhage", "Subdural hematoma", "Epidural hematoma", "Cerebral infarct", "Brain mass/tumor", "Cerebral edema", "Hydrocephalus", "Midline shift", "Cerebral atrophy"],
         "medical_terms": ["parenchyma", "hyperdense", "hypodense", "hemorrhage", "infarct", "mass effect", "midline shift", "ventricle", "sulci", "gyri", "cerebellum", "brainstem", "subarachnoid", "subdural", "epidural", "leukoaraiosis", "periventricular"]},
        {"key": "impression", "title": "Impression", "normal_text": "Normal non-contrast CT of the brain. No intracranial hemorrhage or acute ischemic change."},
        {"key": "recommendation", "title": "Recommendation", "default": ""},
        SIGNATURE_SECTION
    ],
    "few_shot_normal": {"input": "brain parenchyma normal, no hemorrhage, ventricles normal", "output": {"findings": "The brain parenchyma shows normal attenuation. No intracranial hemorrhage, infarct or mass lesion is identified. The ventricles are normal in size and configuration. The sulci and gyri are unremarkable. The basal ganglia and internal capsules are intact. The posterior fossa structures are normal. The calvarium is intact.", "impression": "Normal non-contrast CT of the brain. No intracranial hemorrhage or acute ischemic change."}},
    "measurement_hints": ["mm", "cm", "HU", "midline shift", "diameter"]
},

# ─────────────────────────────────────────────────────────────────────────────
# MRI TEMPLATES
# ─────────────────────────────────────────────────────────────────────────────

"mri_brain": {
    "id": "mri_brain", "name": "MRI Brain",
    "modality": ["MR"], "body_part": ["SKULL", "BRAIN"],
    "sections": [
        {"key": "clinical_history", "title": "Clinical History", "default": ""},
        {"key": "technique", "title": "Technique", "default": "MRI of the brain was performed using standard sequences including T1, T2, FLAIR, DWI and T1 post gadolinium on axial, coronal and sagittal planes."},
        {"key": "comparison", "title": "Comparison", "default": ""},
        {"key": "findings", "title": "Findings",
         "subsections": ["Brain Parenchyma", "White Matter", "Ventricles", "Cortex", "Basal Ganglia", "Posterior Fossa", "Vascular Structures", "Calvarium/Sinuses"],
         "normal_text": "The brain parenchyma demonstrates normal signal intensity on all sequences. No abnormal signal change, mass lesion or enhancement is identified. The white matter is normal. The cortex is well-defined. The basal ganglia and thalami are normal. The posterior fossa including cerebellum and brainstem shows no abnormality. The ventricles are normal in size. No restricted diffusion on DWI. The paranasal sinuses and mastoids are clear.",
         "common_findings": ["White matter lesions", "Cerebral infarct", "Tumor/metastasis", "Demyelination", "Leukoencephalopathy", "Enhancement", "Restricted diffusion", "Atrophy", "Midline shift"],
         "medical_terms": ["T1", "T2", "FLAIR", "DWI", "ADC", "gadolinium", "enhancement", "signal intensity", "hyperintense", "hypointense", "restricted diffusion", "leukoaraiosis", "periventricular", "demyelination", "gliosis", "encephalomalacia"]},
        {"key": "impression", "title": "Impression", "normal_text": "Normal MRI of the brain with no significant intracranial pathology."},
        {"key": "recommendation", "title": "Recommendation", "default": ""},
        SIGNATURE_SECTION
    ],
    "few_shot_normal": {"input": "brain signal normal, no enhancement, white matter normal, DWI negative", "output": {"findings": "The brain parenchyma demonstrates normal signal intensity on all sequences. No abnormal signal change, mass lesion or enhancement is identified. The white matter is normal. The cortex is well-defined. The basal ganglia and thalami are normal. The posterior fossa is unremarkable. The ventricles are normal. No restricted diffusion on DWI.", "impression": "Normal MRI of the brain with no significant intracranial pathology."}},
    "measurement_hints": ["mm", "cm", "signal", "enhancement"]
},

"mri_knee": {
    "id": "mri_knee", "name": "MRI Knee",
    "modality": ["MR"], "body_part": ["KNEE"],
    "sections": [
        {"key": "clinical_history", "title": "Clinical History", "default": ""},
        {"key": "technique", "title": "Technique", "default": "MRI of the {laterality} knee was performed using standard sequences including PD, T1, T2 fat-sat in axial, coronal and sagittal planes."},
        {"key": "findings", "title": "Findings",
         "subsections": ["Menisci", "Cruciate Ligaments", "Collateral Ligaments", "Articular Cartilage", "Bones/Marrow", "Joint Effusion", "Baker's Cyst"],
         "normal_text": "The medial and lateral menisci are of normal morphology and signal. The ACL and PCL are intact and show normal signal. The medial and lateral collateral ligaments are intact. The articular cartilage is preserved throughout. The osseous structures show no marrow edema, fracture or avascular change. No significant joint effusion. No Baker cyst identified.",
         "common_findings": ["Medial meniscus tear", "Lateral meniscus tear", "ACL tear", "PCL tear", "MCL sprain/tear", "LCL injury", "Cartilage loss", "Bone marrow edema", "Osteochondral defect", "Joint effusion", "Baker cyst"],
         "medical_terms": ["meniscus", "ACL", "PCL", "MCL", "LCL", "cartilage", "chondral", "marrow edema", "Outerbridge", "Baker cyst", "popliteal", "anterior cruciate ligament", "posterior cruciate", "medial collateral", "lateral collateral", "tibial plateau", "femoral condyle"]},
        {"key": "impression", "title": "Impression", "normal_text": "No significant abnormality on MRI of the {laterality} knee."},
        {"key": "recommendation", "title": "Recommendation", "default": ""},
        SIGNATURE_SECTION
    ],
    "few_shot_normal": {"input": "menisci normal, ACL PCL intact, cartilage normal, no effusion", "output": {"findings": "The medial and lateral menisci are of normal morphology and signal. The ACL and PCL are intact and show normal signal. The medial and lateral collateral ligaments are intact. The articular cartilage is preserved throughout. No marrow edema or fracture. No significant joint effusion. No Baker cyst.", "impression": "No significant abnormality on MRI of the knee."}},
    "measurement_hints": ["mm", "cm", "grade", "Outerbridge grade"]
},

"mri_lspine": {
    "id": "mri_lspine", "name": "MRI Lumbar Spine",
    "modality": ["MR"], "body_part": ["LSPINE", "SPINE"],
    "sections": [
        {"key": "clinical_history", "title": "Clinical History", "default": ""},
        {"key": "technique", "title": "Technique", "default": "MRI of the lumbar spine was performed using T1 and T2 weighted sequences in sagittal and axial planes."},
        {"key": "comparison", "title": "Comparison", "default": ""},
        {"key": "findings", "title": "Findings",
         "subsections": ["Vertebral Bodies", "Disc Spaces L1-S1", "Spinal Canal", "Neural Foramina", "Conus", "Soft Tissues"],
         "normal_text": "The lumbar vertebral bodies are normal in height and marrow signal. The intervertebral discs at L1-L2, L2-L3, L3-L4, L4-L5 and L5-S1 show normal height and signal intensity. The spinal canal is of adequate caliber. The neural foramina are patent bilaterally. The conus medullaris terminates at the L1 level. No significant posterior element abnormality.",
         "common_findings": ["L4-L5 disc prolapse", "L5-S1 disc prolapse", "Disc desiccation", "Canal stenosis", "Foraminal stenosis", "Spondylolisthesis", "Nerve root compression", "Disc extrusion", "Modic changes", "Schmorl nodes"],
         "medical_terms": ["disc prolapse", "herniation", "protrusion", "extrusion", "sequestration", "desiccation", "Modic", "Schmorl node", "neural foramen", "canal stenosis", "thecal sac", "nerve root", "conus", "cauda equina", "spondylolisthesis", "facet arthropathy"]},
        {"key": "impression", "title": "Impression", "normal_text": "No significant disc herniation or neural compression on MRI of the lumbar spine."},
        {"key": "recommendation", "title": "Recommendation", "default": ""},
        SIGNATURE_SECTION
    ],
    "few_shot_normal": {"input": "lumbar discs normal signal, no prolapse, canal adequate, no nerve compression", "output": {"findings": "The lumbar vertebral bodies are normal in height and marrow signal. The intervertebral discs at L1-L2 through L5-S1 show normal height and signal intensity. The spinal canal is of adequate caliber. The neural foramina are patent bilaterally. The conus medullaris terminates at the L1 level. No neural compression is identified.", "impression": "No significant disc herniation or neural compression on MRI of the lumbar spine."}},
    "measurement_hints": ["mm", "cm", "canal diameter", "foraminal height", "grade"]
},

}

# ─────────────────────────────────────────────────────────────────────────────
# Write all templates to disk
# ─────────────────────────────────────────────────────────────────────────────

for template_id, template_data in TEMPLATES.items():
    filepath = os.path.join(TEMPLATES_DIR, f"{template_id}.json")
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(template_data, f, indent=2, ensure_ascii=False)
    print(f"[OK] Written: {template_id}.json")

print(f"\n[DONE] All {len(TEMPLATES)} templates written to {TEMPLATES_DIR}")
print("Templates cover:")
print("  X-Ray: chest, knee, ankle, foot, wrist, hand, shoulder, elbow, hip")
print("  X-Ray: lumbar spine, cervical spine, thoracic spine, pelvis, skull, abdomen, ribs")
print("  CT: chest, abdomen/pelvis, brain")
print("  MRI: brain, knee, lumbar spine")
