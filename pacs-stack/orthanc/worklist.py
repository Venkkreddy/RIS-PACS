import orthanc
import json
import urllib.request
import urllib.parse
import hashlib
import datetime
import threading

def OnWorklist(answers, query, connection):
    orthanc.LogInfo("Incoming Modality Worklist C-FIND query from: %s" % str(connection))
    
    # 1. Retrieve the list of scheduled/in-progress orders from the RIS backend
    try:
        # The RIS backend container is named 'reporting-app-backend' on port 8080 inside Docker
        url = "http://reporting-app-backend:8080/api/orders/worklist/mwl"
        req = urllib.request.Request(url, headers={'Accept': 'application/json'})
        with urllib.request.urlopen(req, timeout=5) as response:
            orders = json.loads(response.read().decode())
    except Exception as e:
        orthanc.LogError("Failed to fetch worklist from RIS backend at %s: %s" % (url, str(e)))
        return

    # 2. Iterate through RIS orders and convert them to DICOM MWL response items
    for order in orders:
        patient_name = order.get("patientName", "Unknown^Patient")
        patient_id = order.get("patientId", "123456")
        accession = order.get("id", "")
        modality = order.get("modality", "DX")
        body_part = order.get("bodyPart", "")
        
        # Generate stable, unique StudyInstanceUID based on accession number
        h = hashlib.sha256(accession.encode()).hexdigest()
        study_uid = "2.25." + str(int(h[:30], 16))
        sps_id = accession + "_sps"
        
        # Date formats
        today_str = datetime.date.today().strftime("%Y%m%d")
        
        # Map fields to DICOM JSON representation
        dicom_json = {
            "0008,0050": { "Type": "SH", "Value": accession },
            "0010,0010": { "Type": "PN", "Value": patient_name },
            "0010,0020": { "Type": "LO", "Value": patient_id },
            "0010,0030": { "Type": "DA", "Value": "19800101" },
            "0010,0040": { "Type": "CS", "Value": "O" },
            "0020,000d": { "Type": "UI", "Value": study_uid },
            "0032,1060": { "Type": "LO", "Value": "X-Ray Exam " + body_part },
            "0040,1001": { "Type": "SH", "Value": sps_id },
            "0040,0100": {
                "Type": "SQ",
                "Value": [
                    {
                        "0040,0001": { "Type": "AE", "Value": "ORTHANC" },
                        "0040,0002": { "Type": "DA", "Value": today_str },
                        "0040,0003": { "Type": "TM", "Value": "090000" },
                        "0008,0060": { "Type": "CS", "Value": modality },
                        "0040,0009": { "Type": "SH", "Value": sps_id }
                    }
                ]
            }
        }
        
        try:
            # Create DICOM instance from JSON string
            response_dicom = orthanc.CreateDicom(json.dumps(dicom_json))
            
            # Match query filter criteria (e.g. Modality, Date filters sent by modality console)
            if query.WorklistIsMatch(response_dicom):
                answers.WorklistAddAnswer(query, response_dicom)
                orthanc.LogInfo("Successfully added Modality Worklist answer for Patient ID: %s (%s)" % (patient_id, patient_name))
        except Exception as e:
            orthanc.LogError("Failed to create/add DICOM worklist response: %s" % str(e))

# Register callback with Orthanc Python plugin
try:
    orthanc.RegisterWorklistCallback(OnWorklist)
    orthanc.LogInfo("Successfully registered Orthanc Modality Worklist Python callback")
except Exception as e:
    orthanc.LogError("Failed to register Worklist callback: %s" % str(e))


# ==============================================================================
# DICOM MPPS (Modality Performed Procedure Step) SCP Background Service Thread
# ==============================================================================

def RunMppsServer():
    try:
        from pynetdicom import AE, evt
        from pynetdicom.sop_class import ModalityPerformedProcedureStep
        
        def handle_create(event):
            dataset = event.attribute_list
            accession = dataset.get((0x0008, 0x0050), None)
            patient_id = dataset.get((0x0010, 0x0020), None)
            acc_val = str(accession.value) if accession else "unknown"
            pat_val = str(patient_id.value) if patient_id else "unknown"
            
            orthanc.LogInfo("MPPS N-CREATE received from modality. Accession: %s, Patient MRN: %s" % (acc_val, pat_val))
            
            # Send HTTP update to RIS backend: status = "in-progress"
            try:
                url = "http://reporting-app-backend:8080/api/orders/worklist/mpps/%s" % urllib.parse.quote(acc_val)
                data = json.dumps({"status": "in-progress"}).encode()
                req = urllib.request.Request(url, data=data, method="PATCH", headers={'Content-Type': 'application/json'})
                with urllib.request.urlopen(req, timeout=3) as resp:
                    orthanc.LogInfo("Successfully updated RIS order status to in-progress via MPPS N-CREATE")
            except Exception as e:
                orthanc.LogError("Failed to update RIS order status: %s" % str(e))
                
            return 0x0000 # Success

        def handle_set(event):
            dataset = event.attribute_list
            status_attr = dataset.get((0x0040, 0x0252), None)
            status_val = str(status_attr.value) if status_attr else "COMPLETED"
            
            orthanc.LogInfo("MPPS N-SET received from modality with status: %s" % status_val)
            
            sop_uid = event.sop_instance_uid
            try:
                # Query all active orders from RIS to find which order hashes to this StudyInstanceUID
                url_get = "http://reporting-app-backend:8080/api/orders/worklist/mwl"
                req_get = urllib.request.Request(url_get, headers={'Accept': 'application/json'})
                with urllib.request.urlopen(req_get, timeout=3) as resp_get:
                    orders = json.loads(resp_get.read().decode())
                
                matched_acc = None
                for order in orders:
                    acc = order.get("id", "")
                    h = hashlib.sha256(acc.encode()).hexdigest()
                    order_study_uid = "2.25." + str(int(h[:30], 16))
                    if order_study_uid == sop_uid:
                        matched_acc = acc
                        break
                
                if matched_acc:
                    ris_status = "completed" if status_val.upper() == "COMPLETED" else "cancelled"
                    url_patch = "http://reporting-app-backend:8080/api/orders/worklist/mpps/%s" % urllib.parse.quote(matched_acc)
                    data = json.dumps({"status": ris_status}).encode()
                    req_patch = urllib.request.Request(url_patch, data=data, method="PATCH", headers={'Content-Type': 'application/json'})
                    with urllib.request.urlopen(req_patch, timeout=3) as resp_patch:
                        orthanc.LogInfo("Successfully updated RIS order status to %s via MPPS N-SET" % ris_status)
                else:
                    orthanc.LogWarning("No active RIS order matched MPPS SOP Instance UID: %s" % sop_uid)
            except Exception as e:
                orthanc.LogError("Failed to process MPPS N-SET update: %s" % str(e))
                
            return 0x0000 # Success

        # Use 'ORTHANC' to match the client's current console MPPS called AE title setting
        ae = AE(ae_title=b'ORTHANC')
        ae.add_supported_context(ModalityPerformedProcedureStep)
        handlers = [
            (evt.EVT_N_CREATE, handle_create),
            (evt.EVT_N_SET, handle_set),
        ]
        
        orthanc.LogInfo("Starting custom DICOM MPPS listener on port 11115...")
        ae.start_server(('', 11115), block=True, evt_handlers=handlers)
        
    except Exception as e:
        orthanc.LogError("MPPS server background thread failed to start: %s" % str(e))

# Spawn MPPS server thread
mpps_thread = threading.Thread(target=RunMppsServer, daemon=True)
mpps_thread.start()
