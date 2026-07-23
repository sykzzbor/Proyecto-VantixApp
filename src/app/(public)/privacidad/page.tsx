import type { Metadata } from "next";
import Link from "next/link";
import { Database, Eye, KeyRound, Scale, ShieldCheck, Trash2 } from "lucide-react";
import { SUPPORT_EMAIL } from "@/components/public/public-footer";

export const metadata: Metadata = {
  title: "Privacidad",
  description: "Política de privacidad de VantixApp.",
};

const DATA_GROUPS = [
  {
    title: "Cuenta e inicio de sesión",
    text: "Nombre, correo, imagen de perfil, método de acceso, sesiones y datos necesarios para autenticarte y proteger tu cuenta.",
  },
  {
    title: "Organización y negocio",
    text: "Nombre del negocio, integrantes, roles, información comercial, productos, servicios, preguntas frecuentes, documentos y preferencias configuradas.",
  },
  {
    title: "Clientes y conversaciones",
    text: "Datos de contacto, historial de conversaciones, mensajes, asignaciones, estados, notas y acciones necesarias para operar el CRM y la atención.",
  },
  {
    title: "Integraciones",
    text: "Identificadores técnicos, permisos concedidos, estados de conexión, datos sincronizados, fechas de actividad y errores sanitizados.",
  },
  {
    title: "Facturación",
    text: "Plan, estado de suscripción, correo del pagador, importes, cotización utilizada e identificadores de pago. VantixApp no almacena datos completos de tarjetas.",
  },
  {
    title: "Seguridad y funcionamiento",
    text: "Registros técnicos, auditoría, métricas de uso y datos mínimos para prevenir abuso, investigar errores y mantener el servicio seguro.",
  },
] as const;

const PROVIDERS = [
  ["Google", "Puede usarse para identidad básica y, mediante autorizaciones separadas, para Calendar o Sheets. Solo se solicitan los permisos necesarios para la función elegida."],
  ["Tiendanube", "Sincroniza en modo de lectura productos, variantes, stock, precios, clientes y pedidos de la organización conectada."],
  ["WooCommerce", "No está disponible actualmente. Si se habilita, su conexión se informará antes de autorizarla y se limitará a los datos necesarios para las funciones ofrecidas."],
  ["Mercado Pago", "Procesa suscripciones y estados de pago. Mercado Pago recibe los datos necesarios para el cobro; VantixApp conserva referencias y estados, no los datos completos de la tarjeta."],
  ["WhatsApp", "Permite recibir y enviar mensajes mediante los proveedores conectados por cada organización. Se procesan conversaciones, contactos y estados de entrega para prestar el servicio."],
] as const;

