export type ErrorParam = {
  key: string;
  value: string | number | boolean;
};

export type ErrorResponseInput = {
  status?: unknown;
  errorCode?: unknown;
  errorParams?: unknown;
  httpStatus?: unknown;
};

export type NormalizedErrorResponse = {
  status: 'error';
  message: string;
  errorCode: string;
  errorParams?: ErrorParam[];
  httpStatus?: number;
};

export const INVALID_ERROR_RESPONSE_CODE = 'error.invalidResponse';

export const isErrorParamArray = (value: unknown): value is ErrorParam[] => {
  return Array.isArray(value) && value.every((item) => {
    return (
      !!item
      && typeof item === 'object'
      && typeof (item as ErrorParam).key === 'string'
      && ['string', 'number', 'boolean'].includes(typeof (item as ErrorParam).value)
    );
  });
};

export const normalizeErrorResponseCore = ({
  response,
  fallbackHttpStatus,
  fallbackErrorCode,
  resolveMessage,
}: {
  response: ErrorResponseInput;
  fallbackHttpStatus?: number;
  fallbackErrorCode?: string;
  resolveMessage?: (args: { errorCode: string; errorParams?: ErrorParam[] }) => string;
}): NormalizedErrorResponse => {
  const normalizedParams = isErrorParamArray(response.errorParams) ? response.errorParams : undefined;
  const errorCodeValue = typeof response.errorCode === 'string' ? response.errorCode.trim() : '';
  const hasErrorCode = errorCodeValue.length > 0;
  const finalErrorCode = hasErrorCode ? errorCodeValue : (fallbackErrorCode || INVALID_ERROR_RESPONSE_CODE);
  const providedHttpStatus = typeof response.httpStatus === 'number' ? response.httpStatus : undefined;

  const message = resolveMessage
    ? resolveMessage({ errorCode: finalErrorCode, errorParams: normalizedParams })
    : finalErrorCode;

  return {
    status: 'error',
    message,
    errorCode: finalErrorCode,
    errorParams: normalizedParams,
    httpStatus: providedHttpStatus ?? fallbackHttpStatus,
  };
};

export const defaultHttpStatusForResponse = ({
  status,
  explicitHttpStatus,
  fallbackErrorStatus = 400,
}: {
  status: 'success' | 'error';
  explicitHttpStatus?: number;
  fallbackErrorStatus?: number;
}): number => {
  if (typeof explicitHttpStatus === 'number') return explicitHttpStatus;
  return status === 'success' ? 200 : fallbackErrorStatus;
};
