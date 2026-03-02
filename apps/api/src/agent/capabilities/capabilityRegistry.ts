import type { CapabilityDefinition, CapabilityId } from "./types";
import { respondInChatCapability } from "./respond_in_chat";
import { answerQuestionCapability } from "./answer_question";
import { writeDocumentCapability } from "./write_document";
import { inspectClientKnowledgeBaseCapability } from "./inspect_client_knowledge_base";
import { changeCodeCapability } from "./change_code";

const ALL: CapabilityDefinition[] = [
  respondInChatCapability,
  answerQuestionCapability,
  writeDocumentCapability,
  inspectClientKnowledgeBaseCapability,
  changeCodeCapability,
];

export function listCapabilities(): CapabilityDefinition[] {
  return ALL.slice();
}

export function getCapability(id: CapabilityId): CapabilityDefinition {
  const found = ALL.find((c) => c.id === id);
  if (!found) throw new Error(`Unknown capability: ${id}`);
  return found;
}

