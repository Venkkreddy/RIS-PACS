-- Offsite routing plugin for local Dicoogle nodes.
-- For every stored instance, forward metadata/event to the central gateway.

local centralWebhook = os.getenv("CENTRAL_ROUTER_WEBHOOK") or "http://central.tdairad.com:8080/webhook/study"
local centralAET = os.getenv("CENTRAL_AET") or "TDAI-CENTRAL"

local function safe(value)
  if value == nil then
    return ""
  end
  return tostring(value)
end

function onStore(instance)
  local payload = {
    studyId = safe(instance:getStudyInstanceUID and instance:getStudyInstanceUID() or nil),
    seriesId = safe(instance:getSeriesInstanceUID and instance:getSeriesInstanceUID() or nil),
    sopInstanceId = safe(instance:getSOPInstanceUID and instance:getSOPInstanceUID() or nil),
    destinationAET = centralAET,
    metadata = {
      patientName = safe(instance:getPatientName and instance:getPatientName() or nil),
      patientId = safe(instance:getPatientID and instance:getPatientID() or nil),
      studyDate = safe(instance:getStudyDate and instance:getStudyDate() or nil),
      modality = safe(instance:getModality and instance:getModality() or nil)
    }
  }

  local body = json.encode(payload)
  local _, statusCode = http.post(centralWebhook, body, { ["Content-Type"] = "application/json" })

  if statusCode ~= 200 and statusCode ~= 201 then
    print("offsite-route.lua: central route webhook failed status=" .. safe(statusCode))
  end

  return true
end
