-- Dicoogle Lua snippet: notify reporting app when new study is indexed
local http = require("socket.http")
local ltn12 = require("ltn12")

function onStudyIndexed(studyId)
  local payload = string.format('{"studyId":"%s"}', studyId)
  local response = {}

  http.request{
    url = "https://reporting-app.example.com/webhook/study",
    method = "POST",
    headers = {
      ["Content-Type"] = "application/json",
      ["Content-Length"] = tostring(#payload),
    },
    source = ltn12.source.string(payload),
    sink = ltn12.sink.table(response)
  }
end
