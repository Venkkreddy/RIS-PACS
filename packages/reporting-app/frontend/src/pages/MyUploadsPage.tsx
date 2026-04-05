import { DicomUpload } from "../components/DicomUpload";
import { LocalDicoogleDownload } from "../components/LocalDicoogleDownload";
import { Worklist } from "../components/Worklist";
import { useAuthRole } from "../hooks/useAuthRole";
import { motion } from "framer-motion";

export function MyUploadsPage() {
  const auth = useAuthRole();
  // Radiographers: only their uploads. Radiologists/admins/etc.: full worklist — studies are often
  // ingested without their user id as uploader, and bulk upload may omit parsed Study UIDs; scoping
  // by uploaderId then showed 0 rows while the main portal still had patients.
  const scopedUploaderId = auth.role === "radiographer" ? auth.userId : undefined;
  const worklistReady = !auth.loading && (auth.role !== "radiographer" || Boolean(auth.userId));

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="page-container space-y-6"
    >
      <div className="page-intro">
        <h1 className="page-header">My Uploads</h1>
        <p className="page-subheader mt-1">
          {auth.role === "radiographer"
            ? "Upload DICOM and track studies you sent to the platform"
            : "Upload DICOM and view the study worklist"}
        </p>
      </div>
      <DicomUpload />
      {auth.role === "radiographer" && <LocalDicoogleDownload />}
      <Worklist scopedUploaderId={scopedUploaderId} hideAssignment listQueryEnabled={worklistReady} />
    </motion.div>
  );
}
