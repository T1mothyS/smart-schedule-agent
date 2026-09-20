import crypto from 'node:crypto';
import { defaultModel, getMissingCodeBuddyCredentialMessage, resolveCodeBuddyCredential } from './ai-credentials.js';
import * as db from './db.js';
import { buildCodeBuddyEnv } from './codebuddy-env.js';
import { OptimizeError, optimizePrompt, optimizerInput } from './prompt-optimize.js';

export interface PromptOptimizationRun {
  runId: string;
  input: string;
  optimizedText: string;
}

export function createPromptOptimizationRunId(): string {
  return crypto.randomUUID();
}

/**
 * Runs one isolated optimizer request for a user. The run id is deliberately
 * kept out of the prompt and note content; it only correlates this attempt
 * with logs and prevents callers from treating retries as the same run.
 */
export async function runPromptOptimization(userId: string, text: unknown, controller: AbortController, runId = createPromptOptimizationRunId()): Promise<PromptOptimizationRun> {
  const input = optimizerInput(text);
  const credential = resolveCodeBuddyCredential(userId);
  if (!credential) throw new OptimizeError(getMissingCodeBuddyCredentialMessage(userId), 400);
  const optimizedText = await optimizePrompt(input, {
    model: db.getUserPreferredModel(userId, defaultModel),
    env: buildCodeBuddyEnv(credential),
  }, controller);
  return { runId, input, optimizedText };
}
