import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { getWorkflows, setWorkflows } from "@/lib/local-store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ workflows: getWorkflows() });
}

export async function POST(request: Request) {
  const { name, description, nodes, edges } = await request.json();
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const workflow = {
    id: randomUUID(),
    name,
    description: description || "",
    nodes: nodes || [],
    edges: edges || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  setWorkflows([workflow, ...getWorkflows()]);
  return NextResponse.json({ workflow });
}
