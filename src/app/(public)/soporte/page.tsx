import type { Metadata } from "next";
import { AlertTriangle, CreditCard, LifeBuoy, LockKeyhole, PlugZap, UserRound } from "lucide-react";
import {
  SUPPORT_EMAIL,
  SUPPORT_PHONE,
  SUPPORT_WHATSAPP_URL,
} from "@/components/public/public-footer";

export const metadata: Metadata = {
  title: "Soporte",
  description: "Centro público de soporte de VantixApp.",
};

const CATEGORIES = [
  { title: "Cuenta", text: "Acceso, registro, organizaciones, miembros y permisos.", icon: UserRound },
  { title: "Facturación", text: "Planes, prueba gratuita, suscripciones y estados de pago.", icon: CreditCard },
  { title: "Integraciones", text: "WhatsApp, Google, Tiendanube y conexiones disponibles.", icon: PlugZap },
  { title: "Privacidad", text: "Acceso, corrección, exportación o eliminación de datos.", icon: LockKeyhole },
  { title: "Errores", text: "Pantallas que no cargan, acciones fallidas o comportamientos inesperados.", icon: AlertTriangle },
] as const;

export default function SupportPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8 lg:py-16">
      <header className="max-w-3xl space-y-4">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-semibold text-primary"><LifeBuoy className="size-3.5" aria-hidden /> Centro de soporte</div>
        <h1 className="text-3xl font-semibold tracking-[-0.04em] sm:text-4xl lg:text-5xl">Estamos para ayudarte</h1>
        <p className="text-base leading-7 text-muted-foreground sm:text-lg">Contanos qué necesitás y te responderemos con el contexto necesario para resolverlo.</p>
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={SUPPORT_WHATSAPP_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Escribir por WhatsApp · {SUPPORT_PHONE}
          </a>
          <a
            href={`mailto:${SUPPORT_EMAIL}?subject=Soporte%20VantixApp`}
            className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {SUPPORT_EMAIL}
          </a>
        </div>
      </header>

      <section className="mt-10" aria-labelledby="categorias">
        <h2 id="categorias" className="text-xl font-semibold">¿Sobre qué tema necesitás ayuda?</h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORIES.map(({ title, text, icon: Icon }) => (
            <div key={title} className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="size-4.5" aria-hidden /></span>
              <h3 className="mt-4 font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="mt-10 grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-6 shadow-sm" aria-labelledby="enviar">
          <h2 id="enviar" className="text-xl font-semibold">Información útil para ayudarnos</h2>
          <ul className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">
            <li>• Correo asociado a tu cuenta y nombre del negocio.</li>
            <li>• Sección donde ocurrió el problema y pasos para reproducirlo.</li>
            <li>• Fecha y hora aproximada, navegador y dispositivo.</li>
            <li>• Captura del error sin información privada.</li>
            <li>• Identificador de solicitud, si la pantalla muestra uno.</li>
          </ul>
        </section>
        <section className="rounded-xl border border-amber-500/30 bg-amber-500/[0.07] p-6" aria-labelledby="seguridad-soporte">
          <div className="flex items-center gap-3 text-amber-800 dark:text-amber-200"><LockKeyhole className="size-5" aria-hidden /><h2 id="seguridad-soporte" className="text-xl font-semibold">Protegé tus credenciales</h2></div>
          <p className="mt-4 text-sm leading-6 text-foreground">Nunca compartas contraseñas, códigos de verificación, access tokens, API keys, secretos de webhooks, datos completos de tarjetas ni archivos <code className="rounded bg-muted px-1 py-0.5 text-xs">.env</code>.</p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">El equipo de VantixApp no necesita esos valores para brindarte soporte. Si una credencial fue expuesta, revocala en el proveedor correspondiente antes de contactarnos.</p>
        </section>
      </div>
    </div>
  );
}
