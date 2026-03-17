// lib/useResumeLoad.ts
//
// Hook que reemplaza el patrón:
//   useEffect(() => onAppResumed(() => { void fn(); }), [fn]);
//
// Soluciona dos bugs:
// 1. Stale closure: el listener se registra UNA SOLA VEZ y siempre llama
//    las versiones más recientes de las funciones via refs (sin re-registrar).
// 2. Empresa tardía: si `empresaActivaId` era null cuando `emitAppResumed()`
//    disparó (sesión no recuperada aún), se reintenta cuando `empresaActivaId`
//    se recupere dentro de la ventana de 45 s del resume.

import { useEffect, useRef } from "react";
import { onAppResumed, isRecentResume } from "./resumeEvents";

export function useResumeLoad(
  empresaActivaId: number | null | undefined,
  ...fns: Array<() => void>
) {
  const fnsRef = useRef<Array<() => void>>(fns);
  fnsRef.current = fns;

  // Listener registrado UNA SOLA VEZ — nunca se re-registra.
  // Siempre llama las funciones más recientes via ref.
  useEffect(() => {
    return onAppResumed(() => {
      for (const fn of fnsRef.current) fn();
    });
    // Intencionalmente vacío: usamos refs para leer siempre el valor más reciente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Red de seguridad: si empresaActivaId pasó de nulo/indefinido a válido
  // dentro de la ventana del resume (sesión tardó en recuperarse), recargar.
  const prevIdRef = useRef<number | null | undefined>(empresaActivaId);
  useEffect(() => {
    const prev = prevIdRef.current;
    prevIdRef.current = empresaActivaId;

    // Solo cuando la empresa pasa de nula/indefinida a un valor válido.
    if (!empresaActivaId || !!prev) return;

    // Solo si hubo un resume reciente (45 s de ventana).
    if (!isRecentResume(45_000)) return;

    for (const fn of fnsRef.current) fn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaActivaId]);
}
