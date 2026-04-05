import { Worklist } from "../components/Worklist";
import { useAuthRole } from "../hooks/useAuthRole";
import { motion } from "framer-motion";

export function MyStudiesPage() {
  const auth = useAuthRole();
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="page-container"
    >
      <div className="page-intro mb-6">
        <h1 className="page-header">My Assigned Studies</h1>
        <p className="page-subheader mt-1">Studies assigned to you for reporting</p>
      </div>
      <Worklist scopedRadiologistId={auth.userId} />
    </motion.div>
  );
}
