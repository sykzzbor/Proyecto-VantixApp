"use client";

import { useEffect } from "react";

/**
 * Avisa antes de cerrar o recargar la pestaña con cambios sin guardar.
 *
 * Solo cubre la salida del documento (cerrar, recargar, ir a otro sitio). La
 * navegación interna de Next no dispara `beforeunload`; para eso los pasos
 * guardan antes de avanzar, así que no hay forma de perder datos al continuar.
 */
export function useUnsavedChangesGuard(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      // Los navegadores modernos ignoran el texto y muestran el suyo.
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [enabled]);
}
