/**
 * @name Native process execution outside the supervised boundary
 * @description Process-launch APIs must remain isolated in the native-plugin supervisor.
 * @kind problem
 * @problem.severity error
 * @security-severity 8.0
 * @precision high
 * @id meta-prompt/js/native-process-boundary
 * @tags security
 *       external/cwe/cwe-078
 */
import javascript

predicate isProcessLaunch(DataFlow::CallNode call) {
  exists(string member |
    member = ["exec", "execFile", "fork", "spawn"] and
    (
      call = DataFlow::moduleMember("child_process", member).getACall() or
      call = DataFlow::moduleMember("node:child_process", member).getACall()
    )
  )
}

from DataFlow::CallNode call
where
  isProcessLaunch(call) and
  call.getNode().getFile().getRelativePath() != "apps/runtime-node/src/native-plugin.ts"
select call.getNode(), "Process execution bypasses the supervised native-plugin boundary."
