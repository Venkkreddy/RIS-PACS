-- Dicoogle webhook plugin: emits a callback when a study is stored/indexed.
-- Multi-tenant aware: extracts tenant slug from the storage path (e.g. /storage/<tenant-slug>/...)
-- Expected runtime helpers: http, json.

local webhookUrl = os.getenv("REPORTING_WEBHOOK_URL") or "http://localhost:8081/webhook/study"
local webhookSecret = os.getenv("WEBHOOK_SECRET") or ""

local function safeValue(value)
  if value == nil then
    return ""
  end
  return tostring(value)
end

-- Extract tenant slug from storage path: /var/dicoogle/storage/<tenant-slug>/...
local function extractTenantSlug(filePath)
  if filePath == nil or filePath == "" then
    return nil
  end
  local slug = string.match(tostring(filePath), "/storage/([^/]+)/")
  return slug
end

local function buildPayload(instance)
  local uri = safeValue(instance:getURI and instance:getURI() or nil)
  local tenantSlug = extractTenantSlug(uri)
  local aeTitle = safeValue(instance:getInstitutionName and instance:getInstitutionName() or nil)

  local metadata = {
    patientName = safeValue(instance:getPatientName and instance:getPatientName() or nil),
    patientId = safeValue(instance:getPatientID and instance:getPatientID() or nil),
    studyDate = safeValue(instance:getStudyDate and instance:getStudyDate() or nil),
    modality = safeValue(instance:getModality and instance:getModality() or nil),
    accessionNumber = safeValue(instance:getAccessionNumber and instance:getAccessionNumber() or nil),
    aeTitle = aeTitle,
    storagePath = uri
  }

  return {
    studyId = safeValue(instance:getStudyInstanceUID and instance:getStudyInstanceUID() or nil),
    tenantSlug = tenantSlug,
    metadata = metadata
  }
end

function onStore(instance)
  local payload = buildPayload(instance)
  local body = json.encode(payload)

  local headers = {
    ["Content-Type"] = "application/json"
  }
  if webhookSecret ~= "" then
    headers["X-Webhook-Secret"] = webhookSecret
  end

  local response, statusCode = http.post(webhookUrl, body, headers)

  if statusCode ~= 200 and statusCode ~= 201 then
    print("custom-webhook.lua: webhook failed with status " .. safeValue(statusCode))
  end

  return response
end
