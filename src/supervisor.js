import { EventEmitter } from 'events';

const STATES = {
  MONITORING: 'MONITORING',
  ALERT: 'ALERT',
  INJECT: 'INJECT',
  INTERRUPT: 'INTERRUPT',
  RECALIBRATE: 'RECALIBRATE',
};

export function createSupervisor(config, proxy, auditor, display) {
  const emitter = new EventEmitter();
  const autonomy = config.autonomy || 'supervised';
  const verbose = config.verbose || false;

  let state = STATES.MONITORING;
  let recalibrationTurn = 0;
  let pendingApproval = null;
  let workerResponseBuffer = '';
  let workerResponseTimer = null;

  function log(msg) {
    if (verbose) {
      process.stderr.write(`[supervisor] [${state}] ${msg}\n`);
    }
  }

  function setState(newState) {
    const prev = state;
    state = newState;
    log(`${prev} → ${newState}`);
    emitter.emit('stateChange', { from: prev, to: newState });
  }

  // Process a chunk from the chunker
  emitter.processChunk = async (chunk) => {
    if (state === STATES.RECALIBRATE) {
      // During recalibration, capture worker output as response
      workerResponseBuffer += chunk.content + '\n';
      resetWorkerResponseTimer();
      return;
    }

    if (state !== STATES.MONITORING) {
      log(`Skipping chunk #${chunk.id} — state is ${state}`);
      return;
    }

    log(`Analyzing chunk #${chunk.id}`);
    const result = await auditor.analyzeChunk(chunk);

    if (!result) {
      log(`No result for chunk #${chunk.id}`);
      return;
    }

    // Emit findings
    for (const finding of result.findings) {
      emitter.emit('finding', finding);
    }

    if (result.noFindings || result.findings.length === 0) {
      log(`Chunk #${chunk.id}: no findings`);
      return;
    }

    // Determine highest severity
    const hasCritical = result.findings.some(f => f.severity === 'CRITICAL');
    const hasWarning = result.findings.some(f => f.severity === 'WARNING');

    // Handle interrupt directive
    if (result.interrupt && hasCritical) {
      await handleInterrupt(result.interrupt);
      return;
    }

    // Handle inject directive
    if (result.inject && (hasCritical || hasWarning)) {
      await handleInject(result.inject);
      return;
    }

    // INFO/SUGGESTION — log only, stay in MONITORING
    log(`Findings logged, staying in MONITORING`);
  };

  async function handleInject(message) {
    setState(STATES.ALERT);

    if (autonomy === 'observe') {
      log(`Observe mode — inject skipped: ${message}`);
      setState(STATES.MONITORING);
      return;
    }

    if (autonomy === 'full') {
      log(`Full autonomy — auto-injecting`);
      doInject(message, true);
      return;
    }

    // Supervised: request approval
    log(`Supervised — requesting approval for inject`);
    pendingApproval = {
      type: 'inject',
      message,
      resolve: null,
    };

    emitter.emit('approvalNeeded', {
      type: 'inject',
      message,
      approve: (editedMessage) => {
        doInject(editedMessage || message, false);
        pendingApproval = null;
      },
      reject: () => {
        log('Inject rejected by human');
        pendingApproval = null;
        setState(STATES.MONITORING);
      },
    });
  }

  function doInject(message, autoApproved) {
    setState(STATES.INJECT);
    proxy.inject(message);
    emitter.emit('inject', { message, autoApproved });
    setState(STATES.MONITORING);
  }

  async function handleInterrupt(reason) {
    setState(STATES.ALERT);

    if (autonomy === 'observe') {
      log(`Observe mode — interrupt skipped: ${reason}`);
      setState(STATES.MONITORING);
      return;
    }

    if (autonomy === 'supervised') {
      // Request approval for interrupt
      pendingApproval = {
        type: 'interrupt',
        reason,
        resolve: null,
      };

      emitter.emit('approvalNeeded', {
        type: 'interrupt',
        reason,
        approve: () => {
          pendingApproval = null;
          doInterrupt(reason);
        },
        reject: () => {
          log('Interrupt rejected by human');
          pendingApproval = null;
          setState(STATES.MONITORING);
        },
      });
      return;
    }

    // Full autonomy
    doInterrupt(reason);
  }

  async function doInterrupt(reason) {
    setState(STATES.INTERRUPT);
    emitter.emit('interrupt', { reason });

    // Wait for worker to be idle before interrupting
    if (!proxy.isIdle()) {
      log('Waiting for worker to become idle...');
      await waitForIdle();
    }

    // Send escape to cancel any pending input
    proxy.sendEscape();

    // Small delay to let escape process
    await sleep(500);

    // Inject the interrupt message
    const interruptMsg = `STOP. [Auditor interruption] ${reason}. Let me explain what needs to change before you continue.`;
    proxy.inject(interruptMsg);

    // Transition to recalibration
    recalibrationTurn = 0;
    workerResponseBuffer = '';
    setState(STATES.RECALIBRATE);

    // Start listening for worker response
    startRecalibrationCapture();
  }

  function startRecalibrationCapture() {
    // The chunker will keep feeding us output.
    // In RECALIBRATE state, processChunk captures worker responses.
    // We use a timer to detect when the worker has finished responding.
    resetWorkerResponseTimer();
  }

  function resetWorkerResponseTimer() {
    if (workerResponseTimer) clearTimeout(workerResponseTimer);
    workerResponseTimer = setTimeout(() => {
      onWorkerResponseComplete();
    }, 5000);
  }

  async function onWorkerResponseComplete() {
    if (state !== STATES.RECALIBRATE) return;

    const workerResponse = workerResponseBuffer.trim();
    workerResponseBuffer = '';
    recalibrationTurn++;

    if (!workerResponse) {
      log('Empty worker response during recalibration');
      return;
    }

    log(`Recalibration turn ${recalibrationTurn}: worker responded`);
    emitter.emit('recalibrate', { turn: recalibrationTurn, message: workerResponse.slice(0, 200) });

    // Ask auditor if worker is aligned
    const auditorResult = await auditor.sendRecalibrationPrompt(workerResponse);

    if (!auditorResult) {
      log('Auditor failed during recalibration, resolving');
      resolveRecalibration();
      return;
    }

    if (auditorResult.resolved) {
      resolveRecalibration();
      return;
    }

    if (auditorResult.inject) {
      // Need follow-up correction
      if (autonomy === 'supervised') {
        emitter.emit('approvalNeeded', {
          type: 'recalibrate-inject',
          message: auditorResult.inject,
          approve: (editedMessage) => {
            proxy.inject(editedMessage || auditorResult.inject);
            emitter.emit('recalibrate', { turn: recalibrationTurn, message: auditorResult.inject });
            // Continue waiting for worker response
            startRecalibrationCapture();
          },
          reject: () => {
            log('Recalibration inject rejected, resolving');
            resolveRecalibration();
          },
        });
      } else {
        // Full autonomy
        proxy.inject(auditorResult.inject);
        emitter.emit('recalibrate', { turn: recalibrationTurn, message: auditorResult.inject });
        startRecalibrationCapture();
      }
      return;
    }

    // No clear directive, assume resolved after max turns
    if (recalibrationTurn >= 5) {
      log('Max recalibration turns reached, resolving');
      resolveRecalibration();
    } else {
      startRecalibrationCapture();
    }
  }

  function resolveRecalibration() {
    if (workerResponseTimer) clearTimeout(workerResponseTimer);

    proxy.inject('Good. Continue with the original task.');
    emitter.emit('resolved');
    setState(STATES.MONITORING);
  }

  function waitForIdle() {
    return new Promise((resolve) => {
      if (proxy.isIdle()) {
        resolve();
        return;
      }
      const handler = () => {
        proxy.removeListener('idle', handler);
        resolve();
      };
      proxy.on('idle', handler);

      // Timeout: don't wait forever
      setTimeout(() => {
        proxy.removeListener('idle', handler);
        resolve();
      }, 15000);
    });
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // Public API
  emitter.getState = () => state;
  emitter.getPendingApproval = () => pendingApproval;

  emitter.manualInject = (message) => {
    proxy.inject(message);
    emitter.emit('inject', { message, autoApproved: false });
  };

  return emitter;
}
