export type ClarificationAnswerValue = string | string[] | boolean;

export type ClarificationResumeMetadata = {
  sourceMessageId?: string;
  answers: Record<string, ClarificationAnswerValue>;
};

export type ClarificationFollowUpOptions = {
  skipLocalUser: true;
  skipServerUserPersist: true;
  clarification: ClarificationResumeMetadata;
};

export function buildClarificationResumeFollowUp(params: {
  message: string;
  answers: Record<string, ClarificationAnswerValue>;
  sourceMessageId?: string;
}): { message: string; options: ClarificationFollowUpOptions } {
  return {
    message: params.message,
    options: {
      skipLocalUser: true,
      skipServerUserPersist: true,
      clarification: {
        sourceMessageId: params.sourceMessageId,
        answers: params.answers,
      },
    },
  };
}
