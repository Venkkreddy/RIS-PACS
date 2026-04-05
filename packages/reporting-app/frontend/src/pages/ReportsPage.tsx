import { ReportList } from "../components/ReportList";
import { motion } from "framer-motion";
import { Files } from "lucide-react";

const introEase = [0.16, 1, 0.3, 1] as const;

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.02 },
  },
};

const item = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: introEase },
  },
};

export function ReportsPage() {
  return (
    <motion.div
      className="page-container"
      variants={container}
      initial="hidden"
      animate="show"
    >
      <motion.div variants={item} className="page-intro">
        <div className="flex items-start gap-4">
          <div className="icon-box h-11 w-11 shrink-0 rounded-xl bg-tdai-teal-50 dark:bg-tdai-teal-900/20">
            <Files className="h-5 w-5 text-tdai-teal-600 dark:text-tdai-teal-400" strokeWidth={2} aria-hidden />
          </div>
          <div className="min-w-0">
            <h1 className="page-header">Reports</h1>
            <p className="page-subheader mt-1 max-w-2xl">
              View and manage radiology reports
            </p>
          </div>
        </div>
      </motion.div>
      <motion.div variants={item}>
        <ReportList />
      </motion.div>
    </motion.div>
  );
}
