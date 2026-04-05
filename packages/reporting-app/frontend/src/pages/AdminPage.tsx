import { AdminSection } from "../components/AdminSection";
import { motion } from "framer-motion";

export function AdminPage() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="page-container"
    >
      <AdminSection />
    </motion.div>
  );
}