export default function PrivacyPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8 lg:py-16">
      <header className="max-w-3xl space-y-4">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-semibold text-primary">
          <ShieldCheck className="size-3.5" aria-hidden /> Privacidad y protección de datos
        </div>
        <h1 className="text-3xl font-semibold tracking-[-0.04em] sm:text-4xl lg:text-5xl">Cómo cuidamos tu información</h1>
        <p className="text-base leading-7 text-muted-foreground sm:text-lg">
          Esta política explica qué información trata VantixApp, para qué la utiliza y cómo podés ejercer tus derechos.
        </p>
        <p className="text-sm text-muted-foreground">Última actualización: 22 de julio de 2026.</p>
      </header>

      <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <article className="min-w-0 space-y-10">
          <section aria-labelledby="datos">
            <div className="mb-5 flex items-center gap-3"><Database className="size-5 text-primary" aria-hidden /><h2 id="datos" className="text-xl font-semibold">Datos que recopilamos</h2></div>
            <div className="grid gap-3 sm:grid-cols-2">
              {DATA_GROUPS.map((group) => (
                <div key={group.title} className="rounded-xl border border-border bg-card p-5 shadow-sm">
                  <h3 className="font-semibold">{group.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{group.text}</p>
                </div>
              ))}
            </div>
          </section>

          <section aria-labelledby="uso" className="space-y-4">
            <div className="flex items-center gap-3"><Eye className="size-5 text-primary" aria-hidden /><h2 id="uso" className="text-xl font-semibold">Cómo usamos la información</h2></div>
            <p className="leading-7 text-muted-foreground">Usamos los datos para autenticar usuarios, administrar organizaciones y permisos, prestar el CRM, operar conversaciones y automatizaciones, conectar servicios solicitados, gestionar suscripciones, brindar soporte y proteger la plataforma. No vendemos información personal.</p>
          </section>

          <section aria-labelledby="integraciones" className="space-y-4">
            <h2 id="integraciones" className="text-xl font-semibold">Servicios e integraciones</h2>
            <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {PROVIDERS.map(([name, text]) => (
                <div key={name} className="p-5"><h3 className="font-semibold">{name}</h3><p className="mt-1.5 text-sm leading-6 text-muted-foreground">{text}</p></div>
              ))}
            </div>
          </section>

          <section aria-labelledby="seguridad" className="space-y-4">
            <div className="flex items-center gap-3"><KeyRound className="size-5 text-primary" aria-hidden /><h2 id="seguridad" className="text-xl font-semibold">Seguridad y credenciales</h2></div>
            <p className="leading-7 text-muted-foreground">Los tokens de integraciones se almacenan cifrados y se utilizan únicamente desde el servidor. No se muestran nuevamente en la interfaz ni se incluyen deliberadamente en registros, auditorías o mensajes de error. Aplicamos controles de sesión, permisos por rol y aislamiento entre organizaciones.</p>
          </section>

          <section aria-labelledby="conservacion" className="space-y-4">
            <div className="flex items-center gap-3"><Trash2 className="size-5 text-primary" aria-hidden /><h2 id="conservacion" className="text-xl font-semibold">Conservación y eliminación</h2></div>
            <p className="leading-7 text-muted-foreground">Conservamos la información mientras la cuenta esté activa y durante el tiempo necesario para prestar el servicio, mantener la seguridad, resolver disputas y cumplir obligaciones legales o contables. Desconectar una integración no elimina automáticamente conversaciones ni datos históricos.</p>
            <p className="leading-7 text-muted-foreground">Podés solicitar acceso, corrección, exportación o eliminación. Verificaremos la identidad y el vínculo con la organización antes de actuar. Algunos registros mínimos pueden conservarse cuando exista una obligación legal, de seguridad o facturación; el resto se eliminará o anonimizará de manera razonable, incluyendo su salida de copias de respaldo según su ciclo de rotación.</p>
          </section>

          <section aria-labelledby="derechos" className="space-y-4">
            <div className="flex items-center gap-3"><Scale className="size-5 text-primary" aria-hidden /><h2 id="derechos" className="text-xl font-semibold">Solicitudes y contacto</h2></div>
            <p className="leading-7 text-muted-foreground">Para realizar una solicitud de privacidad, escribinos desde el correo asociado a tu cuenta e indicá la organización involucrada y el tipo de solicitud. Nunca incluyas contraseñas, tokens ni claves privadas.</p>
            <a href={`mailto:${SUPPORT_EMAIL}?subject=Solicitud%20de%20privacidad%20VantixApp`} className="inline-flex font-semibold text-primary underline-offset-4 hover:underline">{SUPPORT_EMAIL}</a>
          </section>
        </article>

        <aside className="rounded-xl border border-border bg-card p-5 shadow-sm lg:sticky lg:top-24">
          <h2 className="font-semibold">¿Necesitás ayuda?</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Consultá qué información enviar y cómo proteger tus credenciales al contactarnos.</p>
          <Link href="/soporte" className="mt-4 inline-flex font-semibold text-primary underline-offset-4 hover:underline">Ir a soporte</Link>
        </aside>
      </div>
    </div>
  );
}
