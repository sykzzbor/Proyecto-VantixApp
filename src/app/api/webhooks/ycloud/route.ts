import { after } from "next/server";
import { handleYCloudWebhookPost } from "@/server/whatsapp/ycloud-webhook-http";

export const runtime = "nodejs";
export const maxDuration = 60;

export function POST(request: Request) {
  return handleYCloudWebhookPost(request, (task) => after(task));
}
