import { NextResponse } from "next/server";

/**
 * El retorno del navegador nunca confirma un pago. Solo vuelve a Planes, donde
 * se informa que la validación depende del webhook y la sincronización server-side.
 */
export function GET(request: Request) {
  return NextResponse.redirect(
    new URL("/dashboard/planes?payment=processing", request.url),
    303
  );
}
