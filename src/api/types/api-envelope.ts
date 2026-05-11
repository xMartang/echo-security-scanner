export type SuccessEnvelope<T> = { data: T };
export type ErrorEnvelope = { error: { message: string; code?: string } };
export type ApiEnvelope<T> = SuccessEnvelope<T> | ErrorEnvelope;

export function successResponse<T>(data: T): SuccessEnvelope<T> {
  return { data };
}

export function errorResponse(message: string, code?: string): ErrorEnvelope {
  return { error: { message, code } };
}
