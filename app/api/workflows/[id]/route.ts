import { NextResponse } from "next/server";
import { getWorkflows, setWorkflows } from "@/lib/local-store";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const workflow = getWorkflows().find((item) => item.id === id);
  if (!workflow) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  return NextResponse.json({ workflow });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const workflows = getWorkflows();
  const index = workflows.findIndex((item) => item.id === id);
  if (index === -1) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });

  workflows[index] = {
    ...workflows[index],
    ...body,
    updatedAt: new Date().toISOString(),
  };
  setWorkflows(workflows);
  return NextResponse.json({ workflow: workflows[index] });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  setWorkflows(getWorkflows().filter((item) => item.id !== id));
  return NextResponse.json({ success: true });
}
