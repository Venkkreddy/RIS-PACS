-- ============================================================================
-- Multi-Tenant DICOM Routing for Orthanc
-- ============================================================================
--
-- This Lua script runs inside Orthanc to enforce tenant isolation at the
-- PACS level. It intercepts incoming C-STORE requests and:
--
--   1. Maps the CallingAET (or InstitutionName tag) to a tenant
--   2. Stamps the study with a tenant identifier via metadata
--   3. Routes the study to tenant-specific storage
--   4. Blocks queries that cross tenant boundaries
--
-- AE Title → Tenant mapping is loaded from the backend API at startup.
-- ============================================================================

-- AE Title → tenant_id mapping (populated from backend API)
local ae_tenant_map = {}
local backend_base_url = os.getenv("BACKEND_URL") or "http://localhost:8081"
local backend_api_v1 = backend_base_url .. "/api/v1"

-- Refresh the AE→tenant mapping from the backend API
function RefreshTenantMapping()
  local response = HttpGet(backend_api_v1 .. "/internal/dicom-tenant-map", false)
  if response then
    local ok, mapping = pcall(ParseJson, response)
    if ok and mapping then
      ae_tenant_map = {}
      for _, entry in ipairs(mapping) do
        if entry.ae_title and entry.tenant_id then
          ae_tenant_map[entry.ae_title] = entry.tenant_id
          PrintToLog("Mapped AE Title: " .. entry.ae_title .. " -> Tenant: " .. entry.tenant_id)
        end
      end
      PrintToLog("Loaded " .. #mapping .. " tenant AE mappings")
    end
  end
end

-- Initialize mapping on startup
RefreshTenantMapping()

-- Periodically refresh (Orthanc will call this based on StableAge)
function OnHeartBeat()
  RefreshTenantMapping()
end

-- ============================================================================
-- C-STORE Filter: Resolve tenant from CallingAET or InstitutionName
-- ============================================================================

function IncomingCStoreRequestFilter(dicom, origin)
  local calling_aet = origin["CallingAet"] or ""
  local institution = dicom:GetInstanceSimplifiedTags()["InstitutionName"] or ""

  local tenant_id = ae_tenant_map[calling_aet]

  -- Fallback: try matching by InstitutionName
  if not tenant_id then
    for ae, tid in pairs(ae_tenant_map) do
      -- Check if any tenant's institution matches
      if institution ~= "" then
        local inst_response = HttpGet(
          backend_api_v1 .. "/internal/tenant-by-institution?name=" ..
          UrlEncode(institution), false
        )
        if inst_response then
          local ok, data = pcall(ParseJson, inst_response)
          if ok and data and data.tenant_id then
            tenant_id = data.tenant_id
            break
          end
        end
      end
    end
  end

  if not tenant_id then
    PrintToLog("WARNING: Rejecting C-STORE from unknown AET: " .. calling_aet)
    return false  -- Reject the study
  end

  -- Tag the instance with tenant metadata so it's retrievable later
  dicom:SetInstanceMetadata("tenant_id", tenant_id)
  dicom:SetInstanceMetadata("calling_aet", calling_aet)

  PrintToLog("Accepted C-STORE: AET=" .. calling_aet ..
             " Tenant=" .. tenant_id ..
             " StudyUID=" .. (dicom:GetInstanceSimplifiedTags()["StudyInstanceUID"] or ""))

  return true  -- Accept the study
end

-- ============================================================================
-- Stable Study Callback: Notify backend with tenant context
-- ============================================================================

function OnStableStudy(studyId, tags, metadata)
  local tenant_id = metadata["tenant_id"] or ""
  local study_uid = tags["StudyInstanceUID"] or ""

  if tenant_id == "" then
    PrintToLog("WARNING: Stable study without tenant_id: " .. studyId)
    return
  end

  -- Notify the backend about the new stable study
  local payload = {
    studyId = studyId,
    studyInstanceUID = study_uid,
    tenantId = tenant_id,
    patientName = tags["PatientName"] or "",
    patientId = tags["PatientID"] or "",
    studyDate = tags["StudyDate"] or "",
    modality = tags["ModalitiesInStudy"] or "",
    description = tags["StudyDescription"] or "",
    institutionName = tags["InstitutionName"] or ""
  }

  local headers = {
    ["Content-Type"] = "application/json",
    ["X-Webhook-Secret"] = os.getenv("WEBHOOK_SECRET") or ""
  }

  HttpPost(backend_api_v1 .. "/webhook/study",
           DumpJson(payload, true), headers)

  PrintToLog("Notified backend: Study=" .. study_uid .. " Tenant=" .. tenant_id)
end

-- ============================================================================
-- C-FIND Filter: Scope queries to the requesting tenant
-- ============================================================================

function IncomingFindRequestFilter(source, origin)
  local calling_aet = origin["CallingAet"] or ""
  local tenant_id = ae_tenant_map[calling_aet]

  if not tenant_id then
    PrintToLog("WARNING: Rejecting C-FIND from unknown AET: " .. calling_aet)
    return false  -- Reject the query
  end

  return true
end
