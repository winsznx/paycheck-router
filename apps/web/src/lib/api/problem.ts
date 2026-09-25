import { api } from "@paycheck-router/shared";

/** An RFC 9457 problem from the core API, or a transport failure mapped onto the same shape. */
export class ApiProblem extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;

  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message);
    this.name = "ApiProblem";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }

  static async fromResponse(response: Response): Promise<ApiProblem> {
    const body: unknown = await response.json().catch(() => null);
    const parsed = api.Problem.safeParse(body);
    if (parsed.success) {
      const p = parsed.data;
      return new ApiProblem(p.status, p.code, p.detail ?? p.title, p.requestId);
    }
    return new ApiProblem(response.status, "http_error", response.statusText || "Request failed");
  }
}
