#!/bin/bash

echo ""
echo "============================================================"
echo "         Loading Demo DICOM Files into Orthanc"
echo "============================================================"
echo ""

# Wait for Orthanc to be ready
echo "  Waiting for Orthanc to be ready..."
attempts=0
max_attempts=30

while [ $attempts -lt $max_attempts ]; do
    attempts=$((attempts + 1))
    if curl -sf http://localhost:8042/system > /dev/null 2>&1; then
        echo "  Orthanc is ready!"
        echo ""
        break
    fi
    sleep 5
done

if [ $attempts -ge $max_attempts ]; then
    echo "  WARNING: Orthanc did not respond after 150 seconds."
    echo "  Demo files were NOT loaded. You can run this script again later."
    exit 1
fi

# Upload each DCM file in demo-dicoms folder
uploaded=0
failed=0

for dcm_file in demo-dicoms/*.dcm; do
    [ -f "$dcm_file" ] || continue
    filename=$(basename "$dcm_file")
    echo "  Uploading: $filename"
    if curl -sf -X POST http://localhost:8042/instances --data-binary @"$dcm_file" > /dev/null 2>&1; then
        uploaded=$((uploaded + 1))
    else
        echo "    WARNING: Failed to upload $filename"
        failed=$((failed + 1))
    fi
done

echo ""
if [ $uploaded -gt 0 ]; then
    echo "  Demo files loaded successfully! ($uploaded files uploaded)"
else
    echo "  No .dcm files found in demo-dicoms folder."
fi
if [ $failed -gt 0 ]; then
    echo "  WARNING: $failed file(s) failed to upload."
fi
echo ""
