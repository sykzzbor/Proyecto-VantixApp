"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import {
  submitCreateOrganization,
  type CreateOrganizationFormState,
} from "@/server/actions/organization";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/forms/field-error";
import { FormAlert } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";

export function CreateOrganizationForm({
  userName,
  suggestedName = "",
}: {
  userName: string;
  /** Nombre propuesto en el registro. Solo un valor inicial, siempre editable. */
  suggestedName?: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const formErrorRef = useRef<HTMLDivElement>(null);
  const [clientFieldError, setClientFieldError] = useState<string | null>(null);
  const initialState: CreateOrganizationFormState = {
    status: "idle",
    error: null,
    fieldError: null,
    submittedName: "",
    attempt: 0,
  };
  const [state, formAction, pending] = useActionState(
    submitCreateOrganization,
    initialState
  );

  useEffect(() => {
    if (state.attempt === 0) return;
    if (state.fieldError) {
      inputRef.current?.focus();
      return;
    }
    if (state.error) formErrorRef.current?.focus();
  }, [state.attempt, state.error, state.fieldError]);

  function validateBeforeSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (pending) {
      event.preventDefault();
      return;
    }

    const input = inputRef.current;
    const name = input?.value.trim() ?? "";
    if (input) input.value = name;

    if (name.length < 2) {
      event.preventDefault();
      setClientFieldError("Ingresá el nombre de tu negocio.");
      input?.focus();
      return;
    }
    if (name.length > 120) {
      event.preventDefault();
      setClientFieldError("El nombre es demasiado largo.");
      input?.focus();
      return;
    }
    setClientFieldError(null);
  }

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <Card className="border-0 bg-transparent shadow-none">
      <CardHeader className="px-0">
        <CardTitle className="text-xl">
          Hola {userName.split(" ")[0]}, empecemos
        </CardTitle>
        <CardDescription>
          Asignale un nombre al espacio donde vas a gestionar clientes, equipo e integraciones.
        </CardDescription>
      </CardHeader>
      <form
        action={formAction}
        onSubmit={validateBeforeSubmit}
        noValidate
        aria-busy={pending}
      >
        <CardContent className="space-y-5 px-0">
          <div ref={formErrorRef} tabIndex={-1} className="outline-none">
            <FormAlert message={state.error} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">Nombre del negocio</Label>
            <Input
              id="name"
              name="name"
              placeholder="Estética Aurora"
              autoComplete="organization"
              autoFocus
              defaultValue={state.submittedName || suggestedName}
              ref={inputRef}
              minLength={2}
              maxLength={120}
              aria-invalid={Boolean(clientFieldError || state.fieldError)}
              aria-describedby="name-error name-help"
              onChange={() => {
                if (clientFieldError) setClientFieldError(null);
              }}
            />
            <div id="name-error" aria-live="polite">
              <FieldError message={clientFieldError ?? state.fieldError ?? undefined} />
            </div>
            <p id="name-help" className="text-xs leading-relaxed text-muted-foreground">
              Podés cambiarlo más adelante desde Configuración. No tiene que coincidir con el nombre público del negocio.
            </p>
          </div>
        </CardContent>
        <CardFooter className="mt-6 flex-col gap-3 border-0 bg-transparent px-0 pt-0">
          <SubmitButton loading={pending} className="w-full">
            {pending ? "Creando negocio…" : "Crear negocio"}
          </SubmitButton>
          <Button
            type="button"
            variant="ghost"
            className="w-full text-muted-foreground"
            onClick={handleSignOut}
          >
            Cerrar sesión
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
