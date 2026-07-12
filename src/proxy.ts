import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Chequeo optimista por cookie: evita mostrar páginas protegidas a visitantes
 * sin sesión. La verificación real de la sesión y de la organización se hace
 * siempre en el servidor (layouts, páginas y server actions).
 *
 * La redirección inversa (usuario logueado que visita /login) la hacen las
 * propias páginas con la sesión validada: hacerla acá solo con la cookie
 * provoca loops cuando la cookie quedó inválida.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/dashboard") && !getSessionCookie(request)) {
    const url = new URL("/login", request.url);
    url.searchParams.set("callbackURL", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
