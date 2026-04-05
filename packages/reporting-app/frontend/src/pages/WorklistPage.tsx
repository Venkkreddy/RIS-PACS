import { Worklist } from "../components/Worklist";
import { motion } from "framer-motion";
import { ListTodo } from "lucide-react";

const introEase = [0.16, 1, 0.3, 1] as const;

export function WorklistPage() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: introEase }}
      className="page-container"
    >
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: introEase, delay: 0.04 }}
        className="page-intro"
      >
        <div className="flex items-start gap-4">
          <div className="icon-box h-11 w-11 shrink-0 rounded-xl bg-tdai-teal-50">
            <ListTodo className="h-5 w-5 text-tdai-teal-600" strokeWidth={2} aria-hidden />
          </div>
          <div className="min-w-0">
            <h1 className="page-header">Study Worklist</h1>
            <p className="page-subheader mt-1 max-w-2xl">
              Manage and track imaging studies across your workflow
            </p>
          </div>
        </div>
      </motion.div>
      <Worklist />
    </motion.div>
  );
}
