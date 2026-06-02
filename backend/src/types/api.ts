export type ApiResponse<T> = { data: T };
export type ApiError = { error: { code: string; message: string } };
