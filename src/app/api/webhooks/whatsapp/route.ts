import { after } from "next/server";
import {
  handleWhatsappWebhookPost,
  handleWhatsappWebhookVerification,
} from "@/server/whatsapp/webhook-http";

export const runtime = "nodejs";
export const maxDuration = 60;

export function GET(request: Request) {
  return handleWhatsappWebhookVerification(request);
}

export function POST(request: Request) {
  return handleWhatsappWebhookPost(request, (task) => after(task));
}
