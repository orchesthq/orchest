import type { CapabilityDefinition, CapabilityId } from "./types";
import { respondInChatCapability } from "./respond_in_chat";
import { writeDocumentCapability } from "./write_document";
import { changeCodeCapability } from "./change_code";

const ALL: CapabilityDefinition[] = [respondInChatCapability, writeDocumentCapability, changeCodeCapability];

export function listCapabilities(): CapabilityDefinition[] {
  return ALL.slice();
}

export function getCapability(id: CapabilityId): CapabilityDefinition {
  const found = ALL.find((c) => c.id === id);
  if (!found) throw new Error(`Unknown capability: ${id}`);
  return found;
}

