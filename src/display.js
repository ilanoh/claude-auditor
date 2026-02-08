import { log } from './logger.js';

export function createDisplay() {
  const findings = [];
  const actions = [];

  return {
    logFinding(finding) {
      findings.push(finding);
      log(finding.severity, finding.description);
    },

    logAction(type, message, autoApproved) {
      const action = {
        type,
        message,
        autoApproved,
        timestamp: new Date().toISOString(),
      };
      actions.push(action);
      const auto = autoApproved ? ' (auto)' : '';
      log(`${type}${auto}`, message);
    },

    getFindings() {
      return findings;
    },

    getActions() {
      return actions;
    },
  };
}
