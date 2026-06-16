export { BaseNodeWrapper } from './BaseNode';
export type { BaseNodeProps, BaseNodeHandleSpec } from './BaseNode';

export { RowEventTriggerNode } from './RowEventTrigger';
export { MemoryStoreNode } from './MemoryStore';
export { MemoryRecallNode } from './MemoryRecall';
export { AgentRunNode } from './AgentRun';
export { SqlQueryNode } from './SqlQuery';
export { HttpRequestNode } from './HttpRequest';
export { IfNode } from './If';
export { SwitchNode } from './Switch';
export { LoopNode } from './Loop';
export { ApprovalNode } from './Approval';
export { SetVariableNode } from './SetVariable';
export { ReturnNode } from './Return';

import { RowEventTriggerNode } from './RowEventTrigger';
import { MemoryStoreNode } from './MemoryStore';
import { MemoryRecallNode } from './MemoryRecall';
import { AgentRunNode } from './AgentRun';
import { SqlQueryNode } from './SqlQuery';
import { HttpRequestNode } from './HttpRequest';
import { IfNode } from './If';
import { SwitchNode } from './Switch';
import { LoopNode } from './Loop';
import { ApprovalNode } from './Approval';
import { SetVariableNode } from './SetVariable';
import { ReturnNode } from './Return';

/**
 * Pass this object to the `nodeTypes` prop of <ReactFlow>.
 * The key must match the `type` field set on each WorkflowNode.
 */
export const NODE_TYPES = {
  RowEventTrigger: RowEventTriggerNode,
  MemoryStore: MemoryStoreNode,
  MemoryRecall: MemoryRecallNode,
  AgentRun: AgentRunNode,
  SqlQuery: SqlQueryNode,
  HttpRequest: HttpRequestNode,
  If: IfNode,
  Switch: SwitchNode,
  Loop: LoopNode,
  Approval: ApprovalNode,
  SetVariable: SetVariableNode,
  Return: ReturnNode,
} as const;

export type NodeTypesMap = typeof NODE_TYPES;
