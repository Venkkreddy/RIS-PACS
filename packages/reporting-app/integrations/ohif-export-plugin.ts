/**
 * OHIF extension sample: export JPEG and send to reporting API.
 */
export async function sendViewportCapture(reportId: string, imageBlob: Blob) {
  const formData = new FormData();
  formData.append("file", imageBlob, "ohif-capture.jpg");

  await fetch(`${import.meta.env.VITE_REPORTING_API}/reports/${reportId}/attach`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });
}
