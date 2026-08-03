export class AppError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function forbidden(message = 'Sem permissão para esta ação.') {
  return new AppError(message, 403);
}

export function notFound(message = 'Registro não encontrado.') {
  return new AppError(message, 404);
}
