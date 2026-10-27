/**
 * Typed error taxonomy shared by the HTTP client. The UI never receives raw
 * exceptions or server messages: every failure is one of these kinds.
 */
export type ApiError =
  | Readonly<{ kind: 'contract' }>
  | Readonly<{ kind: 'timeout' }>
  | Readonly<{ kind: 'network' }>
  | Readonly<{ kind: 'server'; status: number }>
  | Readonly<{ kind: 'unauthorized' }>
  | Readonly<{ kind: 'forbidden' }>
  | Readonly<{ kind: 'not_found' }>
  | Readonly<{ kind: 'conflict'; code: string }>
  | Readonly<{ kind: 'rate_limited'; retryAfterMs: number | null }>
  | Readonly<{ kind: 'rejected'; status: number; code: string }>;

export type ApiResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: ApiError }>;

export function success<T>(value: T): ApiResult<T> {
  return { ok: true, value };
}

export function failure<T>(error: ApiError): ApiResult<T> {
  return { ok: false, error };
}

/** Short, non-sensitive Spanish messages for the UI. */
export function describeApiError(error: ApiError): string {
  switch (error.kind) {
    case 'contract':
      return 'El servidor respondió con datos que no cumplen el contrato.';
    case 'timeout':
      return 'El servidor tardó demasiado en responder.';
    case 'network':
      return 'No hay conexión con el servidor.';
    case 'server':
      return 'El servidor tuvo un error interno.';
    case 'unauthorized':
      return 'La sesión expiró. Inicia sesión de nuevo.';
    case 'forbidden':
      return 'Tu perfil no tiene permiso para esta operación.';
    case 'not_found':
      return 'La incidencia no existe o no es visible para tu perfil.';
    case 'conflict':
      return 'La incidencia cambió en el servidor; revisa el conflicto.';
    case 'rate_limited':
      return 'Demasiadas solicitudes; intenta más tarde.';
    case 'rejected':
      return 'El servidor rechazó la solicitud.';
  }
}
