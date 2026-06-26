import { NextResponse } from "next/server";
import type { Edge } from "@xyflow/react";
import type {
  ExecutionResult,
  MergeNodeData,
  OutputNodeData,
  TextInputNodeData,
  WorkflowNode,
  WorkflowNodeType,
} from "@/lib/workflow-types";

export const dynamic = "force-dynamic";

function incoming(nodeId: string, edges: Edge[], outputs: Map<string, string>) {
  return edges
    .filter((edge) => edge.target === nodeId)
    .map((edge) => outputs.get(edge.source) || "")
    .filter(Boolean);
}

function formatOutput(data: OutputNodeData, input: string) {
  if (data.outputType === "custom" && data.customTemplate) {
    return data.customTemplate.replace(/\{\{content\}\}/g, input);
  }
  return input;
}

export async function POST(request: Request) {
  const { nodes, edges } = await request.json() as { nodes: WorkflowNode[]; edges: Edge[] };
  if (!nodes?.length) return NextResponse.json({ error: "No nodes to execute" }, { status: 400 });

  const outputs = new Map<string, string>();
  const results: ExecutionResult[] = [];
  let finalOutput = "";

  for (const node of nodes) {
    const inputs = incoming(node.id, edges || [], outputs);
    const combined = inputs.join("\n\n");
    let output = combined;

    if ((node.type as WorkflowNodeType) === "textInput") {
      output = (node.data as TextInputNodeData).text || "";
    } else if ((node.type as WorkflowNodeType) === "merge") {
      const separator = ((node.data as MergeNodeData).separator || "\n\n").replace(/\\n/g, "\n");
      output = inputs.join(separator);
    } else if ((node.type as WorkflowNodeType) === "output") {
      output = formatOutput(node.data as OutputNodeData, combined);
      finalOutput = output;
    }

    outputs.set(node.id, output);
    results.push({
      nodeId: node.id,
      nodeType: node.type as WorkflowNodeType,
      output,
      timestamp: new Date(),
    });
  }

  return NextResponse.json({
    status: "completed",
    results,
    finalOutput: finalOutput || results.at(-1)?.output || "",
  });
}
