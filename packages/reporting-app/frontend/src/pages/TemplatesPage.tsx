import { TemplateEditor } from "../components/TemplateEditor";
import { motion } from "framer-motion";
import { FileText } from "lucide-react";

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

export function TemplatesPage() {
  return (
    <motion.div
      className="page-container"
      variants={container}
      initial="hidden"
      animate="show"
    >
      <motion.div variants={item} className="page-intro">
        <div className="flex items-start gap-4">
          <div className="icon-box h-11 w-11 shrink-0 rounded-xl bg-tdai-navy-50 dark:bg-tdai-navy-900/30">
            <FileText className="h-5 w-5 text-tdai-navy-600 dark:text-white" strokeWidth={2} aria-hidden />
          </div>
          <div className="min-w-0">
            <h1 className="page-header">Report Templates</h1>
            <p className="page-subheader mt-1 max-w-2xl">
              Create and manage reusable report templates
            </p>
          </div>
        </div>
      </motion.div>
      <motion.div variants={item}>
        <TemplateEditor />
      </motion.div>
    </motion.div>
  );
}
