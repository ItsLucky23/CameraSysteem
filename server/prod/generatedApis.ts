export const apis: Record<string, { auth: any, main: any, rateLimit?: number | false, httpMethod?: 'GET' | 'POST' | 'PUT' | 'DELETE' }> = { };

export const syncs: Record<string, { main: any, auth: Record<string, any> }> | any = { };

export const functions: Record<string, any> = { };